begin;
\ir _helpers.psql
select plan(28);

-- QA M6 (Abnahme, docs/QA-REPORT.md „M6 – Abnahme“): Standortschutz an allen Schreibwegen (RPC, direktes
-- PostgREST-Update, Insert, service_role, Admin), Regel kleine Kreise inklusive Umgehungsversuchen, p_point-Vertrag,
-- bbox-Grenzen und Kreismittelpunkt-Semantik, Ausgabe genau wie gespeichert. Bekannte Fehler als TODO (F4–F6).
set constraints all immediate;

create function tests.qa6_err(statement text) returns text language plpgsql as $$
declare h text; s text;
begin
  execute statement;
  return 'ok';
exception when others then
  get stacked diagnostics h = pg_exception_hint, s = returned_sqlstate;
  -- Hint nur, wenn er ein Feldcode ist (ohne Leerzeichen), nicht der Hinweis von Postgres zu Grants.
  return s || coalesce(' ' || case when h !~ ' ' then nullif(h, '') end, '');
end;
$$;
grant execute on function tests.qa6_err(text) to anon, authenticated, service_role;
grant usage on schema tests to service_role;

select tests.create_user('qa6-o@test.local') as o \gset
select tests.create_user('qa6-adm@test.local') as adm \gset
select tests.make_admin(:'adm');
select id as big, centroid as big_c from regions where code = 'DE-14628' \gset
select id as small from regions where code = 'DE-14612' \gset
\set small_pt 'SRID=4326;POINT(13.74 51.05)'

select tests.authenticate_as(:'o');
insert into listings (kind, direction, title, content_language, region_id) values ('helper', 'wanted', 'QA6 groß', 'de', :'big')
returning id as l \gset
insert into listings (kind, direction, title, content_language, region_id) values ('helper', 'wanted', 'QA6 klein', 'de', :'small')
returning id as ls \gset

-- 1. Regel kleine Kreise auf allen Wegen
select is(tests.qa6_err(format($$ update listings set display_location = %L where id = %L $$, :'small_pt', :'ls')),
  '23514 {"fields":["place.point.small_district"]}', 'Kleiner Kreis: direktes PostgREST-Update des Punkts abgelehnt');
select is(tests.qa6_err(format($$ insert into listings (kind, direction, title, content_language, region_id, display_location)
  values ('helper', 'wanted', 'QA6 x', 'de', %L, %L) $$, :'small', :'small_pt')),
  '23514 {"fields":["place.point.small_district"]}', 'Kleiner Kreis: Insert mit Punkt abgelehnt');
select lives_ok(format($$ select set_listing_location(%L, %L, null, null, 'set', 50.95, 13.95) $$, :'l', :'big'), 'Punkt im großen Kreis');
select is(tests.qa6_err(format($$ update listings set region_id = %L, display_location = %L where id = %L $$, :'small', :'small_pt', :'l')),
  '23514 {"fields":["place.point.small_district"]}', 'Kreiswechsel in kleinen Kreis mit Punkt (direkt) abgelehnt');
select is(tests.qa6_err(format($$ select set_listing_location(%L, %L, null, null, 'set', 51.05, 13.74) $$, :'l', :'small')),
  '23514 {"fields":["place.point.small_district"]}', 'Kreiswechsel in kleinen Kreis mit Punkt (RPC) abgelehnt');
select display_location::text as stored from listings where id = :'l' \gset
select is(tests.qa6_err(format($$ update listings set region_id = %L, display_location = %L::extensions.geography where id = %L $$, :'small', :'stored', :'l')),
  'ok', 'Kreiswechsel mit zurückgeschicktem gespeichertem Punkt läuft ...');
select is((select display_location from listings where id = :'l'), null, '... und entfernt den Punkt (kein Punkt im kleinen Kreis)');
select ok(extensions.st_equals((select map_point from listings where id = :'l'), (select centroid::extensions.geometry from regions where id = :'small')),
  'map_point danach = Mittelpunkt des kleinen Kreises');

-- 2. Schreibwege auf map_point und display_location
select lives_ok(format($$ select set_listing_location(%L, %L, null, null, 'set', 50.95, 13.95) $$, :'l', :'big'), 'Punkt wieder gesetzt');
select is(tests.qa6_err(format($$ update listings set map_point = 'SRID=4326;POINT(1 1)' where id = %L $$, :'l')), '42501',
  'Besitzer: kein Schreibrecht auf map_point');
select tests.as_postgres();
set local role service_role;
select is(tests.qa6_err(format($$ update listings set display_location = 'SRID=4326;POINT(13.95 50.95)' where id = %L $$, :'l')), '42501',
  'service_role setzt keinen Punkt');
update listings set map_point = 'SRID=4326;POINT(1 1)' where id = :'l';
select ok(extensions.st_equals((select map_point from listings where id = :'l'), (select display_location::extensions.geometry from listings where id = :'l')),
  'service_role: direkter Schreibversuch auf map_point wird überschrieben');
reset role;
select tests.authenticate_as(:'adm', 'aal2');
select is(tests.qa6_err(format($$ select set_listing_location(%L, %L, null, null, 'set', 50.95, 13.95) $$, :'l', :'big')), '42501', 'Admin: RPC an fremder Anzeige 42501');
select is(tests.qa6_err(format($$ update listings set display_location = 'SRID=4326;POINT(13.95 50.95)' where id = %L $$, :'l')), '42501',
  'Admin: direkter Punkt an fremder Anzeige 42501');
select tests.as_postgres();
select is((select count(*)::int from listings l join regions r on r.id = l.region_id
           where not extensions.st_equals(l.map_point, coalesce(l.display_location::extensions.geometry, r.centroid::extensions.geometry))), 0,
  'Alle Zeilen: map_point = coalesce(display_location, Kreismittelpunkt)');

-- 3. p_point-Vertrag
select tests.authenticate_as(:'o');
select display_location::text as stored from listings where id = :'l' \gset
select is(tests.qa6_err(format($$ select set_listing_location(%L, %L, null, null, 'set', 'Infinity', 13.95) $$, :'l', :'big')), '22023 point', 'set mit Infinity: 22023');
select is(tests.qa6_err(format($$ select set_listing_location(%L, %L, null, null, 'set', 50.95, '-Infinity') $$, :'l', :'big')), '22023 point', 'set mit -Infinity: 22023');
select todo('F5: set ohne Koordinaten entfernt den Punkt still', 2);
select is(tests.qa6_err(format($$ select set_listing_location(%L, %L, null, null, 'set', null, 13.95) $$, :'l', :'big')), '22023 point', 'set ohne lat: 22023');
select is((select display_location::text from listings where id = :'l'), :'stored', 'set ohne lat lässt den Punkt stehen');
-- Zurückgeschickter Punkt verschiebt erneut (deshalb nie vorbelegen, B3)
select lives_ok(format($$ select set_listing_location(%L, %L, null, null, 'set', 50.95, 13.95) $$, :'l', :'big'), 'Punkt neu gesetzt');
select extensions.st_x(display_location::extensions.geometry) as sx, extensions.st_y(display_location::extensions.geometry) as sy from listings where id = :'l' \gset
select set_listing_location(:'l', :'big', null, null, 'set', :'sy', :'sx');
select ok(extensions.st_distance((select display_location from listings where id = :'l'),
  extensions.st_setsrid(extensions.st_makepoint(:'sx', :'sy'), 4326)::extensions.geography) > 2000,
  'Zurückgeschickter öffentlicher Punkt wird erneut um 3–5 km verschoben');
select tests.as_postgres();

-- 4. bbox: Rand eingeschlossen, Kreismittelpunkt-Semantik, mehr als 4 Stellen, gleiche Menge
insert into listings (owner_id, kind, direction, title, content_language, region_id, status, expires_at) values
  (:'o', 'helper', 'wanted', 'QA6 Mitte', 'de', :'big', 'active', now() + interval '30 days') returning id as lc \gset
select extensions.st_x(:'big_c'::extensions.geography::extensions.geometry) as cx, extensions.st_y(:'big_c'::extensions.geography::extensions.geometry) as cy \gset
create function tests.qa6_ids(f jsonb) returns uuid[] language sql as $$
  select array(select (e ->> 'id')::uuid from jsonb_array_elements(public.map_listings(f) -> 'points') e order by 1);
$$;
create function tests.qa6_sids(f jsonb) returns uuid[] language sql as $$
  select array(select (e ->> 'id')::uuid from jsonb_array_elements(public.search_listings(f, null, 50) -> 'items') e order by 1);
$$;
grant execute on function tests.qa6_ids(jsonb), tests.qa6_sids(jsonb) to anon;
select tests.as_anon();
select ok(:'lc'::uuid = any (tests.qa6_ids(jsonb_build_object('v', 1, 'bbox', jsonb_build_array(:'cx'::float8, :'cy'::float8, :'cx'::float8 + 1, :'cy'::float8 + 1)))),
  'Mittelpunkt genau auf der West-/Südkante: enthalten');
select ok(:'lc'::uuid = any (tests.qa6_ids(jsonb_build_object('v', 1, 'bbox', jsonb_build_array(:'cx'::float8 - 1, :'cy'::float8 - 1, :'cx'::float8, :'cy'::float8)))),
  'Mittelpunkt genau auf der Ost-/Nordkante: enthalten');
select ok(not :'lc'::uuid = any (tests.qa6_ids(jsonb_build_object('v', 1, 'bbox', jsonb_build_array(:'cx'::float8 + 0.02, :'cy'::float8 - 0.2, :'cx'::float8 + 0.4, :'cy'::float8 + 0.2)))),
  'Bereich über dem Kreis, aber ohne Mittelpunkt: Anzeige ohne Punkt fehlt (Karte)');
select ok(not :'lc'::uuid = any (tests.qa6_sids(jsonb_build_object('v', 1, 'bbox', jsonb_build_array(:'cx'::float8 + 0.02, :'cy'::float8 - 0.2, :'cx'::float8 + 0.4, :'cy'::float8 + 0.2)))),
  'dasselbe in der Suche');
select is(private.search_filters_error('{"v":1,"bbox":[13.123456789,50.1,14.987654321,51.2]}'), null, 'Mehr als 4 Nachkommastellen: gültig (iOS frei)');
select todo('F6: Unterlauf in bbox ergibt 22003 statt 22023', 1);
select is(tests.qa6_err($$ select map_listings('{"v":1,"bbox":[1e-400,45,10,50]}') $$), '22023 bbox', 'bbox 1e-400: 22023');

-- 5. Ausgabe genau wie gespeichert (ADR 016 „ohne eigene Rundung“), auch unter extra_float_digits = 0 (Supabase)
select tests.as_postgres();
update listings set status = 'active', expires_at = now() + interval '30 days' where id = :'l';
set local extra_float_digits = 0;
select tests.as_anon();
select todo('F4: map_listings und listing_card runden auf 15 Stellen', 1);
select is((select (e ->> 'lng')::float8 = (select extensions.st_x(map_point) from public.listings where id = :'l')
                 and (e ->> 'lat')::float8 = (select extensions.st_y(map_point) from public.listings where id = :'l')
           from jsonb_array_elements(map_listings('{"v":1,"bbox":[13,50.5,14.8,51.4]}') -> 'points') e
           where (e ->> 'id')::uuid = :'l'), true,
  'Kartenpunkt bitgenau wie map_point');

select * from finish();
rollback;
