begin;
\ir _helpers.psql
select plan(45);

-- M5 Commit 3 (ADR 015): listing_is_public (B1), search_listings mit Filter v1 (A1, A2), Regionszähler (A7).
-- Weitere Filterfälle aus fixtures/search_filters.json prüfen Zod (Vitest) und die RPC (Integration).
set constraints all immediate;

create function tests.titles(f jsonb, c text default null, lim integer default 20)
returns text[] language sql as $$
  select array(select e ->> 'title' from jsonb_array_elements(public.search_listings(f, c, lim) -> 'items') with ordinality t(e, n) order by n);
$$;
create function tests.search_hint(f jsonb, c text default null, lim integer default 20)
returns text language plpgsql as $$
declare h text;
begin
  perform public.search_listings(f, c, lim);
  return null;
exception when sqlstate '22023' then
  get stacked diagnostics h = pg_exception_hint;
  return h;
end;
$$;
grant execute on function tests.titles(jsonb, text, integer), tests.search_hint(jsonb, text, integer) to anon, authenticated, service_role;
grant usage on schema tests to service_role;

select tests.create_user('s-owner@test.local') as o1 \gset
select tests.create_user('s-verified@test.local') as o2 \gset
select tests.create_user('s-blocked@test.local') as o3 \gset
select tests.create_user('s-admin@test.local') as adm \gset
select tests.make_admin(:'adm');
update profiles set verification_status = 'verified' where user_id = :'o2';

select id as muc from regions where code = 'DE-09162' \gset
select id as dd from regions where code = 'DE-14612' \gset
select id as kb from regions where code = 'AT-704' \gset

-- Öffentliche Anzeigen (Server-Pfad, Ablauf in 30 Tagen)
insert into listings (owner_id, kind, direction, title, description, content_language, region_id, status, expires_at,
                      price_minor, currency, price_unit, area_hectares, start_date, end_date, attributes) values
  (:'o1', 'lease', 'offer', 'Rehwild Revier im Hügelland', 'Gutes Rehwild, Hochsitze vorhanden.', 'de', :'muc', 'active', now() + interval '30 days',
   500000, 'EUR', 'per_year', 300, null, null, '{}'),
  (:'o2', 'permit', 'offer', 'Begehungsschein Rotwild', 'Rotwild und Schwarzwild im Bergwald.', 'de', :'dd', 'active', now() + interval '30 days',
   20000, 'EUR', 'per_year', null, '2026-05-01', '2026-12-31', '{}'),
  (:'o1', 'lease', 'offer', 'Red deer hunting ground', 'Large forest with red deer and chamois.', 'en', :'kb', 'active', now() + interval '30 days',
   800000, 'EUR', 'per_year', 1000, null, null, '{}'),
  (:'o2', 'driven_hunt', 'offer', 'Společný hon na černou zvěř', 'Hon na černou zvěř v listopadu, ubytování.', 'cs', :'muc', 'active', now() + interval '30 days',
   150000, 'CZK', 'per_day', null, null, null, '{"event_date": "2026-11-20", "spots_available": 10}');
-- Nicht öffentlich: Entwurf, Prüfung, abgelaufen, gesperrter Besitzer
insert into listings (owner_id, kind, direction, title, content_language, region_id, status, expires_at) values
  (:'o1', 'lease', 'offer', 'Entwurf Rehwild', 'de', :'muc', 'draft', null),
  (:'o1', 'lease', 'offer', 'Prüfung Rehwild', 'de', :'muc', 'pending_review', null),
  (:'o1', 'lease', 'offer', 'Abgelaufen Rehwild', 'de', :'muc', 'active', now() - interval '1 day'),
  (:'o3', 'lease', 'offer', 'Gesperrt Rehwild', 'de', :'muc', 'active', now() + interval '30 days');
update profiles set is_blocked = true where user_id = :'o3';

insert into listing_species (listing_id, species_code)
select id, 'roe_deer' from listings where title = 'Rehwild Revier im Hügelland'
union all select id, 'red_deer' from listings where title = 'Begehungsschein Rotwild'
union all select id, 'wild_boar' from listings where title = 'Begehungsschein Rotwild';

-- Reihenfolge der Veröffentlichung festlegen (der Trigger hält published_at sonst fest)
alter table listings disable trigger listings_zz_publication_fields;
update listings set published_at = now() - interval '3 days' where title = 'Rehwild Revier im Hügelland';
update listings set published_at = now() - interval '2 days' where title = 'Begehungsschein Rotwild';
update listings set published_at = now() - interval '1 day' where title = 'Red deer hunting ground';
update listings set published_at = now() - interval '1 hour' where title = 'Společný hon na černou zvěř';
alter table listings enable trigger listings_zz_publication_fields;

\set all '{Společný hon na černou zvěř,Red deer hunting ground,Begehungsschein Rotwild,Rehwild Revier im Hügelland}'

-- B1: dieselbe Menge für anon, Besitzer, fremde Nutzer, Admin (aal2), gesperrten Besitzer und service_role
select tests.as_anon();
select is(tests.titles('{"v":1}'), :'all'::text[], 'anon: nur öffentliche Anzeigen, neueste zuerst');
select tests.authenticate_as(:'o1');
select is(tests.titles('{"v":1}'), :'all'::text[], 'Besitzer sieht keine eigenen Entwürfe, Prüfungen oder abgelaufenen');
select tests.authenticate_as(:'o2');
select is(tests.titles('{"v":1}'), :'all'::text[], 'Fremder Nutzer: gleiche Menge');
select tests.authenticate_as(:'adm', 'aal2');
select is(tests.titles('{"v":1}'), :'all'::text[], 'Admin mit 2FA sieht keine Anzeigen gesperrter Konten');
select tests.authenticate_as(:'o3');
select is(tests.titles('{"v":1}'), :'all'::text[], 'Gesperrter Besitzer sieht die eigenen nicht');
select tests.as_postgres();
set local role service_role;
select is(tests.titles('{"v":1}'), :'all'::text[], 'service_role (ohne RLS): gleiche Menge');
reset role;
select tests.as_postgres();

-- Policy nutzt dieselbe Definition
select tests.as_anon();
select is((select count(*)::int from listings where title like 'Gesperrt%' or title like 'Abgelaufen%'), 0,
  'Policy: anon liest keine abgelaufenen und keine Anzeigen gesperrter Besitzer');
select is((select count(*)::int from public_profiles where user_id = :'o3'), 0, 'Gesperrter Anbieter nicht in public_profiles');

-- Filter einzeln und kombiniert (Akzeptanz a)
select is(tests.titles('{"v":1,"country":"DE"}'), '{Společný hon na černou zvěř,Begehungsschein Rotwild,Rehwild Revier im Hügelland}'::text[], 'Land DE');
select is(tests.titles('{"v":1,"country":"AT"}'), '{Red deer hunting ground}'::text[], 'Land AT');
select is(tests.titles('{"v":1,"region":"DE-BY"}'), '{Společný hon na černou zvěř,Rehwild Revier im Hügelland}'::text[], 'Bundesland schließt seine Kreise ein');
select is(tests.titles('{"v":1,"region":"DE-09162"}'), '{Společný hon na černou zvěř,Rehwild Revier im Hügelland}'::text[], 'Kreis');
select is(tests.titles('{"v":1,"region":"DE-SN"}'), '{Begehungsschein Rotwild}'::text[], 'anderes Bundesland');
select is(tests.titles('{"v":1,"kind":"lease"}'), '{Red deer hunting ground,Rehwild Revier im Hügelland}'::text[], 'Art');
select is(tests.titles('{"v":1,"kind":"lease","country":"DE"}'), '{Rehwild Revier im Hügelland}'::text[], 'Art und Land');
select is(tests.titles('{"v":1,"direction":"wanted"}'), '{}'::text[], 'Richtung Gesuch: keine');
select is(tests.titles('{"v":1,"currency":"EUR","price_max":600000}'), '{Begehungsschein Rotwild,Rehwild Revier im Hügelland}'::text[], 'Preis bis 6.000 EUR');
select is(tests.titles('{"v":1,"currency":"EUR","price_min":600000}'), '{Red deer hunting ground}'::text[], 'Preis ab 6.000 EUR');
select is(tests.titles('{"v":1,"currency":"CZK"}'), '{Společný hon na černou zvěř}'::text[], 'Keine Umrechnung: CZK nur CZK');
select is(tests.titles('{"v":1,"currency":"PLN","price_max":100000000}'), '{}'::text[], 'Keine Umrechnung: PLN findet keine EUR-Anzeigen');
select is(tests.titles('{"v":1,"species":["red_deer"]}'), '{Begehungsschein Rotwild}'::text[], 'Wildart');
select is(tests.titles('{"v":1,"species":["roe_deer","wild_boar"]}'), '{Begehungsschein Rotwild,Rehwild Revier im Hügelland}'::text[], 'mindestens eine Wildart');
select is(tests.titles('{"v":1,"area_min":500}'), '{Red deer hunting ground}'::text[], 'Fläche; ohne Fläche fällt heraus');
select is(tests.titles('{"v":1,"date_from":"2026-06-01"}'), '{Begehungsschein Rotwild}'::text[], 'Zeitraum; ohne Datum fällt heraus');
select is(tests.titles('{"v":1,"date_to":"2026-04-30"}'), '{}'::text[], 'Zeitraum vor Beginn');
select is(tests.titles('{"v":1,"kind":"driven_hunt","date_from":"2026-11-01","date_to":"2026-11-30"}'), '{Společný hon na černou zvěř}'::text[],
  'Gesellschaftsjagd: event_date zählt');
select is(tests.titles('{"v":1,"kind":"driven_hunt","date_from":"2026-12-01"}'), '{}'::text[], 'Gesellschaftsjagd nach dem Termin');
select is(tests.titles('{"v":1,"verified_only":true}'), '{Společný hon na černou zvěř,Begehungsschein Rotwild}'::text[], 'nur verifizierte Anbieter');

-- Volltext in drei Konfigurationen (de gestemmt, en, cs wörtlich)
select is(tests.titles('{"v":1,"q":"Rehwildes"}'), '{Rehwild Revier im Hügelland}'::text[], 'Volltext deutsch (Stemming)');
select is(tests.titles('{"v":1,"q":"chamois"}'), '{Red deer hunting ground}'::text[], 'Volltext englisch');
select is(tests.titles('{"v":1,"q":"černou"}'), '{Společný hon na černou zvěř}'::text[], 'Volltext tschechisch (simple)');
select is(tests.titles('{"v":1,"q":"\"Rotwild\" -Bergwald or ''); drop table listings; --"}'), '{}'::text[], 'Sonderzeichen in q sind nur Text');
select is(tests.search_hint(jsonb_build_object('v', 1, 'q', repeat('wort ', 39) || 'wort')), 'q', 'Zu viele Suchterme ergeben 22023 (q)');

-- Sortierung und Paging
select is(tests.titles('{"v":1,"currency":"EUR","price_unit":"per_year","sort":"price_asc"}'),
  '{Begehungsschein Rotwild,Rehwild Revier im Hügelland,Red deer hunting ground}'::text[], 'Preis aufsteigend');
select is(tests.titles('{"v":1,"currency":"EUR","price_unit":"per_year","sort":"price_desc"}'),
  '{Red deer hunting ground,Rehwild Revier im Hügelland,Begehungsschein Rotwild}'::text[], 'Preis absteigend');
select search_listings('{"v":1}', null, 2) as page1 \gset
select is((:'page1'::jsonb -> 'total')::int, 4, 'Gesamtzahl');
select is(tests.titles('{"v":1}', :'page1'::jsonb ->> 'next_cursor', 2), '{Begehungsschein Rotwild,Rehwild Revier im Hügelland}'::text[],
  'Zweite Seite ohne Doppelte und Lücken');
select is(search_listings('{"v":1}', :'page1'::jsonb ->> 'next_cursor', 2) -> 'next_cursor', 'null'::jsonb, 'Letzte Seite ohne Cursor');
select is(tests.search_hint('{"v":1,"country":"DE"}', :'page1'::jsonb ->> 'next_cursor', 2), 'cursor', 'Cursor passt nur zu seinen Filtern');
select is(tests.search_hint('{"v":1}', 'kaputt', 2), 'cursor', 'Ungültiger Cursor');
select is(tests.search_hint('{"v":1}', null, 51), 'limit', 'Limit höchstens 50');
select is(tests.search_hint('{"v":1,"owner":"x"}'), 'owner', 'Unbekannter Schlüssel ergibt 22023 mit hint');

-- Rückgabe ohne PLZ, Ort und Punkt; Thumbnail nur verarbeitet
select is((select count(*)::int from jsonb_array_elements(search_listings('{"v":1}') -> 'items') e, jsonb_object_keys(e) k
           where k in ('postal_code', 'place_name', 'display_location', 'owner_id', 'description')), 0,
  'Keine PLZ, kein Ort, kein Punkt in der Rückgabe');
select tests.as_postgres();
insert into listing_photos (listing_id, sort_order) select id, 0 from listings where title = 'Rehwild Revier im Hügelland';
select tests.authenticate_as(:'o1');
select is((select e -> 'photo' from jsonb_array_elements(search_listings('{"v":1,"kind":"lease","country":"DE"}') -> 'items') e),
  'null'::jsonb, 'Unverarbeitetes Foto ist nie Thumbnail, auch nicht für den Besitzer');

-- Regionszähler
select tests.as_anon();
select is(array(select region_code || ':' || listings from listing_region_counts('lease') order by 1),
  '{AT-7:1,AT-704:1,DE-09162:1,DE-BY:1}'::text[], 'Zähler je Kreis und Bundesland nur öffentlicher Anzeigen');

select * from finish();
rollback;
