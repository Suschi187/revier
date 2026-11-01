begin;
\ir _helpers.psql
select plan(16);

-- M6 Commit 4 (ADR 016, Review B1 a, B3): set_listing_location mit p_point keep | set | clear, keine Punkte in
-- Kreisen unter 400 km², Fehler ohne Koordinaten.
set constraints all immediate;

create function tests.hint_of_loc(statement text) returns text language plpgsql as $$
declare h text;
begin
  execute statement;
  return null;
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return coalesce(h, sqlstate);
end;
$$;
grant execute on function tests.hint_of_loc(text) to authenticated;

select tests.create_user('sl-owner@test.local') as o \gset
select tests.create_user('sl-other@test.local') as x \gset
select tests.create_user('sl-admin@test.local') as adm \gset
select tests.create_user('sl-nolegal@test.local', null, false) as nl \gset
select tests.make_admin(:'adm');
select id as big, centroid as big_c from regions where code = 'DE-14628' \gset
select id as big2, centroid as big2_c from regions where code = 'DE-09184' \gset
select id as small from regions where code = 'DE-14612' \gset
select code as pc from postal_code_regions where region_id = :'big' order by code limit 1 \gset

select tests.authenticate_as(:'o');
insert into listings (kind, direction, title, content_language, region_id) values ('helper', 'wanted', 'Punkt setzen', 'de', :'big')
returning id as l \gset
\set lat 50.95
\set lng 13.95

-- set: verfremdeter Punkt 3–5 km neben der Eingabe, PLZ und Ort im selben Aufruf
select lives_ok(format($$ select set_listing_location(%L, %L, %L, 'Pirna', 'set', 50.95, 13.95) $$, :'l', :'big', :'pc'), 'set mit Punkt');
select ok((select extensions.st_distance(display_location, extensions.st_setsrid(extensions.st_makepoint(13.95, 50.95), 4326)::extensions.geography) from listings where id = :'l') between 2293 and 5707,
  'Gespeichert ist der verfremdete Punkt');
select is((select place_name from listing_places where listing_id = :'l'), 'Pirna', 'Ort im selben Aufruf gespeichert');
select display_location::text as stored from listings where id = :'l' \gset

-- keep ohne Änderung: Punkt bleibt; keep mit Kreiswechsel: Punkt weg (neuer Schlüssel)
select lives_ok(format($$ select set_listing_location(%L, %L, %L, 'Pirna') $$, :'l', :'big', :'pc'), 'keep (Vorgabe) ohne Änderung');
select is((select display_location::text from listings where id = :'l'), :'stored', 'keep: Punkt unverändert');
select lives_ok(format($$ select set_listing_location(%L, %L, null, null, 'keep') $$, :'l', :'big2'), 'keep mit Kreiswechsel');
select is((select display_location from listings where id = :'l'), null, 'keep mit Kreiswechsel löscht den Punkt');

-- set mit Kreiswechsel: neuer Kreis zählt für Plausibilität und Schlüssel
select is(tests.hint_of_loc(format($$ select set_listing_location(%L, %L, null, null, 'set', 50.95, 13.95) $$, :'l', :'big2')),
  '{"fields":["place.point.too_far"]}', 'set mit Kreiswechsel prüft den neuen Kreis (Punkt zu weit)');
select lives_ok(format($$ select set_listing_location(%L, %L, null, null, 'set', 48.05, 11.7) $$, :'l', :'big2'), 'set im neuen Kreis');

-- clear
select lives_ok(format($$ select set_listing_location(%L, %L, null, null, 'clear') $$, :'l', :'big2'), 'clear');
select is((select display_location from listings where id = :'l'), null, 'clear entfernt den Punkt');

-- Kleine Kreise (B1 a): kein Punkt, Grenze aus app_settings
select is(tests.hint_of_loc(format($$ select set_listing_location(%L, %L, null, null, 'set', 51.05, 13.74) $$, :'l', :'small')),
  '{"fields":["place.point.small_district"]}', 'Kreis unter 400 km²: kein Punkt, Feldcode ohne Koordinaten');

-- Ungültige Werte und fremde Konten
select is(tests.hint_of_loc(format($$ select set_listing_location(%L, %L, null, null, 'set', 'NaN', 13.9) $$, :'l', :'big2')), 'point',
  'NaN als Breite: 22023 point');
select is(tests.hint_of_loc(format($$ select set_listing_location(%L, %L, null, null, 'move') $$, :'l', :'big2')), 'point', 'Unbekannter Modus: 22023 point');
select tests.authenticate_as(:'x');
select throws_ok(format($$ select set_listing_location(%L, %L, null, null, 'set', 48.05, 11.7) $$, :'l', :'big2'), '42501', null, 'Fremder: 42501');
select tests.authenticate_as(:'nl');
select throws_ok(format($$ select set_listing_location(%L, %L, null, null, 'clear') $$, :'l', :'big2'), 'RV001', null, 'Ohne Zustimmung: RV001');

select * from finish();
rollback;
