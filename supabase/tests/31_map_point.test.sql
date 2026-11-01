begin;
\ir _helpers.psql
select plan(20);

-- M6 Commit 2 (ADR 016): map_point (Review B2), regions.area_km2, bbox im Filterformat v1 (A3), gemeinsame
-- Bedingungen für Suche und Karte (A4).
set constraints all immediate;

select tests.create_user('mp-owner@test.local') as o \gset
select tests.create_user('mp-admin@test.local') as adm \gset
select tests.make_admin(:'adm');
select id as dd, centroid::extensions.geometry as dd_c from regions where code = 'DE-14628' \gset
select id as muc, centroid::extensions.geometry as muc_c from regions where code = 'DE-09162' \gset
-- Eingabepunkt 2 km nördlich vom Mittelpunkt des Kreises Sächsische Schweiz-Osterzgebirge (Dresden selbst ist unter 400 km²)
select extensions.st_project(centroid, 2000, 0)::extensions.geometry as raw from regions where code = 'DE-14628' \gset

-- Fläche je Region
select is((select count(*)::int from regions where area_km2 is null or area_km2 <= 0), 0, 'Alle Regionen haben eine Fläche');
select ok((select area_km2 from regions where code = 'DE-09162') between 300 and 320, 'München hat etwa 311 km²');

-- Ohne Punkt: Kreismittelpunkt
select tests.authenticate_as(:'o');
insert into listings (kind, direction, title, content_language, region_id) values ('helper', 'wanted', 'Kartenpunkt', 'de', :'dd')
returning id as l \gset
select ok(extensions.st_equals((select map_point from listings where id = :'l'), :'dd_c'::extensions.geometry), 'Ohne Punkt: Kreismittelpunkt');

-- Mit Punkt: der verfremdete Punkt, nie der Eingabepunkt (B2)
update listings set display_location = (:'raw'::extensions.geometry)::extensions.geography where id = :'l';
select ok(extensions.st_equals((select map_point from listings where id = :'l'), (select display_location::extensions.geometry from listings where id = :'l')),
  'Mit Punkt: map_point = display_location');
select ok((select extensions.st_distance(map_point::extensions.geography, (:'raw'::extensions.geometry)::extensions.geography) from listings where id = :'l')
  between 2293 and 5707, 'map_point liegt 3–5 km (plus Zelle) vom Eingabepunkt');
select tests.as_postgres();
select is((select count(*)::int from listings where extensions.st_dwithin(map_point::extensions.geography, (:'raw'::extensions.geometry)::extensions.geography, 1000)), 0,
  'Kein map_point innerhalb 1 km um die Eingabe');

-- Direkt schreiben überschreibt der Trigger (auch service_role und postgres)
update listings set map_point = :'raw'::extensions.geometry where id = :'l';
select ok(not extensions.st_dwithin((select map_point from listings where id = :'l')::extensions.geography, (:'raw'::extensions.geometry)::extensions.geography, 1000),
  'Direktes Setzen von map_point wird überschrieben');
set local role service_role;
update listings set map_point = :'raw'::extensions.geometry where id = :'l';
reset role;
select tests.as_postgres();
select ok(not extensions.st_dwithin((select map_point from listings where id = :'l')::extensions.geography, (:'raw'::extensions.geometry)::extensions.geography, 1000),
  'Auch als service_role überschrieben');

-- Kreiswechsel ohne Punkt: neuer Kreismittelpunkt (der Trigger der Verfremdung löscht den Punkt)
select tests.authenticate_as(:'o');
update listings set region_id = :'muc' where id = :'l';
select ok(extensions.st_equals((select map_point from listings where id = :'l'), :'muc_c'::extensions.geometry), 'Kreiswechsel: neuer Kreismittelpunkt');

-- Moderator entfernt den Punkt: Kreismittelpunkt
update listings set region_id = :'dd' where id = :'l';
update listings set display_location = (:'raw'::extensions.geometry)::extensions.geography where id = :'l';
select tests.authenticate_as(:'adm', 'aal2');
update listings set display_location = null where id = :'l';
select ok(extensions.st_equals((select map_point from listings where id = :'l'), :'dd_c'::extensions.geometry), 'Punkt entfernt: Kreismittelpunkt');

-- map_point gehört nicht zum Inhalts-Hash, ist für anon lesbar wie display_location, nie direkt schreibbar
select tests.as_postgres();
select is(private.listing_content_hash(:'l') = private.listing_content_hash(:'l'), true, 'Hash berechenbar');
select ok(position('map_point' in (select pg_get_functiondef('private.listing_content_hash(uuid)'::regprocedure))) > 0,
  'map_point steht in der Ausschlussliste des Hashes');
select is(has_column_privilege('authenticated', 'public.listings', 'map_point', 'UPDATE'), false, 'Kein UPDATE-Recht auf map_point');
select is(has_column_privilege('authenticated', 'public.listings', 'map_point', 'INSERT'), false, 'Kein INSERT-Recht auf map_point');

-- bbox im Filter
select is(private.search_filters_error('{"v":1,"bbox":[5.8,47.2,17.2,55.1]}'), null, 'bbox DE+AT gültig');
select is(private.search_filters_error('{"v":1,"bbox":[5,47,40,55]}'), 'bbox', 'bbox breiter als 30°');
select is(private.search_filters_error('{"v":1,"bbox":[13,51,12,52]}'), 'bbox', 'west > east');
select is(private.search_filters_error('{"v":1,"bbox":[13,51,"14",52]}'), 'bbox', 'bbox mit Text');

-- Suche mit bbox: map_point im Rechteck, ohne Punkt der Kreismittelpunkt
insert into listings (owner_id, kind, direction, title, content_language, region_id, status, expires_at) values
  (:'o', 'helper', 'wanted', 'Bereich Pirna', 'de', :'dd', 'active', now() + interval '30 days'),
  (:'o', 'helper', 'wanted', 'Bereich München', 'de', :'muc', 'active', now() + interval '30 days');
select tests.as_anon();
select is(array(select e ->> 'title' from jsonb_array_elements(search_listings(
    jsonb_build_object('v', 1, 'bbox', jsonb_build_array(
      extensions.st_x(:'dd_c'::extensions.geometry) - 0.1, extensions.st_y(:'dd_c'::extensions.geometry) - 0.1,
      extensions.st_x(:'dd_c'::extensions.geometry) + 0.1, extensions.st_y(:'dd_c'::extensions.geometry) + 0.1))) -> 'items') e),
  '{Bereich Pirna}'::text[], 'Suche mit bbox um den Kreismittelpunkt findet nur diese Anzeige');
select is(jsonb_array_length(search_listings('{"v":1,"bbox":[0,0,1,1]}') -> 'items'), 0, 'bbox ohne Anzeigen: leer');

select * from finish();
rollback;
