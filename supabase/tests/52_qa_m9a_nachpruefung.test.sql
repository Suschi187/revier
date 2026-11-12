-- QA M9a – Nachprüfung (docs/QA-REPORT.md, „M9a – Nachprüfung“) der Korrekturen in 20261111130000_qa_m9a_fixes:
-- Rechte und Definer der ersetzten Funktionen; finalize mit exaktem Vergleich (was geht, was bleibt, Groß- und
-- Kleinschreibung, Plus-Adressen, Präfix und Suffix); prepare entfernt nur Realtime-Ereignisse der Unterhaltungen
-- des Kontos; Export version 2 mit Favoriten-Titeln nur bei öffentlichen Anzeigen in jedem nicht öffentlichen Zustand.
begin;
\ir _helpers.psql
select plan(13);

set constraints all immediate;
delete from vault.secrets where name in ('account_deletion_url', 'account_maintenance_url');
select s.decrypted_secret as del_secret from vault.decrypted_secrets s where s.name = 'account_deletion_secret' \gset
create function tests.q52_service() returns void language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
end;
$$;
grant usage on schema tests to service_role;
grant execute on all functions in schema tests to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. Ersetzte Funktionen: Definer, search_path, Rechte unverändert
-- ---------------------------------------------------------------------------
select is(
  array(select p.proname || ' ' || p.prosecdef || ' ' || coalesce(array_to_string(p.proconfig, ','), '') || ' ' || p.proacl::text
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in ('account_deletion_prepare', 'account_deletion_finalize', 'export_my_data') order by 1),
  array['account_deletion_finalize true search_path="" {postgres=X/postgres,service_role=X/postgres}',
        'account_deletion_prepare true search_path="" {postgres=X/postgres,service_role=X/postgres}',
        'export_my_data true search_path="" {postgres=X/postgres,authenticated=X/postgres}'],
  'prepare, finalize, export_my_data: definer, search_path leer, Rechte wie vorher');

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
select tests.create_user('qa52-a+tag@test.local', 'QA52 A') as a \gset
select tests.create_user('qa52-b@test.local', 'QA52 B') as b \gset
select tests.create_user('qa52-c@test.local', 'QA52 C') as c \gset
select tests.create_user('qa52-d@test.local', 'QA52 D') as d \gset
select id as district from regions where code = 'DE-09162' \gset
insert into listings (owner_id, kind, direction, title, content_language, region_id, status, expires_at, published_at) values
  (:'a', 'helper', 'wanted', 'QA52 Anzeige A', 'de', :'district', 'active', now() + interval '30 days', now()),
  (:'b', 'helper', 'wanted', 'QA52 Anzeige B', 'de', :'district', 'active', now() + interval '30 days', now());
select id as la from listings where title = 'QA52 Anzeige A' \gset
select id as lb from listings where title = 'QA52 Anzeige B' \gset

-- ---------------------------------------------------------------------------
-- 2. prepare (F3): nur Ereignisse der Unterhaltungen von A
-- ---------------------------------------------------------------------------
select tests.authenticate_as(:'b');
select start_conversation(:'la', 'QA52 B an A') as conv_ab \gset
select tests.authenticate_as(:'c');
select start_conversation(:'lb', 'QA52 C an B') as conv_cb \gset
select tests.as_postgres();
delete from realtime.messages where topic in ('user:' || :'a', 'user:' || :'b', 'user:' || :'c');
insert into realtime.messages (topic, extension, event, payload, private) values
  ('user:' || :'b', 'broadcast', 'unread.changed', jsonb_build_object('conversation_id', :'conv_ab'), true),
  ('user:' || :'b', 'broadcast', 'unread.changed', jsonb_build_object('conversation_id', :'conv_cb'), true),
  ('user:' || :'c', 'broadcast', 'unread.changed', jsonb_build_object('conversation_id', :'conv_cb'), true),
  ('user:' || :'b', 'broadcast', 'other', jsonb_build_object('nested', jsonb_build_object('conversation_id', :'conv_cb')), true);
select tests.authenticate_as(:'a');
select tests.as_postgres();
update profiles set deleted_at = now() where user_id = :'a';
insert into private.account_deletions (user_id, email) values (:'a', 'qa52-a+tag@test.local');
update private.account_deletions set next_attempt_at = now() + interval '1 day' where user_id <> :'a';
select tests.q52_service();
select claim_id as claim from account_deletion_claim(:'del_secret', 5) where user_id = :'a' \gset
select account_deletion_prepare(:'claim', :'a');
select tests.as_postgres();
select is((select count(*)::int from realtime.messages where payload ->> 'conversation_id' = :'conv_ab'), 0,
  'prepare: Ereignisse zur Unterhaltung von A beim Gegenüber entfernt');
select is((select count(*)::int from realtime.messages where topic in ('user:' || :'b', 'user:' || :'c')), 3,
  'prepare: Ereignisse zu fremden Unterhaltungen (auch verschachtelt) bleiben');
select lives_ok(format($$ select account_deletion_prepare(%L, %L) $$, :'claim', :'a'), 'prepare bleibt idempotent');

-- ---------------------------------------------------------------------------
-- 3. finalize (F1): exakter Vergleich
-- ---------------------------------------------------------------------------
insert into auth.audit_log_entries (id, payload, created_at) values
  (gen_random_uuid(), json_build_object('k', 'gone-actor', 'actor_id', :'a'), now()),
  (gen_random_uuid(), json_build_object('k', 'gone-traits-id', 'traits', json_build_object('user_id', :'a')), now()),
  (gen_random_uuid(), json_build_object('k', 'gone-upper', 'action', 'user_deleted', 'actor_username', 'QA52-A+TAG@TEST.LOCAL'), now()),
  (gen_random_uuid(), json_build_object('k', 'gone-traits-mail', 'traits', json_build_object('user_email', 'Qa52-A+Tag@Test.Local')), now()),
  (gen_random_uuid(), json_build_object('k', 'stay-prefix', 'actor_username', 'xqa52-a+tag@test.local'), now()),
  (gen_random_uuid(), json_build_object('k', 'stay-suffix', 'actor_username', 'qa52-a+tag@test.local.evil'), now()),
  (gen_random_uuid(), json_build_object('k', 'stay-other-id', 'actor_id', :'d', 'actor_username', 'qa52-d@test.local'), now()),
  (gen_random_uuid(), json_build_object('k', 'stay-id-in-text', 'note', 'pfad/' || :'a' || '/x'), now());
delete from auth.users where id = :'a';
select tests.q52_service();
select lives_ok(format($$ select account_deletion_finalize(%L, %L) $$, :'claim', :'a'), 'finalize nach dem Löschen aus auth.users');
select tests.as_postgres();
select is(array(select e.payload ->> 'k' from auth.audit_log_entries e where e.payload ->> 'k' is not null order by 1),
  array['stay-id-in-text', 'stay-other-id', 'stay-prefix', 'stay-suffix'],
  'finalize: ID als Wert, Adresse in jeder Schreibweise weg; Präfix, Suffix, fremdes Konto bleiben; ID im Fließtext bleibt (Hinweis)');
select is((select count(*)::int from realtime.messages where topic = 'user:' || :'a'), 0, 'finalize: Topic von A leer');
select lives_ok(format($$ select account_deletion_complete(%L, %L) $$, :'claim', :'a'), 'complete');

-- ---------------------------------------------------------------------------
-- 4. Export (F2): version 2, Titel nur öffentlicher Favoriten
-- ---------------------------------------------------------------------------
select tests.create_user('qa52-e@test.local', 'QA52 E') as e \gset
insert into listings (owner_id, kind, direction, title, content_language, region_id, status, expires_at, published_at) values
  (:'b', 'helper', 'wanted', 'QA52 oeffentlich', 'de', :'district', 'active', now() + interval '30 days', now()),
  (:'b', 'helper', 'wanted', 'QA52 pausiert', 'de', :'district', 'active', now() + interval '30 days', now()),
  (:'b', 'helper', 'wanted', 'QA52 abgelaufen', 'de', :'district', 'active', now() + interval '30 days', now()),
  (:'c', 'helper', 'wanted', 'QA52 gesperrter Besitzer', 'de', :'district', 'active', now() + interval '30 days', now()),
  (:'d', 'helper', 'wanted', 'QA52 geloeschter Besitzer', 'de', :'district', 'active', now() + interval '30 days', now()),
  (:'b', 'helper', 'wanted', 'QA52 entfernt', 'de', :'district', 'active', now() + interval '30 days', now());
insert into favorites (user_id, listing_id) select :'e', l.id from listings l where l.title like 'QA52 %' and l.owner_id <> :'e' and l.title <> 'QA52 Anzeige B';
update listings set status = 'paused' where title = 'QA52 pausiert';
update listings set expires_at = now() - interval '1 minute' where title = 'QA52 abgelaufen';
update listings set status = 'removed', reject_code = 'other', reject_reason = 'QA52' where title = 'QA52 entfernt';
update profiles set is_blocked = true where user_id = :'c';
update profiles set deleted_at = now() where user_id = :'d';
select tests.authenticate_as(:'e');
select export_my_data() as ex \gset
select tests.as_postgres();
-- M9b hebt die Version für die neuen Verifizierungsspalten auf 3 (ADR 020); F2 gilt unverändert.
select is((:'ex'::jsonb ->> 'version'), '3', 'Export: version 3 (seit M9b)');
select is(
  array(select coalesce(f ->> 'title', '<null>') from jsonb_array_elements(:'ex'::jsonb -> 'favorites') f order by 1),
  array['<null>', '<null>', '<null>', '<null>', '<null>', 'QA52 oeffentlich'],
  'Favoriten: Titel nur bei der öffentlichen Anzeige (pausiert, abgelaufen, entfernt, gesperrter und gelöschter Besitzer: null)');
select is(
  (select array_agg(distinct k order by k) from jsonb_array_elements(:'ex'::jsonb -> 'favorites') f, jsonb_object_keys(f) k),
  array['created_at', 'listing_id', 'title'], 'Favoriten: Schlüsselmenge unverändert (title bleibt als null)');
select is((select count(*)::int from jsonb_array_elements(:'ex'::jsonb -> 'favorites')), 6, 'Favoriten: alle sechs gemerkten Anzeigen mit ID');
select ok(position('QA52 pausiert' in :'ex') = 0 and position('QA52 entfernt' in :'ex') = 0 and position('QA52 gesperrter' in :'ex') = 0,
  'Export: kein Titel einer nicht öffentlichen fremden Anzeige');

select * from finish();
rollback;
