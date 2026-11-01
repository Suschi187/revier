begin;
\ir _helpers.psql
select plan(16);

-- M6 Commit 3 (ADR 016, Review A4, A6): map_listings mit derselben Sichtbarkeit und denselben Bedingungen wie die
-- Suche, Punkt in den Trefferkarten, Cache-Zähler beim Entfernen eines Punkts.
set constraints all immediate;

create function tests.map_ids(f jsonb) returns uuid[] language sql as $$
  select array(select (e ->> 'id')::uuid from jsonb_array_elements(public.map_listings(f) -> 'points') e order by 1);
$$;
create function tests.search_ids(f jsonb) returns uuid[] language sql as $$
  select array(select (e ->> 'id')::uuid from jsonb_array_elements(public.search_listings(f, null, 50) -> 'items') e order by 1);
$$;
grant execute on function tests.map_ids(jsonb), tests.search_ids(jsonb) to anon, authenticated, service_role;
grant usage on schema tests to service_role;

select tests.create_user('ml-owner@test.local') as o \gset
select tests.create_user('ml-blocked@test.local') as b \gset
select tests.create_user('ml-admin@test.local') as adm \gset
select tests.make_admin(:'adm');
select id as dd from regions where code = 'DE-14612' \gset
select id as muc from regions where code = 'DE-09162' \gset
select id as kb from regions where code = 'AT-704' \gset

insert into listings (owner_id, kind, direction, title, content_language, region_id, status, expires_at, price_minor, currency, price_unit) values
  (:'o', 'lease', 'offer', 'ML Dresden', 'de', :'dd', 'active', now() + interval '30 days', 500000, 'EUR', 'per_year'),
  (:'o', 'permit', 'offer', 'ML München', 'de', :'muc', 'active', now() + interval '30 days', null, null, null),
  (:'o', 'lease', 'wanted', 'ML Kitzbühel', 'de', :'kb', 'active', now() + interval '30 days', null, null, null),
  (:'o', 'lease', 'offer', 'ML Entwurf', 'de', :'dd', 'draft', null, null, null, null),
  (:'o', 'lease', 'offer', 'ML Abgelaufen', 'de', :'dd', 'active', now() - interval '1 day', null, null, null),
  (:'b', 'lease', 'offer', 'ML Gesperrt', 'de', :'dd', 'active', now() + interval '30 days', null, null, null);
update profiles set is_blocked = true where user_id = :'b';
select id as l_dd from listings where title = 'ML Dresden' \gset

\set wide '{"v":1,"bbox":[5.8,45.0,17.2,55.1]}'
select array(select id from listings where title in ('ML Dresden', 'ML München', 'ML Kitzbühel') order by id) as public_ids \gset

-- Dieselbe Menge für alle Rollen (B1 aus M5)
select tests.as_anon();
select is(tests.map_ids(:'wide'), :'public_ids'::uuid[], 'anon: nur öffentliche Anzeigen');
select tests.authenticate_as(:'o');
select is(tests.map_ids(:'wide'), :'public_ids'::uuid[], 'Besitzer: keine eigenen Entwürfe oder abgelaufenen');
select tests.authenticate_as(:'b');
select is(tests.map_ids(:'wide'), :'public_ids'::uuid[], 'Gesperrter Besitzer: nicht seine eigenen');
select tests.authenticate_as(:'adm', 'aal2');
select is(tests.map_ids(:'wide'), :'public_ids'::uuid[], 'Admin mit 2FA: keine Anzeigen gesperrter Konten');
select tests.as_postgres();
set local role service_role;
select is(tests.map_ids(:'wide'), :'public_ids'::uuid[], 'service_role (ohne RLS): gleiche Menge');
reset role;

-- Gleiche Bedingungen wie die Suche (A4)
select tests.as_anon();
select is(tests.map_ids('{"v":1,"bbox":[5.8,45.0,17.2,55.1],"kind":"lease"}'), tests.search_ids('{"v":1,"bbox":[5.8,45.0,17.2,55.1],"kind":"lease"}'),
  'Art: Karte = Suche');
select is(tests.map_ids('{"v":1,"bbox":[5.8,45.0,17.2,55.1],"country":"AT"}'), tests.search_ids('{"v":1,"bbox":[5.8,45.0,17.2,55.1],"country":"AT"}'),
  'Land: Karte = Suche');
select is(tests.map_ids('{"v":1,"bbox":[5.8,45.0,17.2,55.1],"currency":"EUR","price_max":600000}'),
  tests.search_ids('{"v":1,"bbox":[5.8,45.0,17.2,55.1],"currency":"EUR","price_max":600000}'), 'Preis: Karte = Suche');
select is(tests.map_ids('{"v":1,"bbox":[5.8,45.0,17.2,55.1],"q":"Kitzbühel"}'), tests.search_ids('{"v":1,"bbox":[5.8,45.0,17.2,55.1],"q":"Kitzbühel"}'),
  'Volltext: Karte = Suche');

-- bbox Pflicht, Fehler wie die Suche
select throws_ok($$ select public.map_listings('{"v":1}') $$, '22023', null, 'Ohne bbox: 22023');
select throws_ok($$ select public.map_listings('{"v":1,"bbox":[5,47,40,55]}') $$, '22023', null, 'bbox zu breit: 22023');

-- Felder: ohne owner_id, PLZ, Präfix; Punkt ohne Wert gesetzt = Kreismittelpunkt mit approx district
select is((select count(*)::int from jsonb_array_elements(map_listings(:'wide') -> 'points') e, jsonb_object_keys(e) k
           where k in ('owner_id', 'postal_prefix', 'postal_code', 'place_name', 'description')), 0,
  'Kartenpunkte ohne owner_id, PLZ, Ort und Beschreibung');
select ok((select bool_and(e ->> 'approx' = 'district'
                  and (e ->> 'lng')::float8 = extensions.st_x(r.centroid::extensions.geometry)
                  and (e ->> 'lat')::float8 = extensions.st_y(r.centroid::extensions.geometry))
           from jsonb_array_elements(map_listings(:'wide') -> 'points') e join regions r on r.code = e ->> 'district_code'),
  'Ohne Punkt: genau der Kreismittelpunkt, approx district');
select is((select e -> 'approx' from jsonb_array_elements(search_listings('{"v":1,"q":"ML Dresden"}') -> 'items') e), '"district"'::jsonb,
  'Trefferkarte der Suche trägt approx und point');

-- Limit 2000 und truncated
select tests.as_postgres();
insert into listings (owner_id, kind, direction, title, content_language, region_id, status, expires_at)
select :'o', 'helper', 'wanted', 'ML Viele ' || g, 'de', :'dd', 'active', now() + interval '30 days' from generate_series(1, 2000) g;
select tests.as_anon();
select is((select jsonb_array_length(m -> 'points') || ':' || (m ->> 'truncated') from (select map_listings(:'wide') m) x), '2000:true',
  'Höchstens 2000 Punkte, truncated');

-- Cache-Zähler: Entfernen eines Punkts wirkt sofort (A6)
select tests.authenticate_as(:'o');
insert into listings (kind, direction, title, content_language, region_id) values ('helper', 'wanted', 'ML Punkt', 'de', :'dd')
returning id as l_pt \gset
update listings set display_location = extensions.st_project((select centroid from regions where id = :'dd'), 2000, 0) where id = :'l_pt';
select tests.as_postgres();
select tests.make_ready(:'l_pt');
update listings set status = 'active', expires_at = now() + interval '30 days' where id = :'l_pt';
select public_cache_epoch() as e0 \gset
select tests.authenticate_as(:'adm', 'aal2');
update listings set display_location = null where id = :'l_pt';
select tests.as_postgres();
select is(public_cache_epoch(), :'e0'::bigint + 1, 'Moderator entfernt den Punkt: Cache-Zähler steigt');

select * from finish();
rollback;
