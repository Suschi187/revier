-- QA-Abnahme M8 (docs/QA-REPORT.md, „M8 – Abnahme“): Proben neben den Tests 43–45, kein Feature-Code.
-- Schwerpunkte: Rechte und RLS der neuen Tabellen, Spalten und RPCs; Orakel über fremde IDs (voller Fehlertext);
-- Schutz-Trigger gegen das RPC-Flag; at-most-once bei überlappenden Läufen, Release aus einem alten Lauf, Löschen
-- zwischen Claim und Confirm; Abbestell-Token (fremde Ziele, gesperrt, ohne Zustimmung, Frist); Äquivalenz von
-- Abgleich und search_listings (als anon, alle Seiten) an Randfällen; B3 mit weiteren kaputten Filtern; Allowlist
-- ohne Ort/PLZ/Koordinaten; Retention-Grenzen; Kaskaden beim Löschen von Konto und Anzeige.
-- Gefundene Fehler stehen als TODO (pgTAP), damit der Lauf grün bleibt und der Fund sichtbar ist.
-- Keine Koordinaten in der Ausgabe: Kartenpunkte werden nur in SQL verglichen, nie als Wert ausgegeben.
begin;
\ir _helpers.psql
select plan(57);

set constraints all immediate;
select s.decrypted_secret as secret from vault.decrypted_secrets s where s.name = 'search_notifications_secret' \gset

-- Fremde Daten dieser Datenbank nicht mitzählen (alles in der Transaktion, Rollback am Ende).
update public.saved_searches set notify_email = false;
delete from private.search_match_queue;
delete from private.saved_search_matches;
delete from private.saved_search_deliveries;
delete from private.search_notification_claims;
delete from private.search_notification_state;
delete from private.moderation_notifications;
delete from private.unsubscribe_tokens;
update private.app_settings set value = '2' where key = 'saved_search_instant_delay_minutes';
update private.app_settings set value = '10' where key = 'saved_search_instant_min_gap_minutes';
update private.app_settings set value = '24' where key = 'saved_search_daily_hour';

-- Voller Fehler (Code, Text, Hinweis, Detail): ein Orakel zeigte sich auch in Text oder Hinweis.
create function tests.qerr(stmt text) returns text language plpgsql as $$
declare
  st text; msg text; hnt text; det text;
begin
  execute stmt;
  return 'ok';
exception when others then
  get stacked diagnostics st = returned_sqlstate, msg = message_text, hnt = pg_exception_hint, det = pg_exception_detail;
  return st || '|' || msg || '|' || coalesce(hnt, '') || '|' || coalesce(det, '');
end;
$$;
-- Betroffene Zeilen oder der Fehlercode.
create function tests.qrows(stmt text) returns text language plpgsql as $$
declare
  n integer;
begin
  execute stmt;
  get diagnostics n = row_count;
  return n::text;
exception when others then
  return 'err:' || sqlstate;
end;
$$;
create function tests.qsearch(uid uuid, f jsonb, c public.saved_search_cadence default 'instant', label text default 'QA')
returns uuid language sql as $$
  insert into public.saved_searches (user_id, name, filters, cadence, created_at)
  values (uid, label, f, c, now() - interval '1 hour') returning id;
$$;
create function tests.qmatched(search uuid) returns uuid[] language sql as $$
  select coalesce(array_agg(m.listing_id order by m.listing_id), '{}') from private.saved_search_matches m
  where m.saved_search_id = search;
$$;
-- Alle Seiten von search_listings (Aufruf als anon, wie die öffentliche Suche).
create function tests.qsearch_ids(f jsonb) returns uuid[] language plpgsql as $$
declare
  r jsonb;
  cur text := null;
  ids uuid[] := '{}';
  pages integer := 0;
begin
  loop
    r := public.search_listings(f, cur, 50);
    ids := ids || array(select (e ->> 'id')::uuid from jsonb_array_elements(r -> 'items') e);
    cur := r ->> 'next_cursor';
    pages := pages + 1;
    exit when cur is null or pages >= 40;
  end loop;
  return ids;
end;
$$;
-- Wie die öffentliche Suche: Rolle anon nur für den Aufruf, danach wieder postgres.
create function tests.qsearch_ids_anon(f jsonb) returns uuid[] language plpgsql as $$
declare
  ids uuid[];
begin
  perform tests.as_anon();
  ids := tests.qsearch_ids(f);
  perform tests.as_postgres();
  return ids;
end;
$$;
create function tests.qrecipient(result jsonb, mail text) returns jsonb language sql as $$
  select e from jsonb_array_elements(result -> 'recipients') e where e ->> 'email' = mail;
$$;
create function tests.qpass(minutes int) returns void language sql as $$
  update private.saved_search_matches set due_at = due_at - make_interval(mins => minutes);
  update private.search_notification_state set last_sent_at = last_sent_at - make_interval(mins => minutes);
  update private.search_notification_claims set claimed_at = claimed_at - make_interval(mins => minutes);
$$;
grant execute on all functions in schema tests to anon, authenticated, service_role;
grant usage on schema tests to service_role;

select id as muc from regions where code = 'DE-09162' \gset
select id as dd from regions where code = 'DE-14612' \gset
select id as kb from regions where code = 'AT-704' \gset

-- ===========================================================================
-- 1. Rechte, RLS, Grants (A7, A9, A10)
-- ===========================================================================
create table tests.q_tables (name text primary key);
insert into tests.q_tables values ('search_match_queue'), ('search_notification_claims'), ('saved_search_matches'),
  ('saved_search_deliveries'), ('search_notification_state'), ('moderation_notifications'), ('unsubscribe_tokens');

select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'private' and c.relname in (select name from tests.q_tables)
             and c.relrowsecurity and not exists (select 1 from pg_policy p where p.polrelid = c.oid)), 7,
  'Sieben neue private Tabellen: RLS an, keine Policy');
select is((select count(*)::int from tests.q_tables t cross join unnest(array['anon', 'authenticated', 'service_role']) r
           cross join unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) p
           where has_table_privilege(r, 'private.' || t.name, p)), 0,
  'Neue private Tabellen: kein Recht für anon, authenticated, service_role');
select is((select count(*)::int from information_schema.column_privileges
           where table_schema = 'private' and table_name in (select name from tests.q_tables)
             and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')), 0,
  'Neue private Tabellen: keine Spaltenrechte');
select is(array(select privilege_type || ':' || column_name from information_schema.column_privileges
                where table_schema = 'public' and table_name = 'saved_searches' and grantee = 'authenticated'
                  and privilege_type in ('INSERT', 'UPDATE') order by 1),
  array['INSERT:cadence', 'INSERT:filters', 'INSERT:name', 'INSERT:notify_email',
        'UPDATE:cadence', 'UPDATE:name', 'UPDATE:notify_email'],
  'saved_searches: authenticated schreibt nur name, filters (nur beim Anlegen), cadence, notify_email');
select is((select count(*)::int from information_schema.column_privileges
           where table_schema = 'public' and table_name = 'saved_searches' and grantee in ('anon', 'PUBLIC')), 0,
  'saved_searches: anon hat keine Spaltenrechte');
select is(
  array(select p.proname || ':' || r from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        cross join unnest(array['anon', 'authenticated', 'service_role']) r
        where n.nspname = 'public'
          and p.proname in ('pause_saved_search', 'resume_saved_search', 'extend_saved_search',
                            'claim_search_notifications', 'confirm_search_notifications', 'release_search_notifications',
                            'claim_moderation_notifications', 'confirm_moderation_notifications',
                            'release_moderation_notifications', 'unsubscribe', 'claim_chat_notifications')
          and has_function_privilege(r, p.oid, 'execute') order by 1),
  array(select unnest(array['pause_saved_search:authenticated', 'resume_saved_search:authenticated',
        'extend_saved_search:authenticated', 'claim_search_notifications:service_role',
        'confirm_search_notifications:service_role', 'release_search_notifications:service_role',
        'claim_moderation_notifications:service_role', 'confirm_moderation_notifications:service_role',
        'release_moderation_notifications:service_role', 'unsubscribe:anon', 'unsubscribe:authenticated',
        'unsubscribe:service_role', 'claim_chat_notifications:service_role']) order by 1),
  'RPCs: Ausführungsrechte exakt (Suchauftrag nur authenticated, Versand nur service_role, unsubscribe alle)');
select is(
  array(select n.nspname || '.' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where p.prosecdef and n.nspname in ('public', 'private')
          and p.proname in ('pause_saved_search', 'resume_saved_search', 'extend_saved_search',
                            'claim_search_notifications', 'confirm_search_notifications', 'release_search_notifications',
                            'claim_moderation_notifications', 'confirm_moderation_notifications',
                            'release_moderation_notifications', 'unsubscribe', 'issue_unsubscribe_token',
                            'process_search_match_queue', 'search_notifications_secret_valid',
                            'listings_moderation_notify', 'listings_search_match_enqueue', 'saved_searches_limit',
                            'purge_search_notifications', 'trigger_search_notifications')
          and not coalesce(p.proconfig @> array['search_path=""'], false)),
  '{}'::text[], 'Alle Definer aus M8 mit search_path = ""');
select is((select count(*)::int from pg_publication_tables
           where (schemaname = 'public' and tablename = 'saved_searches')
              or (schemaname = 'private' and tablename in (select name from tests.q_tables))), 0,
  'Weder saved_searches noch die neuen Tabellen in einer Realtime-Publikation');
select is((select count(*)::int from vault.decrypted_secrets
           where name in ('search_notifications_secret') and length(decrypted_secret) = 64), 1,
  'A10: eigenes Geheimnis (32 Byte hex) im Vault');
select is((select count(*)::int from vault.decrypted_secrets s
           where s.decrypted_secret like 'eyJ%' and s.name like '%search%'), 0,
  'A10: kein JWT (service_role-Key) im Vault der Suchauftrags-Mails');

-- ===========================================================================
-- 2. Orakel (A7): fremde und unbekannte IDs, voller Fehlertext
-- ===========================================================================
select tests.create_user('qa8-a@test.local') as ua \gset
select tests.create_user('qa8-b@test.local') as ub \gset
select tests.create_user('qa8-nc@test.local', null, false) as unc \gset
select tests.create_user('qa8-blk@test.local') as ublk \gset
update profiles set is_blocked = true where user_id = :'ublk';
select tests.qsearch(:'ua', '{"v": 1, "kind": "helper"}') as sa \gset
select tests.qsearch(:'ub', '{"v": 1, "kind": "lease"}') as sb_far \gset
select tests.qsearch(:'ub', '{"v": 1, "kind": "lease"}') as sb_window \gset
select tests.qsearch(:'ub', '{"v": 1, "kind": "lease"}') as sb_paused \gset
select tests.qsearch(:'ub', '{"v": 1, "kind": "lease"}') as sb_expired \gset
select tests.qsearch(:'ub', '{"v": 1, "kind": "lease"}') as sb_noemail \gset
update public.saved_searches set expires_at = now() + interval '3 days' where id = :'sb_window';
update public.saved_searches set paused_at = now() where id = :'sb_paused';
update public.saved_searches set expires_at = now() - interval '1 day' where id = :'sb_expired';
update public.saved_searches set notify_email = false where id = :'sb_noemail';
select gen_random_uuid() as nx \gset
create table tests.q_foreign (id uuid);
insert into tests.q_foreign values (:'sb_far'), (:'sb_window'), (:'sb_paused'), (:'sb_expired'), (:'sb_noemail');
grant select on tests.q_foreign to authenticated;

select tests.authenticate_as(:'ua');
select is(split_part(tests.qerr(format('select public.pause_saved_search(%L)', :'nx')), '|', 1), '42501',
  'Unbekannte ID: 42501');
select is((select array_agg(distinct tests.qerr(format('select public.%s(%L)', fn, f.id)))
           from tests.q_foreign f cross join unnest(array['pause_saved_search']) fn),
  array[tests.qerr(format('select public.pause_saved_search(%L)', :'nx'))],
  'Pausieren: fremde IDs in jedem Zustand = unbekannte ID (Code, Text, Hinweis, Detail)');
select is((select array_agg(distinct tests.qerr(format('select public.resume_saved_search(%L)', f.id))) from tests.q_foreign f),
  array[tests.qerr(format('select public.resume_saved_search(%L)', :'nx'))],
  'Fortsetzen: fremde IDs in jedem Zustand = unbekannte ID');
select is((select array_agg(distinct tests.qerr(format('select public.extend_saved_search(%L)', f.id))) from tests.q_foreign f),
  array[tests.qerr(format('select public.extend_saved_search(%L)', :'nx'))],
  'Verlängern: fremde IDs (auch im Fenster und abgelaufen) = unbekannte ID, kein RV006 mit extend_from');
select is(array[tests.qrows(format('update public.saved_searches set name = %L where id = %L', 'Gekapert', :'sb_far')),
                tests.qrows(format('update public.saved_searches set name = %L where id = %L', 'Gekapert', :'nx')),
                tests.qrows(format('update public.saved_searches set notify_email = true where id = %L', :'sb_noemail')),
                tests.qrows(format('update public.saved_searches set cadence = %L where id = %L', 'daily', :'sb_far')),
                tests.qrows(format('delete from public.saved_searches where id = %L', :'sb_far')),
                tests.qrows(format('delete from public.saved_searches where id = %L', :'nx'))],
  array['0', '0', '0', '0', '0', '0'], 'Ändern und Löschen: fremde wie unbekannte IDs, 0 Zeilen ohne Fehler');
select is((select count(*)::int from public.saved_searches where user_id = :'ub'), 0, 'Fremde Aufträge unsichtbar');

-- Ohne Zustimmung und gesperrt: die Antwort hängt nur vom eigenen Konto ab, nie von der ID.
select tests.authenticate_as(:'unc');
select is(array[tests.qerr(format('select public.resume_saved_search(%L)', :'sb_paused')),
                tests.qerr(format('select public.extend_saved_search(%L)', :'sb_window'))],
          array[tests.qerr(format('select public.resume_saved_search(%L)', :'nx')),
                tests.qerr(format('select public.extend_saved_search(%L)', :'nx'))],
  'Ohne Zustimmung: fremde = unbekannte ID (RV001 vor der Suche)');
select tests.authenticate_as(:'ublk');
select is(array[tests.qerr(format('select public.pause_saved_search(%L)', :'sb_far')),
                tests.qerr(format('select public.resume_saved_search(%L)', :'sb_paused')),
                tests.qerr(format('select public.extend_saved_search(%L)', :'sb_window'))],
          array[tests.qerr(format('select public.pause_saved_search(%L)', :'nx')),
                tests.qerr(format('select public.resume_saved_search(%L)', :'nx')),
                tests.qerr(format('select public.extend_saved_search(%L)', :'nx'))],
  'Gesperrt: fremde = unbekannte ID');
select tests.as_postgres();
select is((select count(*)::int from public.saved_searches where user_id = :'ub' and name = 'QA' and cadence = 'instant'), 5,
  'Fremde Aufträge unverändert');

-- ===========================================================================
-- 3. Schutz-Trigger und RPC-Flag (A7)
-- ===========================================================================
select tests.authenticate_as(:'ua');
select set_config('revier.saved_search_rpc', 'on', true);
select is(array[split_part(tests.qerr(format('update public.saved_searches set expires_at = now() + interval ''1 year'' where id = %L', :'sa')), '|', 1),
                split_part(tests.qerr(format('update public.saved_searches set paused_at = now() where id = %L', :'sa')), '|', 1),
                split_part(tests.qerr(format('update public.saved_searches set last_notified_at = now() where id = %L', :'sa')), '|', 1),
                split_part(tests.qerr(format('update public.saved_searches set filters = %L where id = %L', '{"v": 1}', :'sa')), '|', 1)],
  array['42501', '42501', '42501', '42501'],
  'Selbst gesetztes RPC-Flag öffnet keine Server-Spalte (Spaltenrechte fehlen)');
select set_config('revier.saved_search_rpc', '', true);
select tests.as_postgres();
delete from public.legal_acceptances where user_id = :'ua';
update public.saved_searches set notify_email = false where id = :'sa';
select tests.authenticate_as(:'ua');
select set_config('revier.saved_search_rpc', 'on', true);
select is(split_part(tests.qerr(format('update public.saved_searches set notify_email = true where id = %L', :'sa')), '|', 1), 'RV001',
  'RPC-Flag umgeht die Zustimmung beim Wiedereinschalten nicht');
select set_config('revier.saved_search_rpc', '', true);
select is(tests.qrows(format('update public.saved_searches set name = %L, cadence = %L where id = %L', 'Ohne Zustimmung', 'daily', :'sa')), '1',
  'Ohne Zustimmung: Umbenennen und Takt gehen');
select tests.as_postgres();
insert into public.legal_acceptances (user_id, document, version, source) values
  (:'ua', 'terms', private.setting_text('legal_terms_version'), 'web'),
  (:'ua', 'privacy', private.setting_text('legal_privacy_version'), 'web');

-- ===========================================================================
-- 4. Äquivalenz Abgleich = search_listings (als anon, alle Seiten), Randfälle; B3 mit weiteren kaputten Filtern
-- ===========================================================================
select tests.create_user('qa8-own@test.local') as qo \gset
select tests.create_user('qa8-own2@test.local') as qo2 \gset
select tests.create_user('qa8-eq@test.local') as qeq \gset
update profiles set verification_status = 'verified' where user_id = :'qo2';

insert into listings (owner_id, kind, direction, title, description, content_language, region_id, status, expires_at,
                      price_minor, currency, price_unit, area_hectares, start_date, end_date, attributes) values
  (:'qo', 'lease', 'offer', 'QA Revier Rehböcke', 'Rot Wild im Hügelland, kein Schwarzwild.', 'de', :'muc', 'active', now() + interval '30 days',
   20000, 'EUR', 'per_year', 300, '2026-11-15', null, '{}'),
  (:'qo2', 'permit', 'offer', 'QA Begehung schwarz', 'Rot Wild und schwarz Wild.', 'de', :'dd', 'active', now() + interval '30 days',
   20001, 'EUR', 'per_day', 300.01, null, '2026-11-14', '{}'),
  (:'qo', 'driven_hunt', 'offer', 'QA Drückjagd Grenze', 'Drückjagd am Stichtag.', 'de', :'dd', 'active', now() + interval '30 days',
   150000, 'CZK', 'per_day', null, '2026-12-01', '2026-12-31', '{"event_date": "2026-11-20", "spots_available": 3}'),
  (:'qo2', 'helper', 'wanted', 'QA Helfer auf Anfrage', 'Helfer gesucht.', 'de', :'kb', 'active', now() + interval '30 days',
   null, null, 'on_request', null, null, null, '{"tasks": ["Ansitz"]}');
insert into listing_species (listing_id, species_code)
select id, 'red_deer' from listings where title = 'QA Revier Rehböcke'
union all select id, 'wild_boar' from listings where title = 'QA Begehung schwarz';
select id as q_lease from listings where title = 'QA Revier Rehböcke' \gset
select id as q_permit from listings where title = 'QA Begehung schwarz' \gset

-- Kartenausschnitt genau am Kartenpunkt (Ecke unten links bzw. oben rechts) und daneben; Werte bleiben in SQL.
-- „Daneben“ = 0,001°: `&&` vergleicht float4-Boxen, 1e-6° daneben zählt (auf beiden Seiten gleich) noch als innen.
create table tests.q_eq (name text primary key, f jsonb, search_id uuid);
insert into tests.q_eq (name, f) values
  ('Phrase und Ausschluss', '{"v": 1, "q": "\"rot wild\" -schwarz"}'),
  ('Oder', '{"v": 1, "q": "rehböcke or drückjagd"}'),
  ('NFD-Umlaut', '{"v": 1, "q": "Rehböcke"}'),
  ('Zeitraum nur ab', '{"v": 1, "date_from": "2026-11-15"}'),
  ('Zeitraum nur bis', '{"v": 1, "date_to": "2026-11-14"}'),
  ('Gesellschaftsjagd bis Stichtag', '{"v": 1, "kind": "driven_hunt", "date_to": "2026-11-20"}'),
  ('Gesellschaftsjagd ab Folgetag', '{"v": 1, "kind": "driven_hunt", "date_from": "2026-11-21"}'),
  ('Preis genau', '{"v": 1, "currency": "EUR", "price_min": 20000, "price_max": 20000}'),
  ('Einheit je Tag in EUR', '{"v": 1, "currency": "EUR", "price_unit": "per_day"}'),
  ('Fläche bis genau', '{"v": 1, "area_max": 300}'),
  ('Bundesland Sachsen', '{"v": 1, "region": "DE-SN"}'),
  ('Wildarten oder', '{"v": 1, "species": ["red_deer", "wild_boar"]}'),
  ('verifiziert ausdrücklich aus', '{"v": 1, "verified_only": false}'),
  ('Gesuche in AT', '{"v": 1, "direction": "wanted", "country": "AT"}');
insert into tests.q_eq (name, f)
select 'bbox Ecke unten links', jsonb_build_object('v', 1, 'bbox', jsonb_build_array(
         extensions.st_x(map_point), extensions.st_y(map_point), extensions.st_x(map_point) + 0.5, extensions.st_y(map_point) + 0.5))
from listings where id = :'q_lease'
union all
select 'bbox Ecke oben rechts', jsonb_build_object('v', 1, 'bbox', jsonb_build_array(
         extensions.st_x(map_point) - 0.5, extensions.st_y(map_point) - 0.5, extensions.st_x(map_point), extensions.st_y(map_point)))
from listings where id = :'q_lease'
union all
select 'bbox knapp daneben', jsonb_build_object('v', 1, 'bbox', jsonb_build_array(
         extensions.st_x(map_point) + 0.001, extensions.st_y(map_point), extensions.st_x(map_point) + 0.5, extensions.st_y(map_point) + 0.5))
from listings where id = :'q_lease';
select is((select array_agg(name order by name) from tests.q_eq where private.search_filters_error(f) is not null), null,
  'Alle Randfall-Filter sind gültig');
update tests.q_eq set search_id = tests.qsearch(:'qeq', f, 'instant', name);

-- B3: weitere kaputte Filter an der Prüfung vorbei (Typfehler in bbox und verified_only, unbekannte Art).
alter table public.saved_searches disable trigger saved_searches_b_filters;
select tests.qsearch(:'qeq', '{"v": 1, "bbox": ["a", 1, 2, 3]}') as s_bad_bbox \gset
select tests.qsearch(:'qeq', '{"v": 1, "verified_only": "ja"}') as s_bad_bool \gset
select tests.qsearch(:'qeq', '{"v": 1, "kind": "waffen"}') as s_bad_kind \gset
alter table public.saved_searches enable trigger saved_searches_b_filters;

select private.process_search_match_queue(50) as qrun \gset
select is((:'qrun'::jsonb ->> 'failed_searches')::int, 2, 'B3: Typfehler in bbox und verified_only gezählt, Lauf läuft weiter');
select is(array[cardinality(tests.qmatched(:'s_bad_bbox')), cardinality(tests.qmatched(:'s_bad_bool')),
                cardinality(tests.qmatched(:'s_bad_kind'))], array[0, 0, 0], 'Kaputte Filter: keine Treffer');

create temporary table q_eq_result as
select e.name, tests.qmatched(e.search_id) as got,
       array(select x from unnest(tests.qsearch_ids_anon(e.f)) x
             where x in (select id from listings where owner_id in (:'qo', :'qo2')) order by 1) as want
from tests.q_eq e;
select is((select array_agg(name order by name) from q_eq_result where got is distinct from want), null,
  'Randfälle: Abgleich und öffentliche Suche (anon, alle Seiten) liefern dieselben Anzeigen');
select ok((select count(*) from q_eq_result where cardinality(want) > 0) >= 10
          and (select count(*) from q_eq_result where cardinality(want) = 0) >= 2,
  'Randfall-Äquivalenz ist nicht trivial');
select is(array[(select cardinality(want) from q_eq_result where name = 'bbox Ecke unten links'),
                (select cardinality(want) from q_eq_result where name = 'bbox Ecke oben rechts'),
                (select cardinality(want) from q_eq_result where name = 'bbox knapp daneben')],
  array[1, 1, 0], 'Kartenausschnitt: Punkt auf der Kante zählt, knapp daneben nicht (beide Seiten)');
select is((select want from q_eq_result where name = 'Preis genau'), array[:'q_lease']::uuid[],
  'Preisgrenzen inklusiv, Währung erforderlich, „auf Anfrage“ nie mit Währung');

-- ===========================================================================
-- 5. Allowlist ohne Ort und Koordinaten (A5)
-- ===========================================================================
select tests.create_user('qa8-r@test.local') as qr \gset
select tests.qsearch(:'qr', '{"v": 1, "kind": "lease", "direction": "offer"}', 'instant', 'QA Pacht') as sr \gset
insert into listing_places (listing_id, postal_code, place_name)
select :'q_lease', r.code, 'Qageheimort' from postal_code_regions r where r.region_id = :'muc' order by r.code limit 1;
select postal_code as q_plz from listing_places where listing_id = :'q_lease' \gset
-- Treffer nachträglich (der Auftrag kam nach dem Lauf oben): erneut einreihen und abgleichen.
insert into private.search_match_queue (listing_id) values (:'q_lease');
select private.process_search_match_queue(50) is not null;
select tests.qpass(5);
select claim_search_notifications(:'secret') as c1 \gset
select tests.qrecipient(:'c1'::jsonb, 'qa8-r@test.local') ->> 'claim_id' as c1_id \gset
select ok(:'c1_id' ~ '^[0-9a-f-]{36}$', 'Claim 1 für den Empfänger');
select ok(tests.qrecipient(:'c1'::jsonb, 'qa8-r@test.local')::text !~*
            '"(lat|lng|point|map_point|postal_code|postal_prefix|place_name|display_location|owner_id|provider|description)"',
  'Claim: keine Schlüssel für Ort, Kartenpunkt, Anbieter oder Beschreibung');
select ok(position('Qageheimort' in :'c1') = 0 and position(:'q_plz' in :'c1') = 0,
  'Claim: weder Ort noch PLZ der Anzeige');
select ok(not exists (select 1 from jsonb_array_elements(tests.qrecipient(:'c1'::jsonb, 'qa8-r@test.local') -> 'items') i,
                       listings l where l.id = :'q_lease'
                         and (i::text like '%' || extensions.st_x(l.map_point)::text || '%'
                           or i::text like '%' || extensions.st_y(l.map_point)::text || '%')),
  'Claim: Kartenpunkt kommt auch als Wert nicht vor');

-- ===========================================================================
-- 6. at-most-once bei überlappenden Läufen (B2)
-- ===========================================================================
-- Lauf 2 claimt später eine neue Anzeige; ein Release aus Lauf 1 darf den Zustand von Lauf 2 nicht zurücksetzen.
select tests.qpass(15);
insert into listings (owner_id, kind, direction, title, description, content_language, region_id, status, expires_at, attributes)
values (:'qo', 'lease', 'offer', 'QA Pacht zwei', 'Zweite Pacht für den zweiten Lauf.', 'de', :'muc', 'active', now() + interval '30 days',
        '{}') returning id as q_l2 \gset
select private.process_search_match_queue(50) is not null;
update private.saved_search_matches set due_at = now() - interval '1 minute' where listing_id = :'q_l2';
select claim_search_notifications(:'secret') as c2 \gset
select tests.qrecipient(:'c2'::jsonb, 'qa8-r@test.local') ->> 'claim_id' as c2_id \gset
select is(array(select i ->> 'listing_id' from jsonb_array_elements(tests.qrecipient(:'c2'::jsonb, 'qa8-r@test.local') -> 'items') i),
  array[:'q_l2'], 'Lauf 2: nur die neue Anzeige (die aus Lauf 1 bleibt beansprucht)');
select is(release_search_notifications(:'secret', array[:'c1_id']::uuid[]), 1, 'Release aus Lauf 1');
select is((select last_sent_at from private.search_notification_state where user_id = :'qr'),
          (select claimed_at from private.search_notification_claims where claim_id = :'c2_id'),
  'Release aus Lauf 1 setzt den Zustand von Lauf 2 nicht zurück');
select is(tests.qrecipient(claim_search_notifications(:'secret'), 'qa8-r@test.local'), null,
  'Direkt danach keine Mail (Abstand ab Lauf 2)');
select tests.qpass(15);
select claim_search_notifications(:'secret') as c3 \gset
select tests.qrecipient(:'c3'::jsonb, 'qa8-r@test.local') ->> 'claim_id' as c3_id \gset
select is(array(select i ->> 'listing_id' from jsonb_array_elements(tests.qrecipient(:'c3'::jsonb, 'qa8-r@test.local') -> 'items') i),
  array[:'q_lease'], 'Lauf 3: nur die freigegebene Anzeige aus Lauf 1, nicht die von Lauf 2');
select is(confirm_search_notifications(:'secret', array[:'c2_id', :'c3_id']::uuid[]), 2, 'Confirm Lauf 2 und 3');
select is(release_search_notifications(:'secret', array[:'c1_id', :'c2_id', :'c3_id']::uuid[]), 0,
  'Release nach Confirm bzw. zweites Release: nichts');
select is(array[confirm_search_notifications(:'secret', null), release_search_notifications(:'secret', null),
                confirm_search_notifications(:'secret', '{}'), release_search_notifications(:'secret', '{}')],
  array[0, 0, 0, 0], 'NULL und leere Liste: 0, kein Fehler');
select is(array(select outcome || ':' || listing_id from private.saved_search_matches where user_id = :'qr' order by listing_id),
  array(select 'sent:' || x from unnest(array[:'q_lease', :'q_l2']) x order by x), 'Beide Anzeigen genau einmal zugestellt');

-- Löschen zwischen Claim und Confirm: Auftrag gelöscht, Confirm läuft, die Anzeige bleibt als zugestellt markiert.
select tests.qpass(15);
insert into listings (owner_id, kind, direction, title, description, content_language, region_id, status, expires_at, attributes)
values (:'qo', 'lease', 'offer', 'QA Pacht drei', 'Dritte Pacht, Auftrag wird gelöscht.', 'de', :'muc', 'active', now() + interval '30 days',
        '{}') returning id as q_l3 \gset
select private.process_search_match_queue(50) is not null;
update private.saved_search_matches set due_at = now() - interval '1 minute' where listing_id = :'q_l3';
select claim_search_notifications(:'secret') as c4 \gset
select tests.qrecipient(:'c4'::jsonb, 'qa8-r@test.local') ->> 'claim_id' as c4_id \gset
delete from public.saved_searches where id = :'sr';
select lives_ok(format('select confirm_search_notifications(%L, array[%L]::uuid[])', :'secret', :'c4_id'),
  'Confirm nach Löschen des Auftrags: kein Fehler');
select is((select count(*)::int from private.saved_search_deliveries where user_id = :'qr' and listing_id = :'q_l3'), 1,
  'Entdopplung bleibt nach dem Löschen des Auftrags (kein zweiter Versand über einen neuen Auftrag)');

-- ===========================================================================
-- 7. Abbestell-Token (B4, A6, A7)
-- ===========================================================================
select tests.qsearch(:'ublk', '{"v": 1, "kind": "helper"}') as s_blk \gset
select tests.qsearch(:'unc', '{"v": 1, "kind": "helper"}') as s_nc \gset
select private.issue_unsubscribe_token(:'ua', 'saved_search_mail', array[:'sb_far']::uuid[]) as t_foreign \gset
select private.issue_unsubscribe_token(:'ublk', 'saved_search_mail', array[:'s_blk']::uuid[]) as t_blk \gset
select private.issue_unsubscribe_token(:'unc', 'saved_search_mail', array[:'s_nc']::uuid[]) as t_nc \gset
select private.issue_unsubscribe_token(:'ublk', 'chat', '{}') as t_blk_chat \gset
select private.issue_unsubscribe_token(:'unc', 'saved_search_mail', array[:'s_nc']::uuid[]) as t_old \gset
select private.issue_unsubscribe_token(:'unc', 'chat', '{}') as t_nc_chat \gset
update private.unsubscribe_tokens set created_at = now() - interval '89 days'
where token_hash = extensions.digest(decode(:'t_old', 'hex'), 'sha256');
update public.saved_searches set notify_email = true where id = :'sb_far';
select tests.as_anon();
select unsubscribe(:'t_foreign');
select unsubscribe(:'t_blk');
select unsubscribe(:'t_blk_chat');
select tests.as_postgres();
select is((select notify_email from public.saved_searches where id = :'sb_far'), true,
  'Token wirkt nur auf Aufträge seines Besitzers (fremde ID in target_ids ohne Wirkung)');
select is(array[(select notify_email from public.saved_searches where id = :'s_blk'),
                (select notify_chat_email from profiles where user_id = :'ublk')],
  array[false, false], 'Gesperrtes Konto: Abbestellen von Suchauftrag und Chat geht (A7)');
select is((select notify_chat_email from profiles where user_id = :'unc'), true,
  'Suchauftrags-Token berührt die Chat-Mails nicht');
select tests.as_anon();
select unsubscribe(:'t_old');
select tests.as_postgres();
select is((select notify_email from public.saved_searches where id = :'s_nc'), false,
  'Ohne Zustimmung, Token 89 Tage alt: Abbestellen geht');
select is((select paused_at is null and expires_at > now() and last_notified_at is null from public.saved_searches where id = :'s_nc'), true,
  'Abbestellen ändert nur notify_email');
select tests.authenticate_as(:'unc');
select is(split_part(tests.qerr(format('update public.saved_searches set notify_email = true where id = %L', :'s_nc')), '|', 1), 'RV001',
  'Wieder einschalten verlangt die Zustimmung');
select tests.as_postgres();

-- ===========================================================================
-- 8. Retention-Grenzen (A9)
-- ===========================================================================
update private.unsubscribe_tokens set created_at = now() - interval '91 days'
where token_hash = extensions.digest(decode(:'t_nc_chat', 'hex'), 'sha256');
insert into private.moderation_notifications (listing_id, owner_id, decision, created_at, done_at, sent_at)
values (:'q_lease', :'qo', 'approved', now() - interval '40 days', now() - interval '29 days', now() - interval '29 days'),
       (:'q_permit', :'qo2', 'approved', now() - interval '40 days', now() - interval '31 days', now() - interval '31 days');
insert into private.moderation_notifications (listing_id, owner_id, decision, created_at)
values (:'q_permit', :'qo2', 'approved', now() - interval '31 days');
select private.purge_search_notifications() is not null;
select is(array[(select count(*)::int from private.unsubscribe_tokens where token_hash = extensions.digest(decode(:'t_old', 'hex'), 'sha256')),
                (select count(*)::int from private.unsubscribe_tokens where token_hash = extensions.digest(decode(:'t_nc_chat', 'hex'), 'sha256'))],
  array[1, 0], 'Token: 89 Tage bleiben, 91 Tage weg');
select is(array[(select count(*)::int from private.moderation_notifications where listing_id = :'q_lease'),
                (select count(*)::int from private.moderation_notifications where listing_id = :'q_permit')],
  array[1, 0], 'Moderations-Mails: 29 Tage nach Versand bleiben, 31 Tage und nie verarbeitete nach 31 Tagen weg');

-- ===========================================================================
-- 9. Kaskaden beim Löschen (A9)
-- ===========================================================================
-- Anzeige löschen: Warteschlange, Treffer, Entdopplung, Moderations-Mails weg.
insert into private.search_match_queue (listing_id) values (:'q_l3') on conflict do nothing;
insert into private.moderation_notifications (listing_id, owner_id, decision) values (:'q_l3', :'qo', 'approved');
delete from listings where id = :'q_l3';
select is((select count(*)::int from private.search_match_queue where listing_id = :'q_l3')
        + (select count(*)::int from private.saved_search_matches where listing_id = :'q_l3')
        + (select count(*)::int from private.saved_search_deliveries where listing_id = :'q_l3')
        + (select count(*)::int from private.moderation_notifications where listing_id = :'q_l3'), 0,
  'Anzeige gelöscht: keine Zeilen in Warteschlange, Treffern, Entdopplung, Moderations-Mails');
-- Konto löschen: alle Zeilen des Empfängers weg.
select private.issue_unsubscribe_token(:'qr', 'chat', '{}') is not null;
select ok((select count(*) from private.saved_search_deliveries where user_id = :'qr') > 0
          and (select count(*) from private.search_notification_claims where user_id = :'qr') > 0
          and (select count(*) from private.search_notification_state where user_id = :'qr') > 0
          and (select count(*) from private.unsubscribe_tokens where user_id = :'qr') > 0,
  'Vor dem Löschen: Entdopplung, Claims, Zustand, Token des Empfängers vorhanden');
delete from auth.users where id = :'qr';
select is((select count(*)::int from private.saved_search_matches where user_id = :'qr')
        + (select count(*)::int from private.saved_search_deliveries where user_id = :'qr')
        + (select count(*)::int from private.search_notification_claims where user_id = :'qr')
        + (select count(*)::int from private.search_notification_state where user_id = :'qr')
        + (select count(*)::int from private.unsubscribe_tokens where user_id = :'qr'), 0,
  'Konto gelöscht: keine Zeilen in Treffern, Entdopplung, Claims, Zustand, Token');

-- ===========================================================================
-- 10. Täglicher Kalendertag nur bei täglichen Treffern in der Mail (Kommentar der Tabelle, ADR 018)
-- ===========================================================================
-- Sofort- und Tages-Auftrag treffen dieselbe Anzeige X. Vor der Stunde geht X mit der Sofort-Mail. Ab der Stunde
-- kommt eine neue Sofort-Anzeige Y; der tägliche Treffer zu X ist doppelt. Die Mail enthält nur Y (sofort), also
-- keinen täglichen Treffer. Danach darf ein neuer täglicher Treffer Z am selben Tag noch kommen.
select tests.create_user('qa8-day@test.local') as qd \gset
select tests.qsearch(:'qd', '{"v": 1, "kind": "trophy_hunt"}', 'instant', 'QA sofort') as sd_i \gset
select tests.qsearch(:'qd', '{"v": 1, "kind": "trophy_hunt"}', 'daily', 'QA täglich') as sd_d \gset
insert into listings (owner_id, kind, direction, title, description, content_language, region_id, status, expires_at, attributes)
values (:'qo', 'trophy_hunt', 'offer', 'QA Trophäe X', 'Trophäenjagd X für den Kalendertag.', 'de', :'muc', 'active',
        now() + interval '30 days', '{"legal_ack": true}') returning id as q_x \gset
select private.process_search_match_queue(50) is not null;
update private.saved_search_matches set due_at = now() - interval '1 minute' where user_id = :'qd';
select tests.qrecipient(claim_search_notifications(:'secret'), 'qa8-day@test.local') ->> 'claim_id' as cd1 \gset
select confirm_search_notifications(:'secret', array[:'cd1']::uuid[]);
select tests.qpass(15);
update private.app_settings set value = '0' where key = 'saved_search_daily_hour';
insert into listings (owner_id, kind, direction, title, description, content_language, region_id, status, expires_at, attributes)
values (:'qo', 'trophy_hunt', 'offer', 'QA Trophäe Y', 'Trophäenjagd Y, nur sofort neu.', 'de', :'muc', 'active',
        now() + interval '30 days', '{"legal_ack": true}') returning id as q_y \gset
-- Y trifft beide Aufträge; nur der Sofort-Treffer soll mit, den täglichen zu Y nehmen wir heraus.
select private.process_search_match_queue(50) is not null;
delete from private.saved_search_matches where saved_search_id = :'sd_d' and listing_id = :'q_y';
update private.saved_search_matches set due_at = now() - interval '1 minute' where user_id = :'qd' and done_at is null;
select claim_search_notifications(:'secret') as cd2 \gset
select is(array(select i ->> 'listing_id' from jsonb_array_elements(tests.qrecipient(:'cd2'::jsonb, 'qa8-day@test.local') -> 'items') i),
  array[:'q_y'], 'Ab der Stunde: Mail nur mit der Sofort-Anzeige Y (X täglich ist doppelt)');
select confirm_search_notifications(:'secret', array[tests.qrecipient(:'cd2'::jsonb, 'qa8-day@test.local') ->> 'claim_id']::uuid[]);
-- QA M8 F1 (behoben in 20261109100000): last_daily_on erst nach der Entdopplung.
select is((select last_daily_on from private.search_notification_state where user_id = :'qd'), null,
  'F1: Ohne täglichen Treffer in der Mail bleibt der Kalendertag frei');

select * from finish();
rollback;
