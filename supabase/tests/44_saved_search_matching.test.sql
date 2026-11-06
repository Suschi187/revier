-- M8 Commit 3 (ADR 018, Plan M8 4.3, 4.4, Review B1–B3, A1–A5, A9–A11): Abgleich bei der ersten Freigabe,
-- Äquivalenz mit search_listings, Ausschlüsse, Entdopplung je (Empfänger, Anzeige), Claim/Confirm/Release über
-- claim_id, täglicher Takt über verschobene Daten (kein p_now), Allowlist der Antwort, Rechte, Retention.
begin;
\ir _helpers.psql
select plan(77);

set constraints all immediate;
select s.decrypted_secret as secret from vault.decrypted_secrets s where s.name = 'search_notifications_secret' \gset
select is(array(select key || '=' || (value #>> '{}') from private.app_settings
              where key in ('saved_search_timezone', 'search_match_batch') order by key),
  array['saved_search_timezone=Europe/Berlin', 'search_match_batch=50'], 'Einstellungen für Abgleich und Zeitzone');

-- Fremde Daten dieser Datenbank nicht mitzählen (alles in der Transaktion, Rollback am Ende).
update public.saved_searches set notify_email = false;
delete from private.search_match_queue;
delete from private.saved_search_matches;
delete from private.saved_search_deliveries;
delete from private.search_notification_claims;
delete from private.search_notification_state;
update private.app_settings set value = '2' where key = 'saved_search_instant_delay_minutes';
update private.app_settings set value = '10' where key = 'saved_search_instant_min_gap_minutes';
-- Täglich zunächst nie fällig (Stunde 24 wird nie erreicht), unten auf die aktuelle Stunde gesetzt (A11).
update private.app_settings set value = '24' where key = 'saved_search_daily_hour';

create function tests.err(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate;
end;
$$;
grant execute on function tests.err(text) to anon, authenticated, service_role;
grant usage on schema tests to service_role;

-- Suchauftrag über den Server-Pfad, eine Stunde vor den Freigaben angelegt.
create function tests.mk_search(uid uuid, f jsonb, c public.saved_search_cadence default 'instant', label text default 'Suche')
returns uuid language sql as $$
  insert into public.saved_searches (user_id, name, filters, cadence, created_at)
  values (uid, label, f, c, now() - interval '1 hour') returning id;
$$;
create function tests.matched(search uuid) returns uuid[] language sql as $$
  select coalesce(array_agg(m.listing_id order by m.listing_id), '{}') from private.saved_search_matches m
  where m.saved_search_id = search;
$$;
create function tests.recipient(result jsonb, mail text) returns jsonb language sql as $$
  select e from jsonb_array_elements(result -> 'recipients') e where e ->> 'email' = mail;
$$;
create function tests.n_recipients(result jsonb) returns int language sql as $$
  select count(*)::int from jsonb_array_elements(result -> 'recipients') e where e ->> 'email' like 'm8m-%';
$$;
-- Zeit vergeht für alle Treffer (H7-Verzögerung) und die letzte Mail.
create function tests.pass(minutes int) returns void language sql as $$
  update private.saved_search_matches set due_at = due_at - make_interval(mins => minutes);
  update private.search_notification_state set last_sent_at = last_sent_at - make_interval(mins => minutes);
  update private.search_notification_claims set claimed_at = claimed_at - make_interval(mins => minutes);
$$;

select tests.create_user('m8m-owner@test.local') as o \gset
select tests.create_user('m8m-owner2@test.local') as o2 \gset
select tests.create_user('m8m-adm@test.local') as adm \gset
select tests.make_admin(:'adm');
update profiles set verification_status = 'verified' where user_id = :'o2';
select tests.create_user('m8m-eq@test.local') as eq \gset
select tests.create_user('m8m-ok@test.local') as ok \gset
select tests.create_user('m8m-paused@test.local') as u_paused \gset
select tests.create_user('m8m-expired@test.local') as u_expired \gset
select tests.create_user('m8m-noemail@test.local') as u_noemail \gset
select tests.create_user('m8m-late@test.local') as u_late \gset
select tests.create_user('m8m-blocked-by@test.local') as u_blocked_by \gset
select tests.create_user('m8m-blocks@test.local') as u_blocks \gset
select tests.create_user('m8m-inactive@test.local') as u_inactive \gset
select tests.create_user('m8m-bad@test.local') as u_bad \gset
select tests.create_user('m8m-dup@test.local') as u_dup \gset
select tests.create_user('m8m-mix@test.local') as u_mix \gset
select tests.create_user('m8m-daily@test.local') as u_daily \gset
select tests.create_user('m8m-r1@test.local') as u_r1 \gset
select tests.create_user('m8m-r2@test.local') as u_r2 \gset
select tests.create_user('m8m-r3@test.local') as u_r3 \gset
update profiles set preferred_language = 'cs' where user_id = :'ok';

select id as muc from regions where code = 'DE-09162' \gset
select id as dd from regions where code = 'DE-14612' \gset
select id as kb from regions where code = 'AT-704' \gset

-- ---------------------------------------------------------------------------
-- 1. Auslöser (A2): nur die erste Freigabe, auch über moderate_listing
-- ---------------------------------------------------------------------------
insert into listings (owner_id, kind, direction, title, content_language, region_id)
values (:'o', 'permit', 'offer', 'Moderierter Begehungsschein', 'de', :'dd') returning id as lm \gset
select tests.make_ready(:'lm');
update listings set status = 'pending_review' where id = :'lm';
select is((select count(*)::int from private.search_match_queue where listing_id = :'lm'), 0, 'Entwurf und Einreichung: kein Eintrag');
select tests.authenticate_as(:'adm', 'aal2');
select moderate_listing(:'lm', 'approve', admin_listing_version(:'lm'));
select tests.as_postgres();
select is((select count(*)::int from private.search_match_queue where listing_id = :'lm'), 1, 'Freigabe über moderate_listing: genau ein Eintrag');
delete from private.search_match_queue where listing_id = :'lm';
select tests.authenticate_as(:'o');
update listings set status = 'paused' where id = :'lm';
update listings set status = 'active' where id = :'lm';
select tests.as_postgres();
update listings set status = 'pending_review' where id = :'lm';
select tests.authenticate_as(:'adm', 'aal2');
select moderate_listing(:'lm', 'approve', admin_listing_version(:'lm'));
select tests.as_postgres();
select is((select count(*)::int from private.search_match_queue where listing_id = :'lm'), 0,
  'Pausieren, Fortsetzen, erneute Prüfung und Freigabe: kein neuer Eintrag');
-- Für den Abgleich unten wieder einreihen (wie bei der ersten Freigabe).
insert into private.search_match_queue (listing_id) values (:'lm');

-- ---------------------------------------------------------------------------
-- 2. Anzeigen (Server-Pfad, direkt aktiv: Insert-Trigger)
-- ---------------------------------------------------------------------------
insert into listings (owner_id, kind, direction, title, description, content_language, region_id, status, expires_at,
                      price_minor, currency, price_unit, area_hectares, start_date, end_date, attributes) values
  (:'o', 'lease', 'offer', 'Rehwild Revier im Hügelland', 'Gutes Rehwild, Hochsitze vorhanden.', 'de', :'muc', 'active', now() + interval '30 days',
   500000, 'EUR', 'per_year', 300, null, null, '{}'),
  (:'o2', 'permit', 'offer', 'Begehungsschein Rotwild', 'Rotwild und Schwarzwild im Bergwald, Hochwild.', 'de', :'dd', 'active', now() + interval '30 days',
   20000, 'EUR', 'per_year', null, '2026-05-01', '2026-12-31', '{}'),
  (:'o', 'lease', 'offer', 'Red deer hunting ground', 'Large forest with red deer and chamois.', 'en', :'kb', 'active', now() + interval '30 days',
   800000, 'EUR', 'per_year', 1000, null, null, '{}'),
  (:'o2', 'driven_hunt', 'offer', 'Společný hon na černou zvěř', 'Hon na černou zvěř v listopadu, ubytování.', 'cs', :'muc', 'active', now() + interval '30 days',
   150000, 'CZK', 'per_day', null, null, null, '{"event_date": "2026-11-20", "spots_available": 10}'),
  (:'o', 'helper', 'wanted', 'Jagdhelfer gesucht', 'Helfer für Ansitz und Reviereinrichtungen gesucht.', 'de', :'muc', 'active', now() + interval '30 days',
   null, null, 'on_request', null, null, null, '{"tasks": ["Ansitz"]}'),
  (:'o', 'helper', 'offer', 'Später pausiert', 'Wird nach dem Abgleich pausiert.', 'de', :'muc', 'active', now() + interval '30 days',
   null, null, null, null, null, null, '{"tasks": ["Ansitz"]}'),
  (:'o', 'trophy_hunt', 'offer', 'Vor dem Abgleich pausiert', 'Wird vor dem Abgleich pausiert.', 'de', :'muc', 'active', now() + interval '30 days',
   null, null, null, null, null, null, '{"legal_ack": true}');
insert into listing_species (listing_id, species_code)
select id, 'roe_deer' from listings where title = 'Rehwild Revier im Hügelland'
union all select id, 'red_deer' from listings where title = 'Begehungsschein Rotwild'
union all select id, 'red_deer' from listings where title = 'Red deer hunting ground';
select id as l_helper from listings where title = 'Jagdhelfer gesucht' \gset
select id as l_later from listings where title = 'Später pausiert' \gset
select id as l_early from listings where title = 'Vor dem Abgleich pausiert' \gset
select is((select count(*)::int from private.search_match_queue q join listings l on l.id = q.listing_id
           where l.owner_id in (:'o', :'o2')), 8, 'Direkt aktiv angelegt: je Anzeige ein Eintrag (Insert-Trigger)');
update listings set status = 'paused' where id = :'l_early';

-- ---------------------------------------------------------------------------
-- 3. Suchaufträge
-- ---------------------------------------------------------------------------
create table tests.eq_filters (name text primary key, f jsonb, search_id uuid);
insert into tests.eq_filters (name, f) values
  ('nur Version', '{"v": 1}'),
  ('alles gesetzt', '{"v": 1, "q": "Rehwild Ansitz", "country": "DE", "region": "DE-BY", "kind": "lease", "direction": "offer", "species": ["roe_deer", "red_deer"], "currency": "EUR", "price_min": 0, "price_max": 500000, "price_unit": "per_year", "area_min": 10, "area_max": 1000.5, "date_from": "2026-01-01", "date_to": "2026-12-31", "verified_only": true, "sort": "price_asc"}'),
  ('Kreis', '{"v": 1, "region": "DE-09162"}'),
  ('Land Bayern Pacht Angebot', '{"v": 1, "region": "DE-BY", "kind": "lease", "direction": "offer"}'),
  ('Text Hochwild', '{"v": 1, "q": "Hochwild", "sort": "relevance"}'),
  ('Text Rehwild', '{"v": 1, "q": "Rehwild"}'),
  ('Text englisch', '{"v": 1, "q": "red deer"}'),
  ('Währung CZK', '{"v": 1, "currency": "CZK"}'),
  ('Preis EUR bis 1000', '{"v": 1, "currency": "EUR", "price_max": 100000}'),
  -- Mit Währung zählt „auf Anfrage“ (ohne Währung) nicht mit (keine Umrechnung).
  ('Währung EUR ohne auf Anfrage', '{"v": 1, "currency": "EUR"}'),
  ('Einheit je Tag', '{"v": 1, "price_unit": "per_day"}'),
  ('Gesellschaftsjagd im November', '{"v": 1, "kind": "driven_hunt", "date_from": "2026-11-01", "date_to": "2026-11-30"}'),
  ('Gesellschaftsjagd im Dezember', '{"v": 1, "kind": "driven_hunt", "date_from": "2026-12-01"}'),
  ('Zeitraum', '{"v": 1, "date_from": "2026-06-01", "date_to": "2026-07-01"}'),
  ('nur verifiziert', '{"v": 1, "verified_only": true}'),
  ('Wildart', '{"v": 1, "species": ["red_deer"]}'),
  ('Österreich', '{"v": 1, "country": "AT"}'),
  ('Gesuche', '{"v": 1, "direction": "wanted"}'),
  ('bbox Mitteleuropa', '{"v": 1, "bbox": [5.8, 47.2, 17.2, 55.1]}'),
  ('bbox München in Bayern', '{"v": 1, "region": "DE-BY", "bbox": [11.3, 48.0, 11.8, 48.3]}'),
  ('bbox Indischer Ozean', '{"v": 1, "bbox": [59.403, -20.2805, 89.403, 9.7195]}'),
  ('Fläche', '{"v": 1, "area_min": 500}');
select is((select array_agg(name order by name) from tests.eq_filters where private.search_filters_error(f) is not null),
  null, 'Alle Äquivalenzfilter sind gültig');
update tests.eq_filters set search_id = tests.mk_search(:'eq', f, 'instant', name);

-- Ausschlüsse: alle mit demselben Filter, der die Helfer-Anzeige trifft.
select tests.mk_search(:'ok', '{"v": 1, "kind": "helper", "direction": "wanted"}', 'instant', 'Helfer') as s_ok \gset
select tests.mk_search(:'u_paused', '{"v": 1, "kind": "helper"}') as s_paused \gset
select tests.mk_search(:'u_expired', '{"v": 1, "kind": "helper"}') as s_expired \gset
select tests.mk_search(:'u_noemail', '{"v": 1, "kind": "helper"}') as s_noemail \gset
select tests.mk_search(:'u_blocked_by', '{"v": 1, "kind": "helper"}') as s_blocked_by \gset
select tests.mk_search(:'u_blocks', '{"v": 1, "kind": "helper"}') as s_blocks \gset
select tests.mk_search(:'u_inactive', '{"v": 1, "kind": "helper"}') as s_inactive \gset
select tests.mk_search(:'o', '{"v": 1, "kind": "helper"}') as s_own \gset
insert into public.saved_searches (user_id, name, filters) values (:'u_late', 'Zu spät', '{"v": 1, "kind": "helper"}')
returning id as s_late \gset
update public.saved_searches set paused_at = now() where id = :'s_paused';
update public.saved_searches set expires_at = now() - interval '1 minute' where id = :'s_expired';
update public.saved_searches set notify_email = false where id = :'s_noemail';
insert into blocks (blocker_id, blocked_id) values (:'o', :'u_blocked_by'), (:'u_blocks', :'o');
update profiles set is_blocked = true where user_id = :'u_inactive';

-- B3: ein Auftrag mit 33 Knoten im Suchbegriff, an der Prüfung vorbei per SQL eingefügt.
alter table public.saved_searches disable trigger saved_searches_b_filters;
select tests.mk_search(:'u_bad', '{"v": 1, "q": "eins zwei drei vier fuenf sechs sieben acht neun zehn elf zwoelf dreizehn vierzehn fuenfzehn sechzehn siebzehn"}') as s_bad \gset
alter table public.saved_searches enable trigger saved_searches_b_filters;

-- Entdopplung (B1): zwei Aufträge, gleicher bzw. gemischter Takt, beide treffen die Helfer-Anzeige.
select tests.mk_search(:'u_dup', '{"v": 1, "kind": "helper"}', 'instant', 'Dup A') as s_dup_a \gset
select tests.mk_search(:'u_dup', '{"v": 1, "direction": "wanted"}', 'instant', 'Dup B') as s_dup_b \gset
select tests.mk_search(:'u_mix', '{"v": 1, "kind": "helper"}', 'instant', 'Mix sofort') as s_mix_i \gset
select tests.mk_search(:'u_mix', '{"v": 1, "direction": "wanted"}', 'daily', 'Mix täglich') as s_mix_d \gset
select tests.mk_search(:'u_daily', '{"v": 1, "kind": "helper"}', 'daily', 'Täglich') as s_daily \gset
-- A3: nach dem Abgleich ungültig (Auftrag pausiert, Sperre, Anzeige pausiert).
select tests.mk_search(:'u_r1', '{"v": 1, "kind": "helper", "direction": "wanted"}') as s_r1 \gset
select tests.mk_search(:'u_r2', '{"v": 1, "kind": "helper", "direction": "wanted"}') as s_r2 \gset
select tests.mk_search(:'u_r3', '{"v": 1, "kind": "helper", "direction": "offer"}') as s_r3 \gset

-- ---------------------------------------------------------------------------
-- 4. Abgleich
-- ---------------------------------------------------------------------------
select private.process_search_match_queue(50) as run1 \gset
select is((:'run1'::jsonb ->> 'failed_searches')::int, 1, 'B3: der fehlerhafte Auftrag wird gezählt und übersprungen');
select is((:'run1'::jsonb ->> 'listings')::int, 7, 'Sieben öffentliche Anzeigen im Lauf');
select is((select array_agg(k order by k) from jsonb_object_keys(:'run1'::jsonb) k),
  array['dropped', 'failed_searches', 'filters', 'listings', 'matches', 'searches'], 'Zähler des Abgleichs');
select ok((:'run1'::jsonb ->> 'filters')::int < (:'run1'::jsonb ->> 'searches')::int,
  'Gleiche Filter mehrerer Aufträge werden einmal ausgeführt');
select is(array(select listing_id from private.search_match_queue), array[:'l_early']::uuid[],
  'Nicht öffentliche Anzeige bleibt in der Warteschlange, die übrigen sind verarbeitet');

-- Äquivalenz (A1): je Filter dieselben Anzeigen wie search_listings (auf die Anzeigen dieses Tests beschränkt).
create table tests.eq_result as
select e.name,
       tests.matched(e.search_id) as got,
       array(select (i ->> 'id')::uuid from jsonb_array_elements(public.search_listings(s.filters, null, 50) -> 'items') i
             where (i ->> 'id')::uuid in (select id from listings where owner_id in (:'o', :'o2'))
             order by 1) as want
from tests.eq_filters e join public.saved_searches s on s.id = e.search_id;
select is((select array_agg(name order by name) from tests.eq_result where got is distinct from want), null,
  'Abgleich und search_listings liefern je Filter dieselben Anzeigen');
select ok((select count(*) from tests.eq_result where cardinality(want) > 0) >= 15
          and (select count(*) from tests.eq_result where cardinality(want) = 0) >= 2,
  'Äquivalenz ist nicht trivial (Filter mit und ohne Treffer)');
select is(cardinality(tests.matched((select search_id from tests.eq_filters where name = 'nur Version'))), 7,
  'Ohne Einschränkung: alle sieben öffentlichen Anzeigen');

select is(tests.matched(:'s_ok'), array[:'l_helper']::uuid[], 'Passender Auftrag: ein Treffer');
select is(tests.matched(:'s_paused'), '{}'::uuid[], 'Pausierter Auftrag: kein Treffer');
select is(tests.matched(:'s_expired'), '{}'::uuid[], 'Abgelaufener Auftrag: kein Treffer');
select is(tests.matched(:'s_noemail'), '{}'::uuid[], 'E-Mail aus: kein Treffer');
select is(tests.matched(:'s_late'), '{}'::uuid[], 'Nach der Freigabe angelegt: kein Treffer');
select is(tests.matched(:'s_blocked_by'), '{}'::uuid[], 'Vom Anbieter gesperrt: kein Treffer');
select is(tests.matched(:'s_blocks'), '{}'::uuid[], 'Anbieter gesperrt: kein Treffer');
select is(tests.matched(:'s_inactive'), '{}'::uuid[], 'Gesperrtes Konto: kein Treffer');
select is(tests.matched(:'s_own'), '{}'::uuid[], 'Eigene Anzeige: kein Treffer');
select is(tests.matched(:'s_bad'), '{}'::uuid[], 'Fehlerhafter Auftrag: kein Treffer');
select is((select due_at - l.published_at from private.saved_search_matches m join listings l on l.id = m.listing_id
           where m.saved_search_id = :'s_ok'), interval '2 minutes', 'H7: fällig 2 Minuten nach der Freigabe');
select is((select cadence::text from private.saved_search_matches where saved_search_id = :'s_mix_d'), 'daily',
  'Takt wird am Treffer festgehalten');

-- Zweiter Lauf: nichts Neues; erneutes Einreihen erzeugt keinen zweiten Treffer je Kombination.
insert into private.search_match_queue (listing_id) values (:'l_helper');
select private.process_search_match_queue(50) as run2 \gset
select is((select count(*)::int from private.saved_search_matches where saved_search_id = :'s_ok'), 1,
  'Erneut abgeglichen: weiterhin genau ein Treffer je (Auftrag, Anzeige)');

-- 24 h (A4): nicht öffentliche Anzeige bleibt liegen, danach verworfen.
update private.search_match_queue set queued_at = now() - interval '25 hours' where listing_id = :'l_early';
select private.process_search_match_queue(50) as run3 \gset
select ok((:'run3'::jsonb ->> 'dropped')::int = 1 and not exists (select 1 from private.search_match_queue),
  'Nach 24 h nicht öffentlich: verworfen');

-- ---------------------------------------------------------------------------
-- 5. Zugang
-- ---------------------------------------------------------------------------
select is(tests.err($$ select claim_search_notifications('falsch') $$), '42501', 'Falsches Geheimnis: 42501');
select is(tests.err($$ select confirm_search_notifications('falsch', '{}') $$), '42501', 'confirm mit falschem Geheimnis: 42501');
select is(tests.err($$ select release_search_notifications('falsch', '{}') $$), '42501', 'release mit falschem Geheimnis: 42501');
select is(
  array(select p.proname || ':' || has_function_privilege('anon', p.oid, 'execute')::text || ':'
               || has_function_privilege('authenticated', p.oid, 'execute')::text || ':'
               || has_function_privilege('service_role', p.oid, 'execute')::text || ':' || p.prosecdef::text
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname like '%search_notifications' order by 1),
  array['claim_search_notifications:false:false:true:true', 'confirm_search_notifications:false:false:true:true',
        'release_search_notifications:false:false:true:true'],
  'Nur service_role führt claim/confirm/release aus (Definer)');
select is(
  array(select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'private' and p.proname in ('process_search_match_queue', 'search_notifications_secret_valid',
          'trigger_search_notifications', 'purge_search_notifications', 'listings_search_match_enqueue')
          and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
               or has_function_privilege('service_role', p.oid, 'execute'))),
  array[]::name[], 'Interne Funktionen sind für keine API-Rolle ausführbar');
select tests.authenticate_as(:'ok');
select is(tests.err(format($$ select claim_search_notifications(%L) $$, :'secret')), '42501', 'Nutzer rufen claim nicht auf');
select tests.as_postgres();

-- ---------------------------------------------------------------------------
-- 6. Claim
-- ---------------------------------------------------------------------------
select is(tests.n_recipients(claim_search_notifications(:'secret')), 0, 'Vor Ablauf der Verzögerung: keine Mail');

-- A3: zwischen Abgleich und Claim ungültig geworden.
update public.saved_searches set paused_at = now() where id = :'s_r1';
insert into blocks (blocker_id, blocked_id) values (:'u_r2', :'o');
update listings set status = 'paused' where id = :'l_later';
select tests.pass(3);

select claim_search_notifications(:'secret', 1) as c1 \gset
select claim_search_notifications(:'secret', 1) as c2 \gset
select is(tests.n_recipients(:'c1') + tests.n_recipients(:'c2'), 2, 'Zwei Claims mit Limit 1: je ein Empfänger');
select ok((:'c1'::jsonb -> 'recipients' -> 0 ->> 'claim_id') <> (:'c2'::jsonb -> 'recipients' -> 0 ->> 'claim_id')
          and (:'c1'::jsonb -> 'recipients' -> 0 ->> 'email') <> (:'c2'::jsonb -> 'recipients' -> 0 ->> 'email'),
  'Die beiden Claims sind disjunkt (andere claim_id, anderer Empfänger)');
select claim_search_notifications(:'secret') as c3 \gset
select is(tests.n_recipients(:'c1') + tests.n_recipients(:'c2') + tests.n_recipients(:'c3'), 4,
  'Sofort fällig: eq, ok, dup, mix (je eine Mail)');
select is(tests.n_recipients(claim_search_notifications(:'secret')), 0, 'Direkt danach: nichts');
select tests.pass(30);
select is(tests.n_recipients(claim_search_notifications(:'secret')), 0, 'Geclaimt, unbestätigt: nach dem Abstand kein zweites Mal (B2)');

create table tests.claims as
select e from jsonb_array_elements((:'c1'::jsonb -> 'recipients') || (:'c2'::jsonb -> 'recipients') || (:'c3'::jsonb -> 'recipients')) e;
create function tests.mail(mail text) returns jsonb language sql as $$
  select e from tests.claims where e ->> 'email' = mail;
$$;

-- Allowlist (A5)
select is((select array_agg(k order by k) from jsonb_object_keys(tests.mail('m8m-ok@test.local')) k),
  array['claim_id', 'email', 'items', 'language', 'searches', 'unsubscribe_token'], 'Antwort je Empfänger: genau diese Schlüssel');
select is((select array_agg(distinct k order by k) from tests.claims c, jsonb_array_elements(c.e -> 'items') i, jsonb_object_keys(i) k),
  array['currency', 'direction', 'district_code', 'district_name', 'kind', 'listing_id', 'price_minor', 'price_unit',
        'state_code', 'state_name', 'title'],
  'Treffer: nur die erlaubten Felder (kein Punkt, keine Koordinaten, kein Kontakt, kein Anbieter)');
select is((select array_agg(distinct k order by k) from tests.claims c, jsonb_array_elements(c.e -> 'searches') s, jsonb_object_keys(s) k),
  array['expires_at', 'extendable', 'id', 'name'], 'Aufträge: nur id, name, expires_at, extendable');
select is(tests.mail('m8m-ok@test.local') -> 'items',
  (select jsonb_build_array(jsonb_build_object('listing_id', :'l_helper'::uuid, 'title', 'Jagdhelfer gesucht', 'kind', 'helper',
     'direction', 'wanted', 'district_code', 'DE-09162', 'district_name', d.name_cs, 'state_code', 'DE-BY', 'state_name', s.name_cs,
     'price_minor', null, 'currency', null, 'price_unit', 'on_request'))
   from regions d join regions s on s.id = d.parent_id where d.code = 'DE-09162'),
  'Inhalt des Treffers mit Regionsnamen in der Empfängersprache');
select is(tests.mail('m8m-ok@test.local') ->> 'language', 'cs', 'Sprache des Empfängers');
select is(tests.mail('m8m-ok@test.local') -> 'searches',
  (select jsonb_build_array(jsonb_build_object('id', id, 'name', name, 'expires_at', expires_at, 'extendable', false))
   from saved_searches where id = :'s_ok'), 'Auftrag mit Ablauf, nicht im Verlängerungsfenster');
select is(jsonb_array_length(tests.mail('m8m-eq@test.local') -> 'items'), 6, 'Viele Aufträge, eine Mail: jede Anzeige einmal');

-- Entdopplung (B1)
select is(jsonb_array_length(tests.mail('m8m-dup@test.local') -> 'items'), 1, 'Zwei Aufträge (gleicher Takt): Anzeige einmal');
select is(jsonb_array_length(tests.mail('m8m-dup@test.local') -> 'searches'), 2, 'Beide Aufträge stehen in der Mail');
select is(jsonb_array_length(tests.mail('m8m-mix@test.local') -> 'items'), 1, 'Gemischter Takt: Anzeige mit der Sofort-Mail');

-- A3 und Ausschlüsse beim Claim
select is(array(select e ->> 'email' from tests.claims where e ->> 'email' in ('m8m-r1@test.local', 'm8m-r2@test.local', 'm8m-r3@test.local', 'm8m-daily@test.local')),
  array[]::text[], 'Ungültig gewordene Treffer und täglicher Takt vor der Stunde: keine Mail');
select is(array(select outcome from private.saved_search_matches where saved_search_id in (:'s_r1', :'s_r2', :'s_r3') order by outcome),
  array['invalid', 'invalid', 'invalid'], 'Pausierter Auftrag, neue Sperre, pausierte Anzeige: ohne Mail erledigt (A3)');

-- ---------------------------------------------------------------------------
-- 7. Confirm und Release
-- ---------------------------------------------------------------------------
select is(confirm_search_notifications(:'secret', array[(tests.mail('m8m-ok@test.local') ->> 'claim_id')::uuid,
                                                     (tests.mail('m8m-eq@test.local') ->> 'claim_id')::uuid,
                                                     (tests.mail('m8m-mix@test.local') ->> 'claim_id')::uuid]), 3, 'Confirm: drei Claims');
select ok((select outcome = 'sent' and done_at is not null from private.saved_search_matches where saved_search_id = :'s_ok')
          and (select last_notified_at is not null from saved_searches where id = :'s_ok'),
  'Confirm: Treffer gesendet, last_notified_at gesetzt');
select is(confirm_search_notifications(:'secret', array[(tests.mail('m8m-ok@test.local') ->> 'claim_id')::uuid]), 0, 'Zweites Confirm: nichts');
select is(release_search_notifications(:'secret', array[(tests.mail('m8m-ok@test.local') ->> 'claim_id')::uuid]), 0, 'Release nach Confirm: nichts');

select (tests.mail('m8m-dup@test.local') ->> 'claim_id')::uuid as dup1 \gset
select is(release_search_notifications(:'secret', array[:'dup1'::uuid]), 1, 'Release: ein Claim');
select ok((select bool_and(claim_id is null and done_at is null and attempts = 1) from private.saved_search_matches
           where user_id = :'u_dup' and listing_id = :'l_helper')
          and (select last_sent_at is null from private.search_notification_state where user_id = :'u_dup')
          and not exists (select 1 from private.saved_search_deliveries where user_id = :'u_dup'),
  'Release: Treffer wieder frei, Zustand und Entdopplung zurück');
select is(release_search_notifications(:'secret', array[:'dup1'::uuid]), 0, 'Zweites Release desselben Claims: nichts');
select tests.recipient(claim_search_notifications(:'secret'), 'm8m-dup@test.local') as dup2 \gset
select ok(:'dup2'::jsonb ->> 'claim_id' <> :'dup1' and jsonb_array_length(:'dup2'::jsonb -> 'items') = 1,
  'Nach dem Release erneut claimbar, neue claim_id, Anzeige einmal');
select release_search_notifications(:'secret', array[(:'dup2'::jsonb ->> 'claim_id')::uuid]);
select tests.recipient(claim_search_notifications(:'secret'), 'm8m-dup@test.local') as dup3 \gset
select is(release_search_notifications(:'secret', array[(:'dup3'::jsonb ->> 'claim_id')::uuid]), 1, 'Dritter Versuch freigegeben');
select ok((select bool_and(outcome = 'failed' and attempts = 3) from private.saved_search_matches
           where user_id = :'u_dup' and listing_id = :'l_helper'),
  'Nach 3 Versuchen verworfen');
select tests.pass(30);
select is(tests.recipient(claim_search_notifications(:'secret'), 'm8m-dup@test.local'), null, 'Nach 3 Versuchen keine weitere Mail');

-- ---------------------------------------------------------------------------
-- 8. Täglicher Takt (A11: Stunde auf die aktuelle Stunde gesetzt, Tage über Daten verschoben)
-- ---------------------------------------------------------------------------
update private.app_settings set value = to_jsonb(extract(hour from now() at time zone 'Europe/Berlin')::int)
where key = 'saved_search_daily_hour';
select claim_search_notifications(:'secret') as d1 \gset
select is(jsonb_array_length(tests.recipient(:'d1', 'm8m-daily@test.local') -> 'items'), 1, 'Ab der Stunde: tägliche Mail');
select is(tests.recipient(:'d1', 'm8m-mix@test.local'), null, 'Gemischter Takt: keine zweite Mail mit der täglichen');
select is((select outcome from private.saved_search_matches where saved_search_id = :'s_mix_d'), 'duplicate',
  'Gemischter Takt: täglicher Treffer ohne Mail erledigt');
select confirm_search_notifications(:'secret', array[(tests.recipient(:'d1', 'm8m-daily@test.local') ->> 'claim_id')::uuid]);
select is((select last_daily_on from private.search_notification_state where user_id = :'u_daily'),
  (now() at time zone 'Europe/Berlin')::date, 'Kalendertag der täglichen Mail festgehalten');

-- Neue Anzeige am selben Tag: erst am nächsten Kalendertag.
insert into listings (owner_id, kind, direction, title, content_language, region_id, status, expires_at, attributes)
values (:'o', 'helper', 'offer', 'Zweiter Helfer', 'de', :'muc', 'active', now() + interval '30 days', '{"tasks": ["Ansitz"]}');
select private.process_search_match_queue(50);
select tests.pass(30);
select is(tests.recipient(claim_search_notifications(:'secret'), 'm8m-daily@test.local'), null, 'Am selben Tag keine zweite tägliche Mail');
select is((select count(*)::int from private.saved_search_matches where saved_search_id = :'s_daily' and done_at is null), 1,
  'Der neue Treffer wartet');
update private.search_notification_state set last_daily_on = last_daily_on - 1 where user_id = :'u_daily';
select is(jsonb_array_length(tests.recipient(claim_search_notifications(:'secret'), 'm8m-daily@test.local') -> 'items'), 1,
  'Am nächsten Tag: die nächste tägliche Mail');
update private.app_settings set value = to_jsonb(least(extract(hour from now() at time zone 'Europe/Berlin')::int + 1, 24))
where key = 'saved_search_daily_hour';
update private.search_notification_state set last_daily_on = last_daily_on - 1 where user_id = :'u_daily';
insert into listings (owner_id, kind, direction, title, content_language, region_id, status, expires_at, attributes)
values (:'o', 'helper', 'offer', 'Dritter Helfer', 'de', :'muc', 'active', now() + interval '30 days', '{"tasks": ["Ansitz"]}');
select private.process_search_match_queue(50);
select tests.pass(30);
select is(tests.recipient(claim_search_notifications(:'secret'), 'm8m-daily@test.local'), null, 'Vor der Stunde: keine tägliche Mail');

-- Verlängerungsfenster in der Antwort
update public.saved_searches set expires_at = now() + interval '3 days' where id = :'s_daily';
update private.search_notification_state set last_daily_on = last_daily_on - 1 where user_id = :'u_daily';
update private.app_settings set value = '0' where key = 'saved_search_daily_hour';
select is(tests.recipient(claim_search_notifications(:'secret'), 'm8m-daily@test.local') -> 'searches' -> 0 -> 'extendable',
  'true'::jsonb, 'Im Verlängerungsfenster: extendable = true');

-- ---------------------------------------------------------------------------
-- 9. Retention (A9)
-- ---------------------------------------------------------------------------
insert into private.search_match_queue (listing_id, queued_at) values (:'l_helper', now() - interval '25 hours');
update private.saved_search_matches set done_at = now() - interval '31 days' where saved_search_id = :'s_ok';
-- Geclaimt, nie bestätigt (Absturz der Function): 30 Tage nach dem Treffer weg.
select listing_id as l_stuck from private.saved_search_matches
where saved_search_id = :'s_daily' and claim_id is not null and done_at is null order by listing_id limit 1 \gset
update private.saved_search_matches set matched_at = now() - interval '31 days'
where saved_search_id = :'s_daily' and listing_id = :'l_stuck';
update private.saved_search_deliveries set created_at = now() - interval '31 days' where user_id = :'ok';
update private.search_notification_claims set claimed_at = now() - interval '31 days' where user_id = :'ok';
update private.search_notification_state set last_sent_at = now() - interval '31 days' where user_id = :'ok';
select private.purge_search_notifications() as purge \gset
select ok(not exists (select 1 from private.search_match_queue)
          and not exists (select 1 from private.saved_search_matches where saved_search_id = :'s_ok')
          and not exists (select 1 from private.saved_search_deliveries where user_id = :'ok')
          and not exists (select 1 from private.search_notification_claims where user_id = :'ok')
          and not exists (select 1 from private.search_notification_state where user_id = :'ok'),
  'Retention: Warteschlange nach 24 h, Treffer, Entdopplung, Claim und Zustand nach 30 Tagen');
select ok(not exists (select 1 from private.saved_search_matches where saved_search_id = :'s_daily' and listing_id = :'l_stuck')
          and exists (select 1 from private.saved_search_matches where user_id = :'eq')
          and exists (select 1 from private.search_notification_claims where user_id = :'eq'),
  'Retention: auch geclaimte Treffer nach 30 Tagen weg, jüngere bleiben');
select is((select count(*)::int from cron.job where jobname in ('search-notifications', 'search-notifications-retention')), 2,
  'Cron-Jobs für Versand und Retention');
select is((select count(*)::int from vault.decrypted_secrets where name = 'search_notifications_url'), 0,
  'Ohne URL im Vault (lokal, CI) bleibt der Versand inaktiv');
select lives_ok($$ select private.trigger_search_notifications() $$, 'Auslöser ohne URL tut nichts');

select * from finish();
rollback;
