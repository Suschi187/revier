begin;
\ir _helpers.psql
select plan(24);

-- Standortverfremdung v2 (ADR 006, Plan M3 4.3, Review Plan M3 B1–B6).
-- Ring 3–5 km um die Zellmitte; gegenüber dem Eingabepunkt ± halbe Zellendiagonale (707 m).

-- Hilfsfunktionen im Schema tests (für authenticated nutzbar, nur in dieser Transaktion).
create function tests.pt(lon double precision, lat double precision) returns extensions.geography language sql immutable as $$
  select extensions.st_setsrid(extensions.st_makepoint(lon, lat), 4326)::extensions.geography
$$;
create function tests.from3035(x double precision, y double precision) returns extensions.geography language sql immutable as $$
  select extensions.st_transform(extensions.st_setsrid(extensions.st_makepoint(x, y), 3035), 4326)::extensions.geography
$$;
create function tests.cell(p extensions.geography) returns extensions.geography language sql immutable as $$
  select tests.from3035(
    floor(extensions.st_x(extensions.st_transform(p::extensions.geometry, 3035)) / 1000) * 1000 + 500,
    floor(extensions.st_y(extensions.st_transform(p::extensions.geometry, 3035)) / 1000) * 1000 + 500)
$$;
grant execute on function tests.pt(double precision, double precision), tests.from3035(double precision, double precision),
  tests.cell(extensions.geography) to authenticated;

-- Zellmitte nahe 11.3 / 48.05 als Bezug für Punkte, die nachweislich in derselben Zelle liegen.
select extensions.st_x(extensions.st_transform(tests.cell(tests.pt(11.3, 48.05))::extensions.geometry, 3035)) as cx,
       extensions.st_y(extensions.st_transform(tests.cell(tests.pt(11.3, 48.05))::extensions.geometry, 3035)) as cy \gset

select tests.create_user('a@test.local') as a_id \gset
select tests.create_user('b@test.local') as b_id \gset
select tests.create_user('admin@test.local') as admin_id \gset
select tests.make_admin(:'admin_id');
select id as district from regions where code = 'DE-09184' \gset
select id as other_district from regions where code = 'DE-09175' \gset

-- Testpunkte liegen mindestens 2 km von jedem Kreis-Centroid entfernt (sonst schlüge Test 13 falsch an).
select ok(not exists (select 1 from regions r where extensions.st_dwithin(r.centroid, tests.pt(11.3, 48.05), 2000)),
  'Testpunkt liegt fern aller Centroids');

-- 1. Zwei Punkte derselben Zelle ergeben denselben Punkt
select is(tests.cell(tests.from3035(:cx + 200, :cy + 100))::text, tests.cell(tests.from3035(:cx - 250, :cy - 300))::text, 'Beide Testpunkte liegen in derselben Zelle');
select tests.authenticate_as(:'a_id');
insert into listings (kind, direction, title, content_language, region_id, display_location)
values ('lease', 'offer', 'Revier 1', 'de', :'district', tests.from3035(:cx + 200, :cy + 100)) returning id as l1 \gset
insert into listings (kind, direction, title, content_language, region_id, display_location)
values ('permit', 'offer', 'Revier 1, Begehungsschein', 'de', :'district', tests.from3035(:cx - 250, :cy - 300)) returning id as l2 \gset
select is((select display_location::text from listings where id = :'l1'), (select display_location::text from listings where id = :'l2'),
  'Gleicher Besitzer, Kreis und Zelle: identischer Punkt');

-- 2. Zehn Anzeigen über 6 km: Versatz (Distanz und Richtung von der Zellmitte) ist für alle gleich
create temp table inputs as
select n, tests.pt(11.27 + (n % 5) * 0.02, 48.03 + (n / 5) * 0.03) as p from generate_series(0, 9) n;
grant select on inputs to authenticated;
create temp view outputs as select (substring(title from 6))::int as n, id from listings where title like 'Teil %';
grant select on outputs to authenticated;
insert into listings (kind, direction, title, content_language, region_id, display_location)
select 'lease', 'offer', 'Teil ' || n, 'de', :'district', p from inputs;
select ok((select count(*) from outputs) = 10, 'Zehn Anzeigen angelegt');
select ok((select max(extensions.st_distance(i.p, i2.p)) from inputs i, inputs i2) > 6000, 'Eingaben über mehr als 6 km verteilt');
select ok((select max(d) - min(d) < 0.01 and min(d) between 3000 and 5000 from (
    select extensions.st_distance(tests.cell(i.p), l.display_location) d
    from outputs o join inputs i using (n) join listings l on l.id = o.id) x),
  'Distanz zur Zellmitte ist für alle Anzeigen gleich und liegt im Ring 3–5 km');
select ok((select max(az) - min(az) < 1e-6 from (
    select extensions.st_azimuth(tests.cell(i.p), l.display_location) az
    from outputs o join inputs i using (n) join listings l on l.id = o.id) x),
  'Richtung von der Zellmitte ist für alle Anzeigen gleich (konstanter Versatz)');
select ok((select extensions.st_distance(
      extensions.st_centroid(extensions.st_collect(extensions.st_transform(i.p::extensions.geometry, 3035))),
      extensions.st_centroid(extensions.st_collect(extensions.st_transform(l.display_location::extensions.geometry, 3035))))
    between 2280 and 5720
    from outputs o join inputs i using (n) join listings l on l.id = o.id),
  'Mittel der Ausgaben bleibt 2,28–5,72 km neben dem Mittel der Eingaben (kein Herausmitteln)');

-- 3. Stabil bei Updates
select display_location::text as first from listings where id = :'l1' \gset
update listings set display_location = tests.pt(11.3, 48.05) where id = :'l1';
update listings set display_location = tests.pt(11.3, 48.05) where id = :'l1';
update listings set title = 'Revier 1, neu' where id = :'l1';
select is((select display_location::text from listings where id = :'l1'), :'first', 'Wiederholte Updates und Titeländerung lassen den Punkt gleich');
update listings set display_location = (select display_location from listings where id = :'l1') where id = :'l1';
select is((select display_location::text from listings where id = :'l1'), :'first', 'Zurückgeschickter gelesener Wert bleibt unverändert');

-- Zellgrenze: 10 m Abstand über die Grenze ergibt 1 km Abstand der Ausgaben (beabsichtigt, ADR 006)
create temp table border as
with c as (select extensions.st_transform(tests.pt(11.3, 48.05)::extensions.geometry, 3035) g)
select extensions.st_transform(extensions.st_setsrid(extensions.st_makepoint(floor(extensions.st_x(g) / 1000) * 1000 - 5, extensions.st_y(g)), 3035), 4326)::extensions.geography as west,
       extensions.st_transform(extensions.st_setsrid(extensions.st_makepoint(floor(extensions.st_x(g) / 1000) * 1000 + 5, extensions.st_y(g)), 3035), 4326)::extensions.geography as east
from c;
grant select on border to authenticated;
insert into listings (kind, direction, title, content_language, region_id, display_location)
select 'helper', 'offer', 'Grenze West', 'de', :'district', west from border;
insert into listings (kind, direction, title, content_language, region_id, display_location)
select 'helper', 'offer', 'Grenze Ost', 'de', :'district', east from border;
select ok((select extensions.st_distance(w.display_location, e.display_location) between 990 and 1010
    from listings w, listings e where w.title = 'Grenze West' and e.title = 'Grenze Ost'),
  'Zwei Punkte 10 m auseinander über eine Zellgrenze liegen 1 km auseinander');

-- 4. Kein Orakel: anderer Besitzer, gleicher Punkt → anderer Punkt
select tests.authenticate_as(:'b_id');
insert into listings (kind, direction, title, content_language, region_id, display_location)
values ('lease', 'offer', 'Fremd am selben Ort', 'de', :'district', tests.pt(11.3, 48.05)) returning id as lb \gset
select isnt((select display_location::text from listings where id = :'lb'), :'first', 'Anderer Besitzer am selben Ort bekommt einen anderen Punkt');

-- 5. Streuung über 40 Besitzer: alle im Ring, Richtungen verteilt
select tests.as_postgres();
create temp table spread as
select tests.create_user('s' || n || '@test.local') as uid from generate_series(1, 40) n;
grant select on spread to authenticated;
create temp table spread_out (uid uuid, loc extensions.geography);
grant insert, select on spread_out to authenticated;
do $$
declare
  u uuid;
  loc extensions.geography;
begin
  for u in select uid from spread loop
    perform tests.authenticate_as(u);
    insert into public.listings (kind, direction, title, content_language, region_id, display_location)
    values ('helper', 'wanted', 'Streuung', 'de', (select id from public.regions where code = 'DE-09184'),
            extensions.st_setsrid(extensions.st_makepoint(11.3, 48.05), 4326)::extensions.geography)
    returning display_location into loc;
    insert into spread_out values (u, loc);
    perform tests.as_postgres();
  end loop;
end;
$$;
select ok((select bool_and(extensions.st_distance(loc, tests.pt(11.3, 48.05)) between 2280 and 5720) from spread_out),
  'Alle Punkte liegen im Ring um den Eingabepunkt (± halbe Zellendiagonale)');
select ok((select count(distinct floor(degrees(extensions.st_azimuth(tests.cell(tests.pt(11.3, 48.05)), loc)) / 45)) >= 6 from spread_out),
  'Richtungen sind über mindestens 6 von 8 Oktanten verteilt');

-- 6. Eingabepunkt steht nirgends
select is((
  select count(*)::int from (
    -- nur Anzeigen, deren Eingabe in der Zelle um 11.3/48.05 lag (andere Eingaben können zufällig in der Nähe landen)
    select 1 from listings where (id in (:'l1', :'lb') or title = 'Streuung')
      and extensions.st_dwithin(display_location, tests.pt(11.3, 48.05), 1000)
    union all select 1 from regions where extensions.st_dwithin(centroid, tests.pt(11.3, 48.05), 1000)) x), 0,
  'Kein gespeicherter Punkt innerhalb 1 km um die Eingabe');
select is(array(
  select table_schema || '.' || table_name || '.' || column_name from information_schema.columns
  where udt_name in ('geography', 'geometry') and table_schema not in ('extensions', 'tiger', 'topology') and table_schema not like 'pg_temp%'
  order by 1), array['public.listings.display_location', 'public.regions.centroid'],
  'Es gibt keine weiteren Geo-Spalten, in denen der Punkt landen könnte');

-- 7. Unplausibler Punkt
select tests.authenticate_as(:'a_id');
select throws_ok(format($$ insert into listings (kind, direction, title, content_language, region_id, display_location)
  values ('lease', 'offer', 'Weit weg', 'de', %L, 'SRID=4326;POINT(13.0 48.9)') $$, :'district'), '23514', null,
  'Punkt über 80 km vom Kreis-Centroid wird abgelehnt');

-- Kreiswechsel ohne neuen Punkt setzt den Punkt auf null (B3)
update listings set region_id = :'other_district' where id = :'l2';
select is((select display_location from listings where id = :'l2'), null, 'Kreiswechsel ohne Punkt entfernt den alten Punkt');

-- 8. Admin setzt keinen Punkt an fremden Anzeigen (B1), darf ihn aber entfernen
select tests.authenticate_as(:'admin_id', 'aal2');
select throws_ok(format($$ update listings set display_location = 'SRID=4326;POINT(11.31 48.06)' where id = %L $$, :'lb'),
  '42501', null, 'Admin setzt keinen Punkt an fremden Anzeigen (Orakel)');

select lives_ok(format($$ update listings set display_location = null where id = %L $$, :'lb'), 'Admin darf einen Punkt entfernen');

-- Ableitung und Secret sind nicht erreichbar (B2)
select tests.as_postgres();
select ok(not has_function_privilege('authenticated', 'private.listings_blur_location()', 'execute')
  and not has_function_privilege('anon', 'private.listings_blur_location()', 'execute')
  and not has_function_privilege('service_role', 'private.listings_blur_location()', 'execute'),
  'Verfremdungsfunktion ist für keine API-Rolle ausführbar');
select ok(not has_table_privilege('authenticated', 'vault.decrypted_secrets', 'select')
  and not has_table_privilege('anon', 'vault.decrypted_secrets', 'select')
  and not has_table_privilege('authenticated', 'vault.secrets', 'select'),
  'Secret ist für anon/authenticated nicht lesbar');
-- service_role darf vault lesen (Supabase-Standard, Grant von supabase_admin, per Migration nicht entziehbar;
-- ADR 006, QA M3 F4). Deshalb darf außer dem Trigger keine Funktion und keine View vault verwenden.
select set_eq($$ select n.nspname || '.' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname not in ('vault', 'pg_catalog', 'information_schema') and p.prosrc ~* 'vault\.'
  union all select schemaname || '.' || viewname from pg_views where schemaname <> 'vault' and definition ~* 'vault\.' $$,
  array['private.listings_blur_location'], 'Nur die Verfremdungsfunktion verwendet vault');

-- Falscher Fingerprint (Restore mit fremdem Secret): fail closed (B6)
update private.app_settings set value = '"falsch"' where key = 'listing_location_key_fp';
select tests.authenticate_as(:'a_id');
select throws_ok(format($$ update listings set display_location = 'SRID=4326;POINT(11.32 48.07)' where id = %L $$, :'l1'),
  'RV003', null, 'Passt der Fingerprint nicht, wird kein Punkt berechnet');

select * from finish();
rollback;
