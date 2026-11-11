-- M9a (ADR 019): Löschantrag (frische Anmeldung RV007, MFA RV005, Rolle 42501, gesperrt und ohne Zustimmung
-- erlaubt), Wirkung von deleted_at, Lease der Schritt-RPCs, Backoff und das Rest-Inventar (Akzeptanz a, Simulation):
-- Nach prepare → Löschen aus auth.users → finalize → complete findet eine Suche über alle Nicht-System-Schemas die
-- Nutzer-ID und die E-Mail nur noch in den Spalten der Allowlist. Verbindlich ist der Integrationstest gegen den
-- echten Stack (Commit 4, GoTrue und Storage-API); dieser Test fängt neue Tabellen früh ab.
begin;
\ir _helpers.psql
select plan(48);

set constraints all immediate;
select s.decrypted_secret as secret from vault.decrypted_secrets s where s.name = 'account_deletion_secret' \gset
-- Kein Anstoß an eine echte URL aus diesem Test (die Transaktion endet mit Rollback, pg_net sendet ohnehin nicht).
delete from vault.secrets where name = 'account_deletion_url';

create function tests.del_err(statement text) returns text language plpgsql as $$
declare s text; h text;
begin
  execute statement;
  return 'ok';
exception when others then
  get stacked diagnostics s = returned_sqlstate, h = pg_exception_hint;
  return s || coalesce(' ' || nullif(h, ''), '');
end;
$$;
grant execute on function tests.del_err(text) to anon, authenticated, service_role;

-- Angemeldet mit einer Anmeldung per `method` vor `minutes_ago` Minuten (amr wie GoTrue, gemessen in ADR 019).
create function tests.login_as(uid uuid, method text, minutes_ago integer, aal text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', uid, 'role', 'authenticated', 'aal', aal,
    'amr', jsonb_build_array(jsonb_build_object('method', method,
      'timestamp', extract(epoch from now() - make_interval(mins => minutes_ago))::bigint)))::text, true);
end;
$$;
grant execute on function tests.login_as(uuid, text, integer, text) to authenticated;

create function tests.as_service() returns void language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
end;
$$;
grant execute on function tests.as_service() to authenticated;

-- Rest-Inventar (Review B2): jede Tabelle aller Nicht-System-Schemas, alle Spalten außer Geometrie/Binärdaten als
-- Text, Nutzer-ID und E-Mail ohne Groß-/Kleinschreibung. `allowed` nennt je Tabelle die Spalten der Allowlist
-- (ADR 019, „Was bleibt“), die nicht mitgesucht werden. Nicht lesbare Tabellen erscheinen mit -1.
create function tests.residue(uid uuid, mail text, allowed jsonb) returns table (rel text, hits bigint) language plpgsql as $$
declare
  r record;
  cols text;
  n bigint;
begin
  for r in
    select c.oid, n.nspname, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p') and not c.relispartition
      and n.nspname !~ '^pg_' and n.nspname not in ('information_schema', 'tests')
  loop
    select string_agg(format('%I::text', a.attname), ', ') into cols
    from pg_attribute a join pg_type t on t.oid = a.atttypid
    where a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped
      and t.typname not in ('geometry', 'geography', 'bytea', 'raster')
      and not coalesce(allowed -> (r.nspname || '.' || r.relname) ? a.attname, false);
    continue when cols is null;
    begin
      execute format('select count(*) from %I.%I where position(%L in lower(concat_ws(%L, %s))) > 0 or position(%L in lower(concat_ws(%L, %s))) > 0',
        r.nspname, r.relname, uid::text, '|', cols, lower(mail), '|', cols) into n;
    exception when insufficient_privilege then
      n := -1;
    end;
    if n <> 0 then
      rel := r.nspname || '.' || r.relname;
      hits := n;
      return next;
    end if;
  end loop;
end;
$$;

-- Die Rollenwechsel laufen auch aus anon und service_role heraus.
grant usage on schema tests to service_role;
grant execute on all functions in schema tests to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Fixture: U wird gelöscht, V ist das Gegenüber, X ein unbeteiligtes Konto.
-- ---------------------------------------------------------------------------
select tests.create_user('del-u@test.local', 'Del Ute') as u \gset
select tests.create_user('del-v@test.local', 'Del Vera') as v \gset
select tests.create_user('del-x@test.local', 'Del Xaver', false) as x \gset
select id as district from regions where code = 'DE-09162' \gset
insert into listings (owner_id, kind, direction, title, content_language, region_id, status, expires_at, published_at) values
  (:'u', 'helper', 'wanted', 'Del Anzeige U', 'de', :'district', 'active', now() + interval '30 days', now()),
  (:'v', 'helper', 'wanted', 'Del Anzeige V', 'de', :'district', 'active', now() + interval '30 days', now());
select id as lu from listings where title = 'Del Anzeige U' \gset
select id as lv from listings where title = 'Del Anzeige V' \gset
select tests.make_ready(:'lu');
insert into listing_photos (listing_id, sort_order, storage_path, alt_text) values (:'lu', 0, :'u' || '/' || :'lu' || '/a.jpg', 'Foto');
insert into favorites (user_id, listing_id) values (:'u', :'lv'), (:'v', :'lu');
insert into blocks (blocker_id, blocked_id) values (:'u', :'x');
insert into devices (user_id, apns_token, platform, language) values (:'u', repeat('a', 64), 'ios', 'de');
insert into saved_searches (user_id, name, filters) values (:'u', 'Del Suche', '{"v": 1, "kind": "helper"}');
insert into verifications (user_id, document_type, document_path) values (:'u', 'jagdschein', :'u' || '/doc.jpg');
insert into private.unsubscribe_tokens (token_hash, user_id, scope, target_ids) values (extensions.digest('del-token', 'sha256'), :'u', 'chat', '{}');

select tests.authenticate_as(:'u');
select start_conversation(:'lv', 'Del Frage von Ute') as c1 \gset
select tests.authenticate_as(:'v');
select send_message(:'c1', 'Del Antwort von Vera') as m_v \gset
select tests.authenticate_as(:'u');
select send_message(:'c1', 'Del Zweite Nachricht von Ute') as m_u \gset
-- U meldet eine Anzeige von V; V meldet eine Nachricht von U (Kopie bleibt) und das Profil von U (bleibt).
insert into reports (target_type, target_id, reason) values ('listing', :'lv', 'scam');
select tests.authenticate_as(:'v');
insert into reports (target_type, target_id, reason) values ('message', :'m_u', 'harassment'), ('profile', :'u', 'scam');
select tests.as_postgres();
-- Audit mit der ID in den Details (wie Verifizierungsentscheidungen) und als Ziel; Auth-Reste ohne FK; Realtime.
insert into audit_log (actor_id, action, target_type, target_id, details) values
  (:'v', 'verification.verified', 'verification', gen_random_uuid(), jsonb_build_object('user_id', :'u')),
  (:'v', 'profile.blocked', 'profile', :'u', '{}'),
  (:'u', 'listing.active', 'listing', :'lu', '{}');
insert into auth.audit_log_entries (id, payload, created_at) values
  (gen_random_uuid(), jsonb_build_object('actor_id', :'u', 'action', 'login'), now()),
  (gen_random_uuid(), jsonb_build_object('actor_username', 'DEL-U@test.local', 'action', 'user_deleted'), now());
insert into auth.flow_state (id, user_id, provider_type, authentication_method, code_challenge, code_challenge_method, auth_code)
  values (gen_random_uuid(), :'u', 'email', 'magiclink', 'x', 's256', 'y');
insert into realtime.messages (topic, extension, payload, private) values
  ('user:' || :'u', 'broadcast', '{}'::jsonb, true),
  ('user:' || :'v', 'broadcast', jsonb_build_object('sender_id', :'u'), true);

-- ---------------------------------------------------------------------------
-- Löschantrag
-- ---------------------------------------------------------------------------
select tests.as_anon();
select is(tests.del_err('select request_account_deletion()'), '42501', 'anon: kein Zugriff (42501)');
select tests.authenticate_as(:'u');
select is(tests.del_err('select request_account_deletion()'), 'RV007 {"reauth":"required"}', 'ohne amr: RV007 mit hint reauth');
select tests.login_as(:'u', 'otp', 11);
select is(tests.del_err('select request_account_deletion()'), 'RV007 {"reauth":"required"}', 'Anmeldung älter als 10 Minuten: RV007');
select tests.login_as(:'u', 'totp', 0, 'aal2');
select is(tests.del_err('select request_account_deletion()'), 'RV007 {"reauth":"required"}', 'nur totp zählt nicht: RV007');
select tests.as_postgres();
select is((select deleted_at from profiles where user_id = :'u'), null, 'abgelehnte Anträge setzen kein deleted_at');

-- Konto mit Rolle: erst entziehen (Rolleneintrag, unabhängig von aal).
insert into private.user_roles (user_id, role) values (:'u', 'admin');
select tests.login_as(:'u', 'otp', 1);
select is(tests.del_err('select request_account_deletion()'), '42501 {"reason":"admin_role"}', 'Konto mit Rolle (aal1): 42501 admin_role');
select tests.login_as(:'u', 'otp', 1, 'aal2');
select is(tests.del_err('select request_account_deletion()'), '42501 {"reason":"admin_role"}', 'Konto mit Rolle (aal2): 42501 admin_role');
select tests.as_postgres();
delete from private.user_roles where user_id = :'u';

-- Ehemaliger Admin mit bestätigtem Faktor: aal2 nötig.
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
  values (gen_random_uuid(), :'u', 'Del', 'totp', 'verified', now(), now(), 'JBSWY3DPEHPK3PXP');
select tests.login_as(:'u', 'otp', 1);
select is(tests.del_err('select request_account_deletion()'), 'RV005', 'bestätigter Faktor und aal1: RV005');

-- Gesperrt und ohne Zustimmung erlaubt (App Store, DSGVO): X.
select tests.as_postgres();
update profiles set is_blocked = true where user_id = :'x';
select tests.login_as(:'x', 'otp', 2);
select is(tests.del_err('select request_account_deletion()'), 'ok', 'gesperrt und ohne Zustimmung: erlaubt');
select tests.as_postgres();
select isnt((select deleted_at from profiles where user_id = :'x'), null, 'X: deleted_at gesetzt');

-- U mit frischem Code und aal2.
select tests.login_as(:'u', 'otp', 1, 'aal2');
select is(tests.del_err('select request_account_deletion()'), 'ok', 'frische Anmeldung (otp) und aal2: erlaubt');
select tests.as_postgres();
select deleted_at as deleted_at_u from profiles where user_id = :'u' \gset
select tests.login_as(:'u', 'oauth', 3, 'aal2');
select is(tests.del_err('select request_account_deletion()'), 'ok', 'Wiederholung (Apple/oauth): kein Fehler');
select tests.as_postgres();
select is((select deleted_at from profiles where user_id = :'u'), :'deleted_at_u'::timestamptz, 'deleted_at bleibt bei Wiederholung');
select is((select count(*)::int from private.account_deletions where user_id = :'u'), 1, 'genau eine Ankerzeile');
select is((select lower(email) from private.account_deletions where user_id = :'u'), 'del-u@test.local', 'Ankerzeile mit E-Mail-Snapshot');

-- Wirkung von deleted_at: nicht öffentlich, nicht beschreibbar.
select ok(not private.is_active_user(:'u'), 'gelöschtes Konto ist nicht aktiv');
select tests.as_anon();
select is((select count(*)::int from public_profiles where user_id = :'u'), 0, 'Profil nicht öffentlich');
select is((select count(*)::int from listings where id = :'lu'), 0, 'Anzeige nicht öffentlich');
select tests.login_as(:'u', 'otp', 1, 'aal2');
select isnt(tests.del_err(format($$ select send_message(%L, 'Nach der Löschung') $$, :'c1')), 'ok', 'kein Schreiben im Chat mehr');

-- ---------------------------------------------------------------------------
-- Rechte und Lease
-- ---------------------------------------------------------------------------
select tests.as_postgres();
select ok(not has_function_privilege('authenticated', 'public.account_deletion_claim(text, integer)', 'execute')
          and not has_function_privilege('anon', 'public.account_deletion_finalize(uuid, uuid)', 'execute')
          and not has_function_privilege('authenticated', 'public.account_deletion_prepare(uuid, uuid)', 'execute'),
  'Schritt-RPCs nur für service_role');
select ok(not has_function_privilege('service_role', 'public.request_account_deletion()', 'execute')
          and not has_function_privilege('anon', 'public.request_account_deletion()', 'execute'), 'Löschantrag nur für authenticated');
select ok(not has_table_privilege('service_role', 'private.account_deletions', 'select')
          and not has_table_privilege('authenticated', 'private.account_deletions', 'select'), 'Ankerzeilen nicht über die API lesbar');

select tests.as_service();
select is(tests.del_err($$ select * from account_deletion_claim('falsch') $$), '42501', 'Claim mit falschem Secret: 42501');
select is(tests.del_err(format($$ select account_deletion_prepare(gen_random_uuid(), %L) $$, :'u')), '42501', 'Schritt ohne Lease: 42501');

-- X zurückstellen, damit der Claim U liefert.
select tests.as_postgres();
update private.account_deletions set next_attempt_at = now() + interval '1 day' where user_id = :'x';
select tests.as_service();
select claim_id as claim, attempts from account_deletion_claim(:'secret', 5) where user_id = :'u' \gset
select is(:attempts, 1, 'Claim liefert U mit attempts = 1');
select is((select count(*)::int from account_deletion_claim(:'secret', 5)), 0, 'laufender Lease: kein zweiter Claim');
select tests.as_postgres();
select ok((select next_attempt_at between now() + interval '55 seconds' and now() + interval '65 seconds' from private.account_deletions where user_id = :'u'),
  'Backoff nach dem ersten Claim: 1 Minute');

-- Fehler: Lease frei, Backoff bleibt; der nächste Claim verdoppelt.
select tests.as_service();
select account_deletion_fail(:'claim', :'u');
select tests.as_postgres();
select is((select claim_id from private.account_deletions where user_id = :'u'), null, 'Fehler gibt den Lease frei');
update private.account_deletions set next_attempt_at = now() - interval '1 second' where user_id = :'u';
select tests.as_service();
select claim_id as claim from account_deletion_claim(:'secret', 5) where user_id = :'u' \gset
select tests.as_postgres();
select ok((select attempts = 2 and next_attempt_at between now() + interval '115 seconds' and now() + interval '125 seconds'
           from private.account_deletions where user_id = :'u'), 'zweiter Versuch: Backoff 2 Minuten');
update private.account_deletions set attempts = 40 where user_id = :'x';
select tests.as_service();
select is(tests.del_err(format($$ select account_deletion_complete(%L, %L) $$, :'claim', :'u')), '55000', 'complete vor deleteUser: 55000');
select is(tests.del_err(format($$ select account_deletion_finalize(%L, %L) $$, :'claim', :'u')), '55000', 'finalize vor deleteUser: 55000');

-- ---------------------------------------------------------------------------
-- Ablauf und Rest-Inventar (Akzeptanz a, Simulation ohne Storage und GoTrue)
-- ---------------------------------------------------------------------------
select tests.as_postgres();
insert into storage.objects (bucket_id, name, owner_id) values ('listing-photos', :'u' || '/' || :'lu' || '/a.jpg', :'u');
select tests.as_service();
select is((select count(*)::int from account_deletion_objects(:'claim', :'u')), 1, 'Objektliste findet die Datei unter {user_id}/');
select account_deletion_prepare(:'claim', :'u');
select tests.as_postgres();
select is((select count(*)::int from audit_log where details ->> 'user_id' = :'u'), 0, 'prepare entfernt user_id aus den Audit-Details');
-- Storage löscht die Function über die API; hier nur die Zeile, damit das Inventar die übrigen Tabellen prüft.
select is(split_part(tests.del_err(format($$ delete from storage.objects where name like %L $$, :'u' || '/%')), ' ', 1), '42501', 'Storage-Zeilen sind per SQL nicht löschbar');
set local storage.allow_delete_query = 'true';
delete from storage.objects where name like :'u' || '/%';
reset storage.allow_delete_query;
delete from auth.users where id = :'u';
select tests.as_service();
select lives_ok(format($$ select account_deletion_finalize(%L, %L) $$, :'claim', :'u'), 'finalize nach deleteUser');
select lives_ok(format($$ select account_deletion_finalize(%L, %L) $$, :'claim', :'u'), 'finalize ist idempotent');
select lives_ok(format($$ select account_deletion_complete(%L, %L) $$, :'claim', :'u'), 'complete entfernt die Ankerzeile');
select tests.as_postgres();

select is(
  array(select rel || ' (' || hits || ')' from tests.residue(:'u', 'del-u@test.local', jsonb_build_object(
    'public.audit_log', jsonb_build_array('target_id'),
    'public.reports', jsonb_build_array('target_id'),
    'private.reported_message_snapshots', jsonb_build_array('sender_id'))) order by 1),
  '{}'::text[], 'Rest-Inventar: Nutzer-ID und E-Mail nur noch in der Allowlist (ADR 019)');
select ok((select count(*) >= 5 from tests.residue(:'v', 'del-v@test.local', '{}')), 'Selbsttest: das Inventar findet die Daten eines bestehenden Kontos');
select is((select count(*)::int from reports where target_id = :'u'), 1, 'Rest: Meldung gegen das Profil bleibt');
select is((select count(*)::int from private.reported_message_snapshots where sender_id = :'u'), 1, 'Rest: Kopie der gemeldeten Nachricht bleibt');
select is((select count(*)::int from audit_log where target_id = :'u' and actor_id is not null), 1, 'Rest: Audit gegen das Konto bleibt (Akteur V)');
select is((select count(*)::int from messages where id = :'m_v'), 0, 'nie gemeldete Nachrichten verschwinden auch beim Gegenüber');
select is((select count(*)::int from listings where id = :'lv'), 1, 'Daten des Gegenübers bleiben');
select is((select count(*)::int from realtime.messages where payload ->> 'sender_id' = :'u'), 0, 'Realtime-Ereignisse mit der ID beim Gegenüber entfernt');
select ok((select count(*) > 0 from realtime.messages where topic = 'user:' || :'v'), 'eigene Realtime-Ereignisse des Gegenübers bleiben');

-- Admin-Übersicht: nur Anzahl, nur Admins mit aal2.
select tests.make_admin(:'v');
select tests.authenticate_as(:'v', 'aal2');
select is(admin_stuck_account_deletions(), 1, 'hängende Löschungen: Anzahl ab 10 Versuchen');
select tests.authenticate_as(:'v', 'aal1');
select is(tests.del_err('select admin_stuck_account_deletions()'), '42501', 'hängende Löschungen: nicht mit aal1');

select * from finish();
rollback;
