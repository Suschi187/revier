-- QA M9a – Abnahme (docs/QA-REPORT.md, Abschnitt „M9a – Abnahme“). Proben zu den Lücken der Tests 48–50:
-- Rechte, RLS und Definer der neuen Objekte; frische Anmeldung (amr-Matrix); Anstoß per pg_net ohne Nutzer-ID;
-- Lease (veralteter und abgelaufener Claim, fremde Zeile, Grenzen, Secrets, kein Abbruch); finalize löscht keine
-- fremden Auth-Einträge (F1, TODO); Export nur eigene Daten und keine Titel nicht öffentlicher Favoriten (F2, TODO);
-- Aufräum-Kandidaten (Grenzen, Verifizierungsdokumente, Thumbnails), Export-Zähler-Job.
-- Alles in einer Transaktion mit Rollback: keine Reste, keine echten Dateien, kein Versand durch pg_net.
begin;
\ir _helpers.psql
select plan(41);

set constraints all immediate;
delete from vault.secrets where name in ('account_deletion_url', 'account_maintenance_url');
select s.decrypted_secret as del_secret from vault.decrypted_secrets s where s.name = 'account_deletion_secret' \gset
select s.decrypted_secret as mt_secret from vault.decrypted_secrets s where s.name = 'account_maintenance_secret' \gset

create function tests.q51_err(statement text) returns text language plpgsql as $$
declare s text; h text;
begin
  execute statement;
  return 'ok';
exception when others then
  get stacked diagnostics s = returned_sqlstate, h = pg_exception_hint;
  return s || coalesce(' ' || nullif(h, ''), '');
end;
$$;

-- Angemeldet mit beliebigem amr (wie GoTrue: Liste aus {method, timestamp}).
create function tests.q51_login(uid uuid, amr jsonb, aal text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', uid, 'role', 'authenticated', 'aal', aal, 'amr', amr)::text, true);
end;
$$;
create function tests.q51_amr(method text, minutes_ago integer) returns jsonb language sql as $$
  select jsonb_build_object('method', method, 'timestamp', extract(epoch from now() - make_interval(mins => minutes_ago))::bigint);
$$;
create function tests.q51_service() returns void language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
end;
$$;
grant usage on schema tests to service_role;
grant execute on all functions in schema tests to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. Rechte, RLS, Definer (neue Objekte aus 20261111100000/110000/120000)
-- ---------------------------------------------------------------------------
select is(
  array(select c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'private' and c.relname in ('account_deletions', 'account_deletion_buckets', 'data_exports')
          and (not c.relrowsecurity
               or exists (select 1 from pg_policies p where p.schemaname = 'private' and p.tablename = c.relname)
               or has_table_privilege('anon', c.oid, 'select,insert,update,delete')
               or has_table_privilege('authenticated', c.oid, 'select,insert,update,delete')
               or has_table_privilege('service_role', c.oid, 'select,insert,update,delete'))
        order by 1),
  '{}'::text[], 'Neue Tabellen: RLS an, keine Policy, keine Rechte für anon, authenticated, service_role');
select is((select count(*)::int from pg_publication_tables where tablename in ('account_deletions', 'account_deletion_buckets', 'data_exports')),
  0, 'Neue Tabellen nicht in einer Realtime-Publikation');

-- Erwartete Ausführungsrechte je RPC; jede Abweichung erscheint im Array.
select is(
  array(
    with expected(fn, anon, auth, service) as (values
      ('public.request_account_deletion()', false, true, false),
      ('public.export_my_data()', false, true, false),
      ('public.admin_stuck_account_deletions()', false, true, false),
      ('public.account_deletion_claim(text,integer)', false, false, true),
      ('public.account_deletion_objects(uuid,uuid)', false, false, true),
      ('public.account_deletion_prepare(uuid,uuid)', false, false, true),
      ('public.account_deletion_finalize(uuid,uuid)', false, false, true),
      ('public.account_deletion_complete(uuid,uuid)', false, false, true),
      ('public.account_deletion_fail(uuid,uuid)', false, false, true),
      ('public.maintenance_storage_objects(text,integer)', false, false, true),
      ('private.has_fresh_login()', false, false, false),
      ('private.trigger_account_deletion()', false, false, false),
      ('private.trigger_account_maintenance()', false, false, false),
      ('private.queue_unconfirmed_account_deletions()', false, false, false),
      ('private.purge_handled_reports()', false, false, false),
      ('private.purge_audit_log()', false, false, false),
      ('private.account_deletion_secret_valid(text)', false, false, false),
      ('private.account_maintenance_secret_valid(text)', false, false, false),
      ('private.account_deletion_leased(uuid,uuid)', false, false, false),
      ('private.export_party_name(uuid)', false, false, false))
    select fn || ' anon=' || has_function_privilege('anon', fn, 'execute') || ' auth=' || has_function_privilege('authenticated', fn, 'execute')
           || ' service=' || has_function_privilege('service_role', fn, 'execute')
    from expected
    where has_function_privilege('anon', fn, 'execute') <> anon
       or has_function_privilege('authenticated', fn, 'execute') <> auth
       or (fn like 'public.%' and has_function_privilege('service_role', fn, 'execute') <> service)
    order by 1),
  '{}'::text[], 'Ausführungsrechte der neuen RPCs exakt (Schritt-RPCs nur service_role, Helfer nicht für Clients)');

select is(
  array(select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where p.proname in ('request_account_deletion', 'export_my_data', 'admin_stuck_account_deletions', 'account_deletion_claim',
                            'account_deletion_objects', 'account_deletion_prepare', 'account_deletion_finalize', 'account_deletion_complete',
                            'account_deletion_fail', 'maintenance_storage_objects', 'has_fresh_login', 'trigger_account_deletion',
                            'trigger_account_maintenance', 'queue_unconfirmed_account_deletions', 'purge_handled_reports', 'purge_audit_log',
                            'account_deletion_secret_valid', 'account_maintenance_secret_valid', 'account_deletion_leased', 'export_party_name')
          and n.nspname in ('public', 'private')
          and (not p.prosecdef or not coalesce(p.proconfig @> array['search_path=""'], false))
        order by 1),
  '{}'::text[], 'Alle neuen Funktionen: security definer mit search_path = ''''');

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
select tests.create_user('qa51-a@test.local', 'QA51 Anna') as a \gset
select tests.create_user('qa51-b@test.local', 'QA51 Bernd') as b \gset
select tests.create_user('qa51-c@test.local', 'QA51 Admin Carla') as c \gset
-- D hat eine Adresse, die die von A als Teilzeichenkette enthält (F1).
select tests.create_user('jqa51-a@test.local', 'QA51 Johanna') as d \gset
select tests.create_user('qa51-e@test.local', 'QA51 Emil') as e \gset
select tests.create_user('qa51-f1@test.local', 'QA51 F1', false) as f1 \gset
select tests.create_user('qa51-f2@test.local', 'QA51 F2') as f2 \gset
select tests.create_user('qa51-f3@test.local', 'QA51 F3') as f3 \gset
select tests.create_user('qa51-g@test.local', 'QA51 G') as g \gset
select tests.create_user('qa51-h@test.local', 'QA51 H') as h \gset
select tests.make_admin(:'c');
select id as district from regions where code = 'DE-09162' \gset

-- ---------------------------------------------------------------------------
-- 2. Frische Anmeldung: amr-Matrix (ADR 019, Allowlist otp, magiclink, oauth, id_token; 10 Minuten)
-- ---------------------------------------------------------------------------
select tests.q51_login(:'a', jsonb_build_array(tests.q51_amr('password', 0)));
select is(tests.q51_err('select request_account_deletion()'), 'RV007 {"reauth":"required"}', 'amr password (frisch): RV007');
select tests.q51_login(:'a', jsonb_build_array(tests.q51_amr('anonymous', 0)));
select is(tests.q51_err('select request_account_deletion()'), 'RV007 {"reauth":"required"}', 'amr anonymous: RV007');
select tests.q51_login(:'a', jsonb_build_array(tests.q51_amr('otp', 11), tests.q51_amr('totp', 0)), 'aal2');
select is(tests.q51_err('select request_account_deletion()'), 'RV007 {"reauth":"required"}', 'alter Code plus frisches totp: RV007');
select tests.q51_login(:'a', tests.q51_amr('otp', 0));
select is(tests.q51_err('select request_account_deletion()'), 'RV007 {"reauth":"required"}', 'amr als Objekt statt Liste: RV007, kein 22023');
select tests.q51_login(:'a', jsonb_build_array(jsonb_build_object('method', 'otp')));
select is(tests.q51_err('select request_account_deletion()'), 'RV007 {"reauth":"required"}', 'amr ohne timestamp: RV007');
select tests.as_postgres();
select is((select count(*)::int from profiles where user_id = :'a' and deleted_at is not null), 0, 'abgelehnte Anträge: kein deleted_at');
-- Erlaubte Wege, je mit eigenem Konto.
select tests.q51_login(:'f1', jsonb_build_array(tests.q51_amr('otp', 30), tests.q51_amr('oauth', 2)));
select is(tests.q51_err('select request_account_deletion()'), 'ok', 'alter Code plus frisches oauth: erlaubt (auch ohne Zustimmung)');
select tests.q51_login(:'f2', jsonb_build_array(tests.q51_amr('id_token', 1)));
select is(tests.q51_err('select request_account_deletion()'), 'ok', 'id_token: erlaubt');
select tests.q51_login(:'f3', jsonb_build_array(tests.q51_amr('magiclink', 9)));
select is(tests.q51_err('select request_account_deletion()'), 'ok', 'magiclink vor 9 Minuten: erlaubt');
-- Konto mit Rolle und nur unbestätigtem Faktor: 42501 admin_role, unabhängig von aal.
select tests.as_postgres();
insert into private.user_roles (user_id, role) values (:'g', 'admin');
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
  values (gen_random_uuid(), :'g', 'QA51', 'totp', 'unverified', now(), now(), 'JBSWY3DPEHPK3PXP');
select tests.q51_login(:'g', jsonb_build_array(tests.q51_amr('otp', 1)));
select is(tests.q51_err('select request_account_deletion()'), '42501 {"reason":"admin_role"}', 'Rolle mit unbestätigtem Faktor: 42501 admin_role');

-- ---------------------------------------------------------------------------
-- 3. Anstoß per pg_net: Body ohne Nutzer-ID (Review A1); nur mit URL
-- ---------------------------------------------------------------------------
select tests.as_postgres();
select coalesce(max(id), 0) as q_before from net.http_request_queue \gset
select vault.create_secret('http://kong:8000/functions/v1/qa51-nowhere', 'account_deletion_url');
select tests.q51_login(:'h', jsonb_build_array(tests.q51_amr('otp', 1)));
select is(tests.q51_err('select request_account_deletion()'), 'ok', 'Antrag mit URL im Vault');
select tests.as_postgres();
select is(
  (select count(*)::int from net.http_request_queue q where q.id > :q_before and q.url like '%qa51-nowhere'),
  1, 'genau ein Anstoß an die URL aus dem Vault');
select ok(
  (select bool_and(position(:'h' in coalesce(convert_from(q.body, 'UTF8'), '') || q.headers::text || q.url) = 0
                   and position('qa51-h@test.local' in lower(coalesce(convert_from(q.body, 'UTF8'), '') || q.headers::text)) = 0
                   and q.headers ->> 'x-account-deletion-secret' = :'del_secret')
   from net.http_request_queue q where q.id > :q_before),
  'Anstoß: weder Nutzer-ID noch Adresse in URL, Header oder Body; Secret im Header');
delete from vault.secrets where name = 'account_deletion_url';

-- ---------------------------------------------------------------------------
-- 4. Lease, Grenzen, Secrets, kein Abbruch
-- ---------------------------------------------------------------------------
select tests.q51_login(:'a', jsonb_build_array(tests.q51_amr('otp', 1)));
select is(tests.q51_err('select request_account_deletion()'), 'ok', 'A: Antrag mit frischem Code');
select tests.as_postgres();
update private.account_deletions set next_attempt_at = now() + interval '1 day' where user_id <> :'a';
select tests.q51_service();
select claim_id as claim1 from account_deletion_claim(:'del_secret', 5) where user_id = :'a' \gset
-- Lauf 1 hängt, der Lease läuft ab, Lauf 2 claimt neu.
select tests.as_postgres();
update private.account_deletions set claimed_until = now() - interval '1 second', next_attempt_at = now() - interval '1 second' where user_id = :'a';
select tests.q51_service();
select claim_id as claim2 from account_deletion_claim(:'del_secret', 5) where user_id = :'a' \gset
select isnt(:'claim1'::uuid, :'claim2'::uuid, 'nach Ablauf des Lease: neuer claim_id');
select is(
  array[tests.q51_err(format($$ select * from account_deletion_objects(%L, %L) $$, :'claim1', :'a')),
        tests.q51_err(format($$ select account_deletion_prepare(%L, %L) $$, :'claim1', :'a')),
        tests.q51_err(format($$ select account_deletion_finalize(%L, %L) $$, :'claim1', :'a')),
        tests.q51_err(format($$ select account_deletion_complete(%L, %L) $$, :'claim1', :'a'))],
  array['42501', '42501', '42501', '42501'], 'veralteter Lauf (alter claim_id): alle Schritte 42501');
select account_deletion_fail(:'claim1', :'a');
select tests.as_postgres();
select is((select claim_id from private.account_deletions where user_id = :'a'), :'claim2'::uuid, 'fail mit altem claim_id gibt den neuen Lease nicht frei');
select tests.q51_service();
select is(tests.q51_err(format($$ select account_deletion_prepare(%L, %L) $$, :'claim2', :'b')), '42501', 'gültiger claim_id für eine andere Nutzer-ID: 42501');
select tests.as_postgres();
update private.account_deletions set claimed_until = now() - interval '1 second' where user_id = :'a';
select tests.q51_service();
select is(tests.q51_err(format($$ select account_deletion_prepare(%L, %L) $$, :'claim2', :'a')), '42501', 'abgelaufener Lease mit richtigem claim_id: 42501');
select is(
  array[tests.q51_err('select * from account_deletion_claim(null)'),
        tests.q51_err($$ select * from account_deletion_claim('') $$),
        tests.q51_err(format($$ select * from account_deletion_claim(%L) $$, upper(:'del_secret'))),
        tests.q51_err(format($$ select * from account_deletion_claim(%L) $$, :'del_secret' || ' ')),
        tests.q51_err(format($$ select * from account_deletion_claim(%L) $$, :'mt_secret')),
        tests.q51_err(format($$ select * from maintenance_storage_objects(%L) $$, :'del_secret'))],
  array['42501', '42501', '42501', '42501', '42501', '42501'],
  'Secrets: null, leer, Großschreibung, Leerzeichen und das jeweils andere Secret → 42501');
-- Grenzen des Claims: 25 fällige Anker (ohne FK, deshalb ohne Konten möglich).
select tests.as_postgres();
update private.account_deletions set next_attempt_at = now() + interval '1 day', claim_id = null, claimed_until = null;
insert into private.account_deletions (user_id, email, next_attempt_at) select gen_random_uuid(), null, now() - interval '1 second' from generate_series(1, 25);
select tests.q51_service();
select is(
  array[(select count(*)::int from account_deletion_claim(:'del_secret', 100)),
        (select count(*)::int from account_deletion_claim(:'del_secret', 0)),
        (select count(*)::int from account_deletion_claim(:'del_secret', -3)),
        (select count(*)::int from account_deletion_claim(:'del_secret', null))],
  array[20, 1, 1, 3], 'Claim-Grenzen: höchstens 20, mindestens 1, null = 5 (hier nur noch 3 übrig)');
-- Kein Abbruch: auch nach 500 Versuchen wird eine fällige Zeile geclaimt, Backoff höchstens 1 h.
select tests.as_postgres();
update private.account_deletions set attempts = 500, next_attempt_at = now() - interval '1 second', claim_id = null, claimed_until = null where user_id = :'a';
update private.account_deletions set next_attempt_at = now() + interval '1 day', claim_id = null, claimed_until = null where user_id <> :'a';
select tests.q51_service();
select is((select attempts from account_deletion_claim(:'del_secret', 5) where user_id = :'a'), 501, 'nach 500 Versuchen weiter geclaimt');
select tests.as_postgres();
select ok((select next_attempt_at between now() + interval '59 minutes' and now() + interval '61 minutes' from private.account_deletions where user_id = :'a'),
  'Backoff bleibt bei 1 h gedeckelt');
select claim_id as claim3 from private.account_deletions where user_id = :'a' \gset

-- ---------------------------------------------------------------------------
-- 5. finalize: nur Einträge dieses Kontos (F1)
-- ---------------------------------------------------------------------------
insert into auth.audit_log_entries (id, payload, created_at) values
  (gen_random_uuid(), json_build_object('actor_id', :'d', 'actor_username', 'jqa51-a@test.local', 'action', 'login'), now()),
  (gen_random_uuid(), json_build_object('actor_id', :'a', 'actor_username', 'qa51-a@test.local', 'action', 'login'), now()),
  (gen_random_uuid(), json_build_object('action', 'user_deleted', 'traits', json_build_object('user_email', 'QA51-A@test.local')), now());
delete from auth.users where id = :'a';
select tests.q51_service();
select lives_ok(format($$ select account_deletion_finalize(%L, %L) $$, :'claim3', :'a'), 'finalize nach dem Löschen aus auth.users');
select tests.as_postgres();
select is((select count(*)::int from auth.audit_log_entries e where e.payload::text like '%' || :'a' || '%' or lower(e.payload::text) like '%"qa51-a@test.local"%'),
  0, 'finalize: Einträge mit ID oder Adresse von A entfernt');
-- F1 behoben (20261111130000_qa_m9a_fixes): exakter Vergleich.
select is((select count(*)::int from auth.audit_log_entries e where e.payload ->> 'actor_id' = :'d'),
  1, 'finalize: Auth-Audit von D (jqa51-a@…) bleibt');

-- ---------------------------------------------------------------------------
-- 6. Export: nur eigene Daten, keine fremden IDs, Adressen, Meldungen; Titel nicht öffentlicher Favoriten (F2)
-- ---------------------------------------------------------------------------
insert into listings (owner_id, kind, direction, title, content_language, region_id, status, expires_at, published_at) values
  (:'e', 'helper', 'wanted', 'QA51 Anzeige E', 'de', :'district', 'active', now() + interval '30 days', now()),
  (:'b', 'helper', 'wanted', 'QA51 Anzeige B', 'de', :'district', 'active', now() + interval '30 days', now()),
  (:'b', 'helper', 'wanted', 'QA51 Anzeige B2', 'de', :'district', 'active', now() + interval '30 days', now());
select id as le from listings where title = 'QA51 Anzeige E' \gset
select id as lb from listings where title = 'QA51 Anzeige B' \gset
select id as lb2 from listings where title = 'QA51 Anzeige B2' \gset
insert into favorites (user_id, listing_id) values (:'e', :'lb'), (:'e', :'lb2');
-- B zieht B2 zurück (Entwurf) und ändert den Titel: nicht öffentlich.
update listings set status = 'draft', title = 'QA51 Geheimer Entwurfstitel' where id = :'lb2';
select tests.authenticate_as(:'b');
select start_conversation(:'le', 'QA51 Frage von Bernd') as conv \gset
select tests.authenticate_as(:'e');
select send_message(:'conv', 'QA51 Antwort von Emil') as msg_e \gset
insert into reports (target_type, target_id, reason, note) values ('listing', :'lb', 'scam', 'QA51 Notiz von Emil');
-- Fremde Meldung über E, fremder Chat zwischen D und B.
select tests.authenticate_as(:'b');
insert into reports (target_type, target_id, reason, note) values ('profile', :'e', 'scam', 'QA51 Notiz von Bernd');
select tests.authenticate_as(:'d');
select start_conversation(:'lb', 'QA51 Fremder Chat') as conv_db \gset
select tests.as_postgres();
insert into blocks (blocker_id, blocked_id) values (:'e', :'d');
update reports set status = 'handled', handled_by = :'c', handled_at = now() where reporter_id = :'e';
update listings set status = 'removed', reject_code = 'other', reject_reason = 'QA51 Begründung' where id = :'le';

select tests.authenticate_as(:'e');
select export_my_data()::text as export_e \gset
select tests.as_postgres();
select is(
  array(select x from unnest(array[:'b', :'c', :'d', 'qa51-b@test.local', 'qa51-c@test.local', 'jqa51-a@test.local', 'QA51 Notiz von Bernd',
                                    'QA51 Fremder Chat', 'QA51 Admin Carla', :'conv', :'msg_e']) x
        where position(lower(x) in lower(:'export_e')) > 0),
  '{}'::text[], 'Export: keine IDs/Adressen anderer, keine fremden Meldungen, kein fremder Chat, kein Admin, keine internen IDs');
select ok(position('QA51 Notiz von Emil' in :'export_e') > 0 and position('QA51 Antwort von Emil' in :'export_e') > 0
          and position('QA51 Frage von Bernd' in :'export_e') > 0 and position('QA51 Begründung' in :'export_e') > 0,
  'Export: eigene Meldung, beide Seiten des Chats und die Begründung der Entfernung sind enthalten');
-- F2 behoben (20261111130000_qa_m9a_fixes): Titel nur bei öffentlichen Favoriten.
select is(position('QA51 Geheimer Entwurfstitel' in :'export_e'), 0, 'Export: kein Titel eines nicht öffentlichen fremden Favoriten');
-- Gesperrt und ohne Zustimmung: Export geht.
update profiles set is_blocked = true where user_id = :'g';
delete from private.user_roles where user_id = :'g';
delete from legal_acceptances where user_id = :'g';
select tests.authenticate_as(:'g');
select is(tests.q51_err('select export_my_data()'), 'ok', 'Export: gesperrt und ohne Zustimmung erlaubt');
-- Admin-Export: Rolle ja, aber kein Audit und keine Lookups.
select tests.as_postgres();
insert into audit_log (actor_id, action, target_type, target_id, details) values (:'c', 'listing.removed', 'listing', :'le', '{"note": "QA51 Audit-Notiz"}');
select tests.authenticate_as(:'c', 'aal2');
select export_my_data()::text as export_c \gset
select ok(position('"role": "admin"' in :'export_c') > 0 and position('QA51 Audit-Notiz' in :'export_c') = 0 and position(:'le' in :'export_c') = 0,
  'Admin-Export: Rolle enthalten, Audit-Einträge nicht');

-- ---------------------------------------------------------------------------
-- 7. Aufräumjobs: Kandidaten und Export-Zähler
-- ---------------------------------------------------------------------------
select tests.as_postgres();
insert into listings (owner_id, kind, direction, title, content_language, region_id) values (:'b', 'helper', 'wanted', 'QA51 Foto-Entwurf', 'de', :'district');
select id as lf from listings where title = 'QA51 Foto-Entwurf' \gset
insert into listing_photos (listing_id, sort_order, processed_at, width, height, alt_text) values (:'lf', 0, now(), 8, 8, 'QA51');
insert into listing_photos (listing_id, sort_order) values (:'lf', 1);
select storage_path as p_full, thumb_path as p_thumb from listing_photos where listing_id = :'lf' and sort_order = 0 \gset
select upload_path as p_pending from listing_photos where listing_id = :'lf' and sort_order = 1 \gset
insert into storage.objects (bucket_id, name, owner_id, created_at) values
  ('listing-photos', :'p_full', :'b', now() - interval '30 days'),
  ('listing-photos', :'p_thumb', :'b', now() - interval '30 days'),
  ('listing-photos', :'b' || '/' || :'lf' || '/orphan.jpg', :'b', now() - interval '25 hours'),
  ('listing-photos', :'b' || '/' || :'lf' || '/fresh-orphan.jpg', :'b', now() - interval '23 hours'),
  ('listing-uploads', :'p_pending', :'b', now() - interval '25 hours'),
  ('listing-uploads', :'b' || '/' || :'lf' || '/fresh', :'b', now() - interval '23 hours'),
  ('verification-docs', :'b' || '/qa51-doc.jpg', :'b', now() - interval '400 days');
select tests.q51_service();
select is(
  array(select o.bucket_id || ':' || case when o.name = :'p_pending' then 'pending' else split_part(o.name, '/', 3) end || ':' || o.reason
        from maintenance_storage_objects(:'mt_secret', 1000) o where o.name like :'b' || '/%' order by 1),
  -- M9b (ADR 020): Ein Dokument ohne Antrag ist seitdem ebenfalls Kandidat (verification_orphan).
  array['listing-photos:orphan.jpg:photo_orphan', 'listing-uploads:pending:upload_expired', 'verification-docs::verification_orphan'],
  'Kandidaten: alte Datei ohne Zeile, alter Eingang und Dokument ohne Antrag; Foto und Thumbnail mit Zeile und frische Dateien bleiben');
select is(
  array[(select count(*)::int from maintenance_storage_objects(:'mt_secret', 0)), (select count(*)::int from maintenance_storage_objects(:'mt_secret', -1))],
  array[1, 1], 'Kandidaten-Grenze: mindestens 1');
select tests.as_postgres();
insert into private.data_exports (user_id, created_at) values (:'b', now() - interval '6 days 23 hours'), (:'b', now() - interval '7 days 1 hour');
select command as cleanup from cron.job where jobname = 'data-exports-cleanup' \gset
:cleanup;
select is((select count(*)::int from private.data_exports where user_id = :'b'), 1, 'Export-Zähler-Job: 7 Tage (6 T 23 h bleibt, 7 T 1 h weg)');
-- Nie bestätigte Konten: ein Konto mit Anmeldung, aber ohne Bestätigung, bleibt; die Rückgabe zählt nur neue Anker.
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa51-unconf@test.local', '{}', now() - interval '8 days', now());
select is(private.queue_unconfirmed_account_deletions(), 1, 'Job: ein nie bestätigtes Konto (8 Tage) wird eingereiht');
-- Die Rückgabe zählt die Kandidaten (Profil-Updates), nicht neu angelegte Anker (Hinweis im Bericht).
select is(private.queue_unconfirmed_account_deletions(), 1, 'Job: zweiter Lauf zählt dasselbe Konto erneut (Rückgabe = Kandidaten)');
select is((select count(*)::int from private.account_deletions d join auth.users u on u.id = d.user_id where u.email = 'qa51-unconf@test.local'),
  1, 'Job: genau eine Ankerzeile');

select * from finish();
rollback;
