-- M9a (ADR 019): Aufräumjobs mit Grenzen. Nie bestätigte Konten (6/8 Tage, bestätigt, angemeldet, Apple, Rolle),
-- erledigte Meldungen samt Kopien (11/13 Monate, offene bleiben), Audit (23/25 Monate), Storage-Kandidaten (Secret,
-- 23/25 Stunden, Datei mit und ohne Zeile), Cron-Jobs und Rechte.
begin;
\ir _helpers.psql
select plan(21);

set constraints all immediate;
delete from vault.secrets where name in ('account_deletion_url', 'account_maintenance_url');
select s.decrypted_secret as secret from vault.decrypted_secrets s where s.name = 'account_maintenance_secret' \gset

create function tests.mt_err(statement text) returns text language plpgsql as $$
declare s text;
begin
  execute statement;
  return 'ok';
exception when others then
  get stacked diagnostics s = returned_sqlstate;
  return s;
end;
$$;
create function tests.as_service() returns void language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
end;
$$;
grant usage on schema tests to service_role;
grant execute on all functions in schema tests to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Nie bestätigte Konten
-- ---------------------------------------------------------------------------
create function tests.unconfirmed(email text, days integer, confirmed boolean default false, signed_in boolean default false) returns uuid
language plpgsql as $$
declare id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at, email_confirmed_at, last_sign_in_at)
  values (id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '{}', now() - make_interval(days => days), now(),
          case when confirmed then now() end, case when signed_in then now() end);
  insert into auth.identities (id, user_id, provider, provider_id, identity_data, created_at, updated_at)
  values (gen_random_uuid(), id, 'email', id::text, jsonb_build_object('sub', id::text, 'email', email), now(), now());
  return id;
end;
$$;
select tests.unconfirmed('mt-old@test.local', 8) as old \gset
select tests.unconfirmed('mt-young@test.local', 6) as young \gset
select tests.unconfirmed('mt-confirmed@test.local', 30, true) as confirmed \gset
select tests.unconfirmed('mt-signedin@test.local', 30, false, true) as signedin \gset
select tests.unconfirmed('mt-apple@test.local', 30) as apple \gset
insert into auth.identities (id, user_id, provider, provider_id, identity_data, created_at, updated_at)
  values (gen_random_uuid(), :'apple', 'apple', 'apple-sub', '{}', now(), now());
select tests.unconfirmed('mt-role@test.local', 30) as role_user \gset
insert into private.user_roles (user_id, role) values (:'role_user', 'admin');

select private.queue_unconfirmed_account_deletions() as queued \gset
select is((select array_agg(user_id order by user_id) from private.account_deletions where email like 'mt-%'), array[:'old'::uuid],
  'Nur nie bestätigt, nie angemeldet, älter als 7 Tage, nur email und ohne Rolle');
select isnt((select deleted_at from profiles where user_id = :'old'), null, 'deleted_at gesetzt (sofort nicht öffentlich)');
select is((select deleted_at from profiles where user_id = :'young'), null, '6 Tage alt: bleibt');
select lives_ok('select private.queue_unconfirmed_account_deletions()', 'Wiederholung: kein Fehler');
select is((select count(*)::int from private.account_deletions where email like 'mt-%'), 1, 'Wiederholung: keine zweite Zeile');

-- ---------------------------------------------------------------------------
-- Meldungen und Audit
-- ---------------------------------------------------------------------------
select tests.create_user('mt-reporter@test.local', 'Mt Rita') as r \gset
insert into reports (reporter_id, target_type, target_id, reason, status, handled_at) values
  (:'r', 'profile', gen_random_uuid(), 'scam', 'handled', now() - interval '13 months'),
  (:'r', 'profile', gen_random_uuid(), 'other', 'handled', now() - interval '11 months'),
  (:'r', 'profile', gen_random_uuid(), 'harassment', 'open', null);
-- Neue Meldungen sind immer offen (reports_guard); erledigen und handled_at für die Grenzen zurückdatieren.
update reports set status = 'handled' where reporter_id = :'r' and reason in ('scam', 'other');
update reports set handled_at = now() - interval '13 months' where reporter_id = :'r' and reason = 'scam';
update reports set handled_at = now() - interval '11 months' where reporter_id = :'r' and reason = 'other';
update reports set created_at = now() - interval '20 months' where reporter_id = :'r' and status = 'open';
select is((select handled_at < now() - interval '12 months' from reports where reporter_id = :'r' and reason = 'scam'), true, 'Vorbedingung: zurückdatiert');
select id as old_report from reports where reporter_id = :'r' and reason = 'scam' \gset
insert into private.reported_message_snapshots (report_id, message_id, conversation_id, sender_id, body, message_created_at)
  values (:'old_report', gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'Mt Kopie', now() - interval '14 months');
select private.purge_handled_reports();
select is((select array_agg(reason::text order by reason) from reports where reporter_id = :'r'), array['harassment', 'other'],
  'Erledigt vor 13 Monaten weg, vor 11 Monaten und offene bleiben');
select is((select count(*)::int from private.reported_message_snapshots where body = 'Mt Kopie'), 0, 'Kopie verschwindet mit der Meldung');

insert into audit_log (action, target_type, target_id, created_at) values
  ('mt.old', 'profile', gen_random_uuid(), now() - interval '25 months'),
  ('mt.young', 'profile', gen_random_uuid(), now() - interval '23 months');
select private.purge_audit_log();
select is((select array_agg(action order by action) from audit_log where action like 'mt.%'), array['mt.young'], 'Audit: 25 Monate weg, 23 bleiben');

-- ---------------------------------------------------------------------------
-- Storage-Kandidaten
-- ---------------------------------------------------------------------------
select id as district from regions where code = 'DE-09162' \gset
insert into listings (owner_id, kind, direction, title, content_language, region_id) values (:'r', 'helper', 'wanted', 'Mt Anzeige', 'de', :'district');
select id as l from listings where title = 'Mt Anzeige' \gset
insert into listing_photos (listing_id, sort_order) values (:'l', 0);
select storage_path as kept_path from listing_photos where listing_id = :'l' \gset
insert into storage.objects (bucket_id, name, created_at) values
  ('listing-uploads', :'r' || '/' || :'l' || '/old.jpg', now() - interval '25 hours'),
  ('listing-uploads', :'r' || '/' || :'l' || '/new.jpg', now() - interval '23 hours'),
  ('listing-photos', :'r' || '/' || :'l' || '/orphan-old.jpg', now() - interval '25 hours'),
  ('listing-photos', :'r' || '/' || :'l' || '/orphan-new.jpg', now() - interval '23 hours'),
  ('listing-photos', :'kept_path', now() - interval '30 hours'),
  ('verification-docs', :'r' || '/doc.jpg', now() - interval '30 hours');

select tests.as_service();
select is(tests.mt_err($$ select * from maintenance_storage_objects('falsch') $$), '42501', 'falsches Secret: 42501');
select set_eq(format($$ select name || ':' || reason from maintenance_storage_objects(%L) where name like %L $$, :'secret', :'r' || '/%'),
  array[:'r' || '/' || :'l' || '/old.jpg:upload_expired', :'r' || '/' || :'l' || '/orphan-old.jpg:photo_orphan'],
  'Nur Eingang und Dateien ohne Zeile älter als 24 h; Datei mit Zeile und Dokumente nicht');
select tests.as_postgres();

-- ---------------------------------------------------------------------------
-- Rechte und Jobs
-- ---------------------------------------------------------------------------
select ok(not has_function_privilege('authenticated', 'public.maintenance_storage_objects(text, integer)', 'execute')
          and not has_function_privilege('anon', 'public.maintenance_storage_objects(text, integer)', 'execute')
          and has_function_privilege('service_role', 'public.maintenance_storage_objects(text, integer)', 'execute'),
  'Storage-Kandidaten nur für service_role');
select ok(not has_function_privilege('authenticated', 'private.queue_unconfirmed_account_deletions()', 'execute')
          and not has_function_privilege('authenticated', 'private.purge_handled_reports()', 'execute')
          and not has_function_privilege('authenticated', 'private.purge_audit_log()', 'execute'), 'Jobs nicht über die API');
select is((select schedule from cron.job where jobname = 'unconfirmed-accounts'), '7 4 * * *', 'Job unbestätigte Konten täglich');
select is((select schedule from cron.job where jobname = 'reports-retention'), '27 4 * * *', 'Job Meldungen täglich');
select is((select schedule from cron.job where jobname = 'audit-retention'), '37 4 * * *', 'Job Audit täglich');
select is((select schedule from cron.job where jobname = 'account-maintenance'), '23 * * * *', 'Job Storage stündlich');
select is((select schedule from cron.job where jobname = 'account-deletions'), '* * * * *', 'Job Löschungen jede Minute');
select is((select schedule from cron.job where jobname = 'data-exports-cleanup'), '17 3 * * *', 'Job Export-Zähler täglich');
select lives_ok('select private.trigger_account_maintenance()', 'Ohne URL im Vault: Anstoß tut nichts');
select is((select setting_int from (select private.setting_int('storage_orphan_hours')) s(setting_int)), 24, 'Frist Storage 24 h (Platzhalter)');

select * from finish();
rollback;
