begin;
\ir _helpers.psql
select plan(36);

-- QA M5 (docs/QA-REPORT.md, Abschnitt „M5 – Abnahme“): ergänzende Proben zu ADR 015. Die Funde F1, F2, F4 und F7
-- standen hier als TODO und sind seit der Migration qa_m5_fixes echte Prüfungen.
-- - Ort und PLZ sind nie Suchkriterium und nie in der Rückgabe (SPEC 3.3)
-- - Paging ohne Doppelte und Lücken bei gleichen Sortierschlüsseln (newest, price_asc, relevance)
-- - Cursor-Manipulation (gefälschter Hash, Überlauf, Länge)
-- - Sichtbarkeit: Sitemap-Quelle (anon auf listings) = Suche; Zustand gone für gesperrte und gelöschte Besitzer
-- - Favoriten: fremde Entwürfe nicht merkbar; eigene Anzeige merkbar (F4)
-- - Relevanz-Paging (F1), Such-Text mit sechs Wörtern (F2), „auf Anfrage“ mit Währung (F7)
set constraints all immediate;

create function tests.qa5_hint(f jsonb, c text default null, lim integer default 20)
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
-- Alle Seiten mit Limit `lim` durchlaufen und die IDs in Reihenfolge liefern (höchstens 50 Seiten).
create function tests.qa5_all_pages(f jsonb, lim integer)
returns uuid[] language plpgsql as $$
declare
  ids uuid[] := '{}';
  page jsonb;
  cur text := null;
  i integer := 0;
begin
  loop
    page := public.search_listings(f, cur, lim);
    ids := ids || array(select (e ->> 'id')::uuid from jsonb_array_elements(page -> 'items') with ordinality t(e, n) order by n);
    cur := page ->> 'next_cursor';
    i := i + 1;
    exit when cur is null or i >= 50;
  end loop;
  return ids;
end;
$$;
-- Zeilen aus listing_places, die die Rolle sieht (0 auch ohne Tabellenrecht).
create function tests.qa5_places()
returns integer language plpgsql as $$
begin
  return (select count(*)::int from public.listing_places);
exception when insufficient_privilege then
  return 0;
end;
$$;
create function tests.qa5_cursor(h text, k text, i text)
returns text language sql as $$
  select translate(rtrim(encode(convert_to(jsonb_build_object('h', h, 'k', k, 'i', i)::text, 'utf8'), 'base64'), '='), E'+/\n', '-_');
$$;
grant execute on function tests.qa5_hint(jsonb, text, integer), tests.qa5_all_pages(jsonb, integer), tests.qa5_cursor(text, text, text),
  tests.qa5_places()
  to anon, authenticated;

select tests.create_user('qa5-privat@test.local', 'QA5 Privat') as p1 \gset
select tests.create_user('qa5-firma@test.local', 'QA5 Firma') as b1 \gset
select tests.create_user('qa5-gesperrt@test.local', 'QA5 Gesperrt') as bl \gset
select tests.create_user('qa5-geloescht@test.local', 'QA5 Gelöscht') as del \gset
select tests.create_user('qa5-fan@test.local', 'QA5 Fan') as fan \gset
update profiles set account_type = 'business', business_name = 'QA5 Forst GmbH', verification_status = 'verified' where user_id = :'b1';
select id as muc from regions where code = 'DE-09162' \gset

-- Öffentliche Anzeige mit Ort (PLZ und Ortsname nur in listing_places, ADR 012)
insert into listings (owner_id, kind, direction, title, description, content_language, region_id, status, expires_at,
                      price_minor, currency, price_unit) values
  (:'p1', 'lease', 'offer', 'QA5 Pacht mit Ort', 'Revier mit Rehwild, Beschreibung lang genug für den Test.', 'de', :'muc',
   'active', now() + interval '30 days', 400000, 'EUR', 'per_year');
select id as pub from listings where title = 'QA5 Pacht mit Ort' \gset
select code as plz from postal_code_regions where region_id = :'muc' order by code limit 1 \gset
insert into listing_places (listing_id, postal_code, place_name) values (:'pub', :'plz', 'Geheimhausen');

-- Gleiche Sortierschlüssel: fünf Anzeigen mit identischem Text, Preis und Veröffentlichungszeitpunkt
insert into listings (owner_id, kind, direction, title, description, content_language, region_id, status, expires_at,
                      price_minor, currency, price_unit)
select :'b1', 'trophy_hunt', 'offer', 'QA5 Gleichstand Keiler', 'QA5 Gleichstand Keiler Gleichstand.', 'de', :'muc',
       'active', now() + interval '30 days', 100000, 'PLN', 'per_animal'
from generate_series(1, 5);
alter table listings disable trigger listings_zz_publication_fields;
update listings set published_at = '2026-10-01 12:00:00+00', approved_at = '2026-10-01 12:00:00+00' where title = 'QA5 Gleichstand Keiler';
alter table listings enable trigger listings_zz_publication_fields;

-- Gesperrter und gelöschter Besitzer (je eine einmal öffentliche Anzeige)
insert into listings (owner_id, kind, direction, title, content_language, region_id, status, expires_at) values
  (:'bl', 'helper', 'wanted', 'QA5 Gesperrt', 'de', :'muc', 'active', now() + interval '30 days'),
  (:'del', 'helper', 'wanted', 'QA5 Gelöscht', 'de', :'muc', 'active', now() + interval '30 days'),
  (:'p1', 'helper', 'wanted', 'QA5 Eigener Entwurf', 'de', :'muc', 'draft', null);
select id as l_bl from listings where title = 'QA5 Gesperrt' \gset
select id as l_del from listings where title = 'QA5 Gelöscht' \gset
select id as l_draft from listings where title = 'QA5 Eigener Entwurf' \gset
update profiles set is_blocked = true where user_id = :'bl';
update profiles set deleted_at = now() where user_id = :'del';

-- ---------------------------------------------------------------------------
-- Ort und PLZ (SPEC 3.3): nie Suchkriterium, nie in der Rückgabe
-- ---------------------------------------------------------------------------
select tests.as_anon();
select is(jsonb_array_length(search_listings('{"v":1,"q":"Geheimhausen"}') -> 'items'), 0, 'Ortsname ist kein Suchkriterium');
select is(jsonb_array_length(search_listings(jsonb_build_object('v', 1, 'q', :'plz')) -> 'items'), 0, 'PLZ ist kein Suchkriterium');
select is((select count(*)::int from jsonb_array_elements(search_listings('{"v":1,"q":"QA5 Pacht"}') -> 'items') e
           where e::text like '%Geheimhausen%' or e::text like '%' || :'plz' || '%'), 0, 'Weder Ort noch volle PLZ in der Rückgabe');
select is((select e ->> 'postal_prefix' from jsonb_array_elements(search_listings('{"v":1,"q":"QA5 Pacht"}') -> 'items') e),
  left(:'plz', 2), 'Nur die ersten beiden Ziffern');
select is(tests.qa5_places(), 0, 'anon liest listing_places nicht');
select tests.authenticate_as(:'fan');
select is(tests.qa5_places(), 0, 'Fremder Nutzer liest listing_places nicht');

-- ---------------------------------------------------------------------------
-- Paging bei gleichen Schlüsseln (Letzter Schlüssel id, A1)
-- ---------------------------------------------------------------------------
select tests.as_anon();
\set ties '{"v":1,"q":"Gleichstand Keiler","kind":"trophy_hunt"}'
select is(cardinality(tests.qa5_all_pages(:'ties', 2)), 5, 'newest, Limit 2: fünf Treffer');
select is((select count(distinct x)::int from unnest(tests.qa5_all_pages(:'ties', 2)) x), 5, 'newest: keine Doppelten');
select is(tests.qa5_all_pages(:'ties', 1), tests.qa5_all_pages(:'ties', 50), 'newest: gleiche Reihenfolge seitenweise und am Stück');
select is(tests.qa5_all_pages('{"v":1,"q":"Gleichstand Keiler","currency":"PLN","price_unit":"per_animal","sort":"price_asc"}', 2),
  tests.qa5_all_pages('{"v":1,"q":"Gleichstand Keiler","currency":"PLN","price_unit":"per_animal","sort":"price_asc"}', 50),
  'price_asc mit gleichem Preis: seitenweise wie am Stück');
select is((select count(distinct x)::int from unnest(tests.qa5_all_pages(
  '{"v":1,"q":"Gleichstand Keiler","currency":"PLN","price_unit":"per_animal","sort":"price_desc"}', 1)) x), 5,
  'price_desc mit gleichem Preis: alle fünf, keine Doppelten');
-- Der Rang steht als float8-Text im Cursor; mit extra_float_digits = 0 (Supabase-Standard, auch über PostgREST)
-- wird er auf 15 Stellen gerundet und ist nicht mehr verlustfrei. Die nächste Seite beginnt wieder beim selben Treffer.
select is(tests.qa5_all_pages('{"v":1,"q":"Gleichstand Keiler","sort":"relevance"}', 2),
  tests.qa5_all_pages('{"v":1,"q":"Gleichstand Keiler","sort":"relevance"}', 50),
  'relevance mit gleichem Rang: seitenweise wie am Stück');
select is((select count(distinct x)::int from unnest(tests.qa5_all_pages('{"v":1,"q":"Gleichstand Keiler","sort":"relevance"}', 1)) x), 5,
  'relevance: alle fünf, keine Doppelten');

-- ---------------------------------------------------------------------------
-- Cursor-Manipulation: Hash ist md5 der Filter und damit fälschbar; die Werte selbst werden geprüft
-- ---------------------------------------------------------------------------
select is(tests.qa5_hint(:'ties', tests.qa5_cursor(md5((:'ties')::jsonb::text), 'kein-datum', gen_random_uuid()::text), 2), 'cursor',
  'Gefälschter Cursor mit passendem Hash, aber ungültigem Schlüssel: 22023');
select is(tests.qa5_hint('{"v":1,"q":"Gleichstand Keiler","currency":"PLN","price_unit":"per_animal","sort":"price_asc"}',
  tests.qa5_cursor(md5('{"v":1,"q":"Gleichstand Keiler","currency":"PLN","price_unit":"per_animal","sort":"price_asc"}'::jsonb::text),
                   '99999999999999999999', gen_random_uuid()::text), 2), 'cursor', 'Cursor mit Zahlenüberlauf: 22023');
select is(tests.qa5_hint(:'ties', repeat('A', 201), 2), 'cursor', 'Cursor über 200 Zeichen: 22023');
select is(tests.qa5_hint(:'ties', tests.qa5_cursor(md5((:'ties')::jsonb::text), '2026-10-01 12:00:00+00', 'keine-uuid'), 2), 'cursor',
  'Cursor ohne UUID: 22023');
select is(jsonb_array_length(search_listings(:'ties', tests.qa5_cursor(md5((:'ties')::jsonb::text), '9999-01-01 00:00:00+00',
  'ffffffff-ffff-ffff-ffff-ffffffffffff'), 50) -> 'items'), 5,
  'Gefälschter Cursor in der Zukunft liefert nur öffentliche Treffer (keine Umgehung)');

-- ---------------------------------------------------------------------------
-- Sichtbarkeit: Sitemap liest listings als anon, die Suche per RPC; beide dieselbe Menge (B1)
-- ---------------------------------------------------------------------------
select tests.as_anon();
select is(array(select id from listings where title like 'QA5 %' order by id),
  array(select (e ->> 'id')::uuid from jsonb_array_elements(search_listings('{"v":1,"q":"QA5"}', null, 50) -> 'items') e order by 1),
  'anon: Tabellenzugriff (Sitemap) und Suche liefern dieselbe Menge');
select is(public_page_state('listing', :'l_bl'), 'gone', 'Anzeige eines gesperrten Besitzers: gone');
select is(public_page_state('listing', :'l_del'), 'gone', 'Anzeige eines als gelöscht markierten Besitzers: gone');
select is(public_page_state('provider', :'del'), 'gone', 'Als gelöscht markierter Anbieter: gone');
select is((select count(*)::int from public_profiles where user_id in (:'bl', :'del')), 0, 'Gesperrte und gelöschte nicht in public_profiles');
select is(array(select region_code from listing_region_counts('helper') where region_code = 'DE-09162'), '{}'::text[],
  'Regionszähler ohne gesperrte und gelöschte Besitzer');
select is(public_page_state('listing', :'l_draft'), null, 'Eigener Entwurf: null (kein Orakel)');
select tests.authenticate_as(:'p1');
select is(public_page_state('listing', :'l_draft'), null, 'Auch für den Besitzer: null');
select is(jsonb_array_length(provider_listings(:'p1', null, 50) -> 'items'), 1, 'provider_listings ohne eigenen Entwurf');

-- Ein Admin mit 2FA sieht über die Tabelle alles, über Suche und Zustand aber nur Öffentliches (B1)
select tests.as_postgres();
select tests.create_user('qa5-admin@test.local') as adm \gset
select tests.make_admin(:'adm');
select tests.authenticate_as(:'adm', 'aal2');
select is((select count(*)::int from jsonb_array_elements(search_listings('{"v":1,"q":"QA5"}', null, 50) -> 'items') e
           where (e ->> 'id')::uuid in (:'l_bl', :'l_del', :'l_draft')), 0, 'Admin: Suche ohne Gesperrte, Gelöschte und Entwürfe');

-- ---------------------------------------------------------------------------
-- Favoriten
-- ---------------------------------------------------------------------------
select tests.authenticate_as(:'fan');
select throws_ok(format($$ insert into favorites (listing_id) values (%L) $$, :'l_draft'), '42501', null,
  'Fremder Entwurf ist nicht merkbar (kein Orakel)');
select lives_ok(format($$ insert into favorites (listing_id) values (%L) $$, :'pub'), 'Öffentliche Anzeige merkbar');
select tests.authenticate_as(:'p1');
select throws_ok(format($$ insert into favorites (listing_id) values (%L) $$, :'pub'), '42501', null, 'Eigene öffentliche Anzeige nicht merkbar');
select throws_ok(format($$ insert into favorites (listing_id) values (%L) $$, :'l_draft'), '42501', null, 'Eigener Entwurf nicht merkbar');

-- ---------------------------------------------------------------------------
-- Suchtext: ein natürlicher Suchtext mit sechs Wörtern ergibt 22023 (numnode über drei Konfigurationen > 32)
-- ---------------------------------------------------------------------------
select tests.as_anon();
select is(tests.qa5_hint('{"v":1,"q":"Rotwild Schwarzwild Bayern Rosenheim Pacht"}'), null, 'Fünf Wörter: gültig');
select is(tests.qa5_hint('{"v":1,"q":"Begehungsschein Rotwild Schwarzwild Bayern Landkreis Rosenheim"}'), null, 'Sechs Wörter: gültig');

-- ---------------------------------------------------------------------------
-- „auf Anfrage“ mit Währung: die DB erlaubt currency bei on_request; der Währungsfilter zeigt sie dann (Hinweis
-- in der Oberfläche sagt das Gegenteil). Das Web speichert currency = null, iOS (I3) ist offen.
-- ---------------------------------------------------------------------------
select tests.as_postgres();
select throws_ok(format($$ insert into listings (owner_id, kind, direction, title, content_language, region_id, status, expires_at, currency, price_unit)
  values (%L, 'helper', 'offer', 'QA5 Auf Anfrage mit Währung', 'de', %L, 'active', now() + interval '30 days', 'CHF', 'on_request') $$, :'b1', :'muc'),
  '23514', null, 'F7 behoben: „auf Anfrage“ mit Währung verletzt price_consistent');
select tests.as_anon();
select is(jsonb_array_length(search_listings('{"v":1,"q":"Anfrage","currency":"CHF"}') -> 'items'), 0,
  '„Auf Anfrage“ fällt beim Währungsfilter heraus (priceHint)');

select tests.as_postgres();
select * from finish();
rollback;
