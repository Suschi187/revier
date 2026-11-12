-- QA M9b – Abnahme (docs/QA-REPORT.md, Abschnitt „M9b – Abnahme“). Proben über pgTAP 53–55 hinaus:
-- Rechte, Definer und Publikation der neuen Objekte; Dokumentansicht nur für den Admin mit eigenem, frischem Audit
-- genau dieses Antrags (B3, Grenzen 1:59/2:01, aal1, gesperrt, Fälschung des Audits); Upload-Bindung; Flags im SQL
-- ohne Rohrechte wirkungslos; Orakel der Fehlercodes; Meldende und Admins für Betroffene unsichtbar; Konten mit
-- Rolle auf dem Meldungsweg; Wiedereröffnen nach Beschwerde (F1), Ausweichregel bei zwei Admins (F2),
-- Begründung und Mail beim Entfernen des Kartenpunkts (F3), Ergebnis-Mail nach Wiedereröffnung (F4);
-- Warteschlange (Allowlist, gelöschte, gesperrte, unbestätigte Empfänger, claim/confirm/release); Fristen der Jobs an
-- den Grenzen; edited_at nur durch den Besitzer, Pausieren/Fortsetzen ohne neue Prüfung; Export v4; Kaskade der
-- neuen Tabellen bei der Kontolöschung. Alles in einer Transaktion mit Rollback.
begin;
\ir _helpers.psql
select plan(103);

select set_config('storage.allow_delete_query', 'true', true);
select s.decrypted_secret as secret from vault.decrypted_secrets s where s.name = 'search_notifications_secret' \gset
select s.decrypted_secret as msecret from vault.decrypted_secrets s where s.name = 'account_maintenance_secret' \gset

create function tests.q56_err(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;
create function tests.q56_upload(ver uuid) returns void language plpgsql as $$
declare
  v record;
begin
  perform tests.as_postgres();
  select user_id, document_path into v from public.verifications where id = ver;
  perform tests.authenticate_as(v.user_id);
  insert into storage.objects (bucket_id, name, owner_id) values ('verification-docs', v.document_path, v.user_id);
end;
$$;
create function tests.q56_submitted(owner uuid) returns uuid language plpgsql as $$
declare
  ver uuid;
begin
  perform tests.authenticate_as(owner);
  ver := (public.begin_verification('jagdschein') ->> 'id')::uuid;
  perform tests.q56_upload(ver);
  perform tests.authenticate_as(owner);
  perform public.submit_verification(ver);
  perform tests.as_postgres();
  return ver;
end;
$$;
-- Sichtbare Dokumente im Bucket für die aktuelle Rolle (Storage-API nutzt dieselbe Select-Policy).
create function tests.q56_docs(p text) returns integer language sql as $$
  select count(*)::int from storage.objects where bucket_id = 'verification-docs' and name = p;
$$;
create function tests.q56_notes(u uuid, k text) returns integer language sql security definer as $$
  select count(*)::int from private.account_notifications n where n.user_id = u and n.kind = k;
$$;
grant execute on all functions in schema tests to authenticated;

select tests.create_user('q56-o@test.local', 'Olaf56') as o \gset
select tests.create_user('q56-r@test.local', 'Rita56') as r \gset
select tests.create_user('q56-r2@test.local', 'Rolf56') as r2 \gset
select tests.create_user('q56-u@test.local', 'Uwe56') as u \gset
select tests.create_user('q56-adm@test.local', 'Ada56') as adm \gset
select tests.create_user('q56-adm2@test.local', 'Ben56') as adm2 \gset
select tests.make_admin(:'adm');
select tests.make_admin(:'adm2');
-- Beide Admins mit bestätigtem TOTP (Ausweichregel zählt nur solche).
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
values (gen_random_uuid(), :'adm', 'q56a', 'totp', 'verified', now(), now(), 'x'),
       (gen_random_uuid(), :'adm2', 'q56b', 'totp', 'verified', now(), now(), 'x');
select id as dd from regions where code = 'DE-14612' \gset
insert into listings (owner_id, kind, direction, title, content_language, region_id, status, expires_at)
values (:'o', 'helper', 'offer', 'Q56 Revierhilfe', 'de', :'dd', 'active', now() + interval '30 days') returning id as l \gset
select tests.make_ready(:'l');
insert into listings (owner_id, kind, direction, title, content_language, region_id, status, expires_at)
values (:'adm2', 'helper', 'offer', 'Q56 Anzeige eines Admins', 'de', :'dd', 'active', now() + interval '30 days') returning id as la \gset
select tests.make_ready(:'la');

-- ---------------------------------------------------------------------------
-- 1. Rechte, Definer, Publikation
-- ---------------------------------------------------------------------------
select is(
  array(select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in ('begin_verification', 'submit_verification', 'withdraw_verification',
          'decide_verification', 'revoke_verification', 'admin_verification_queue', 'admin_verification', 'admin_open_verification_document',
          'claim_account_notifications', 'confirm_account_notifications', 'release_account_notifications', 'admin_find_account',
          'admin_set_account_blocked', 'admin_warn_account', 'admin_report_queue', 'admin_report_target', 'admin_report_message',
          'resolve_reports', 'my_decisions', 'submit_appeal', 'admin_appeal_queue', 'admin_appeal', 'decide_appeal')
          and (not p.prosecdef or p.proconfig is distinct from array['search_path=""'] or has_function_privilege('anon', p.oid, 'execute'))
        order by 1),
  array[]::name[], 'Alle 23 neuen RPCs: security definer, search_path leer, nicht für anon');
select ok(not has_table_privilege('authenticated', 'public.appeals', 'insert') and not has_table_privilege('authenticated', 'public.appeals', 'update')
          and not has_table_privilege('authenticated', 'public.appeals', 'delete')
          and not exists (select 1 from pg_policies where tablename = 'appeals' and cmd <> 'SELECT'),
  'appeals: kein Schreibrecht und keine Schreib-Policy');
select ok(not has_table_privilege('authenticated', 'public.audit_log', 'insert') and not has_table_privilege('authenticated', 'public.audit_log', 'update')
          and not has_table_privilege('authenticated', 'public.audit_log', 'delete'),
  'audit_log: Admins können verification.document_viewed weder fälschen noch zurückdatieren');
select ok(not has_column_privilege('authenticated', 'public.appeals', 'decided_by', 'select')
          and not has_column_privilege('authenticated', 'public.appeals', 'same_reviewer', 'select')
          and not has_column_privilege('authenticated', 'public.appeals', 'user_id', 'select')
          and not has_column_privilege('authenticated', 'public.reports', 'handled_by', 'select')
          and not has_column_privilege('authenticated', 'public.verifications', 'reviewed_by', 'select'),
  'Admin-Identität in keiner per API lesbaren Spalte (decided_by, same_reviewer, handled_by, reviewed_by)');
select ok(not has_column_privilege('authenticated', 'public.listings', 'edited_at', 'update')
          and not has_column_privilege('authenticated', 'public.listings', 'draft_notice_at', 'update')
          and not has_column_privilege('authenticated', 'public.listings', 'edited_at', 'insert')
          and not has_column_privilege('authenticated', 'public.listings', 'draft_notice_at', 'insert'),
  'edited_at und draft_notice_at: kein Schreibrecht für Nutzer');
select is((select count(*)::int from pg_publication_tables where tablename in ('appeals', 'reports', 'verifications', 'account_notifications', 'verification_attempts')),
  0, 'Keine der Tabellen in einer Realtime-Publikation');
select ok((select relrowsecurity from pg_class where oid = 'public.appeals'::regclass)
          and (select relrowsecurity from pg_class where oid = 'private.account_notifications'::regclass)
          and (select relrowsecurity from pg_class where oid = 'private.verification_attempts'::regclass),
  'RLS auf appeals, account_notifications, verification_attempts');

-- ---------------------------------------------------------------------------
-- 2. Dokumentansicht nur mit eigenem, frischem Audit (B3, Akzeptanz d)
-- ---------------------------------------------------------------------------
select tests.q56_submitted(:'u') as vu \gset
select document_path as pu from verifications where id = :'vu' \gset
select tests.authenticate_as(:'adm', 'aal2');
select is(tests.q56_docs(:'pu'), 0, 'Admin ohne Audit sieht das Objekt nicht');
select admin_open_verification_document(:'vu');
select is(tests.q56_docs(:'pu'), 0, 'F6 behoben: auch nach eigenem Audit kein Zugriff über die Storage-API (nur über verification-document)');
select tests.authenticate_as(:'adm2', 'aal2');
select is(tests.q56_docs(:'pu'), 0, 'Das Audit von Ada gilt nicht für Ben');
select tests.authenticate_as(:'adm', 'aal1');
select is(tests.q56_docs(:'pu'), 0, 'Mit frischem Audit, aber aal1: nicht sichtbar');
select tests.as_postgres();
update profiles set is_blocked = true where user_id = :'adm';
select tests.authenticate_as(:'adm', 'aal2');
select is(tests.q56_docs(:'pu'), 0, 'Gesperrter Admin mit frischem Audit: nicht sichtbar');
select tests.as_postgres();
update profiles set is_blocked = false where user_id = :'adm';
update audit_log set created_at = now() - interval '119 seconds' where action = 'verification.document_viewed' and target_id = :'vu';
select tests.authenticate_as(:'adm', 'aal2');
select is(tests.q56_docs(:'pu'), 0, 'F6 behoben: kein Zeitfenster mehr für die Storage-API');
select tests.as_postgres();
update audit_log set created_at = now() - interval '121 seconds' where action = 'verification.document_viewed' and target_id = :'vu';
select tests.authenticate_as(:'adm', 'aal2');
select is(tests.q56_docs(:'pu'), 0, 'Audit 2:01 alt: nicht mehr sichtbar');
-- Ein frisches Audit für einen anderen Antrag desselben Kontos öffnet dieses Dokument nicht.
select tests.as_postgres();
select tests.q56_submitted(:'r') as vr \gset
select document_path as pr from verifications where id = :'vr' \gset
insert into public.audit_log (actor_id, action, target_type, target_id) values (:'adm', 'verification.document_viewed', 'verification', :'vr');
select tests.authenticate_as(:'adm', 'aal2');
select is(tests.q56_docs(:'pu'), 0, 'Frisches Audit eines anderen Antrags öffnet dieses Dokument nicht');
select is(tests.q56_docs(:'pr'), 0, 'F6 behoben: auch das eigene Ziel nicht über die Storage-API');
select is(tests.q56_err(format($$ select admin_open_verification_document(%L) $$, gen_random_uuid())), 'P0002', 'Unbekannter Antrag: P0002');
select tests.authenticate_as(:'u');
select is(tests.q56_err(format($$ select admin_open_verification_document(%L) $$, :'vu')), '42501', 'Nutzer öffnen keine Dokumente per RPC');
select is(tests.q56_docs(:'pr'), 0, 'Uwe sieht das Dokument von Rita nicht');

-- ---------------------------------------------------------------------------
-- 3. Upload-Bindung und Löschen (A6)
-- ---------------------------------------------------------------------------
select tests.authenticate_as(:'o');
select (begin_verification('jagdschein') ->> 'path') as po_path, (begin_verification('jagdschein') ->> 'id') as po_id \gset
select tests.authenticate_as(:'u');
select is(tests.q56_err(format($$ insert into storage.objects (bucket_id, name, owner_id) values ('verification-docs', %L, %L) $$, :'po_path', :'u')),
  '42501', 'Fremder Pfad eines offenen Antrags: abgelehnt');
select tests.authenticate_as(:'o');
select is(tests.q56_err(format($$ insert into storage.objects (bucket_id, name, owner_id) values ('verification-docs', %L, %L) $$, :'po_path' || '.pdf', :'o')),
  '42501', 'Eigener Pfad mit Anhang: abgelehnt (exakter Name)');
select is(tests.q56_err(format($$ insert into storage.objects (bucket_id, name, owner_id) values ('listing-photos', %L, %L) $$, :'po_path', :'o')),
  '42501', 'Pfad des Antrags in einem anderen Bucket: abgelehnt');
select tests.as_postgres();
update profiles set is_blocked = true where user_id = :'o';
select tests.authenticate_as(:'o');
select is(tests.q56_err(format($$ insert into storage.objects (bucket_id, name, owner_id) values ('verification-docs', %L, %L) $$, :'po_path', :'o')),
  '42501', 'Gesperrtes Konto lädt nicht hoch');
select is(tests.q56_err(format($$ select withdraw_verification(%L) $$, :'po_id')), 'ok', 'Gesperrtes Konto zieht zurück');
select tests.as_postgres();
update profiles set is_blocked = false where user_id = :'o';
select tests.authenticate_as(:'u');
delete from storage.objects where bucket_id = 'verification-docs' and name = :'pu';
select tests.as_postgres();
select is(tests.q56_docs(:'pu'), 1, 'Nach der Einreichung löscht der Besitzer nicht');

-- ---------------------------------------------------------------------------
-- 4. Flags allein öffnen nichts (Rohrechte fehlen, Guards prüfen weiter)
-- ---------------------------------------------------------------------------
select tests.authenticate_as(:'u');
select set_config('revier.verification', 'on', true);
select is(tests.q56_err(format($$ update verifications set status = 'verified' where id = %L $$, :'vu')), '42501',
  'Nutzer mit Flag revier.verification: kein Roh-UPDATE');
select set_config('revier.verification', '', true);
select tests.authenticate_as(:'adm', 'aal2');
select set_config('revier.report', 'on', true);
select is(tests.q56_err($$ update reports set status = 'handled', outcome = 'no_action' $$), '42501', 'Admin mit Flag revier.report: kein Roh-UPDATE an reports');
select set_config('revier.report', '', true);
select is(tests.q56_err(format($$ insert into appeals (user_id, decision_action, text) values (%L, 'x', 'zehn Zeichen mindestens') $$, :'adm')), '42501',
  'Admin: kein Roh-INSERT an appeals');

-- ---------------------------------------------------------------------------
-- 5. Meldung → Entfernen; Meldende und Admins für Betroffene unsichtbar
-- ---------------------------------------------------------------------------
select tests.authenticate_as(:'r');
insert into reports (target_type, target_id, reason, note) values ('listing', :'l', 'weapons', 'Q56 Notiz der Melderin') returning id as rep1 \gset
select tests.authenticate_as(:'adm', 'aal2');
select (admin_report_target('listing', :'l') -> 'listing' ->> 'version') as v \gset
select resolve_reports('listing', :'l', 'content_removed', 'weapons', 'Q56 Begründung Entfernen', :'v');
select tests.authenticate_as(:'o');
select is((select count(*)::int from reports), 0, 'Besitzer liest keine Meldungen über seine Anzeige');
select ok(position(:'r' in (select coalesce(jsonb_agg(to_jsonb(d))::text, '') from my_decisions() d)) = 0
          and position('Rita56' in (select coalesce(jsonb_agg(to_jsonb(d))::text, '') from my_decisions() d)) = 0
          and position('Q56 Notiz' in (select coalesce(jsonb_agg(to_jsonb(d))::text, '') from my_decisions() d)) = 0
          and position(:'adm' in (select coalesce(jsonb_agg(to_jsonb(d))::text, '') from my_decisions() d)) = 0,
  'my_decisions des Besitzers: keine Meldende (ID, Name, Notiz), kein Admin');
select export_my_data() as ex_o \gset
select ok(position(:'r' in :'ex_o') = 0 and position('Rita56' in :'ex_o') = 0 and position('Q56 Notiz' in :'ex_o') = 0
          and position(:'adm' in :'ex_o') = 0 and position('Ada56' in :'ex_o') = 0,
  'Export des Besitzers: keine Meldende, kein Admin');
select is((:'ex_o'::jsonb ->> 'version')::int, 4, 'Export version 4');
select ok((:'ex_o'::jsonb ? 'decisions') and (:'ex_o'::jsonb ? 'appeals')
          and (select bool_and(not (e ? 'id') and not (e ? 'actor_id')) from jsonb_array_elements(:'ex_o'::jsonb -> 'decisions') e),
  'Export: decisions ohne Audit-ID und ohne Akteur');
select tests.as_postgres();
select claim_moderation_notifications(:'secret', 50) as mclaims \gset
select ok(position('q56-r@' in :'mclaims') = 0 and position('Rita56' in :'mclaims') = 0 and position('q56-adm' in :'mclaims') = 0
          and position('Ada56' in :'mclaims') = 0 and position('Q56 Begründung Entfernen' in :'mclaims') > 0,
  'Moderations-Mail: Begründung ja, Meldende und Admin nein');
select ok((select (e ->> 'appeal_until')::timestamptz > now() + interval '182 days' from jsonb_array_elements(:'mclaims'::jsonb) e
           where e ->> 'decision' = 'removed' and e ->> 'email' = 'q56-o@test.local'),
  'Moderations-Mail nennt die Frist zum Anfechten (statt Kontakt-Platzhalter)');
select tests.authenticate_as(:'r');
select ok((select outcome = 'content_removed' from reports where id = :'rep1'), 'Melderin sieht das Ergebnis');
select ok(position(:'adm' in (select coalesce(jsonb_agg(to_jsonb(d))::text, '') from my_decisions() d)) = 0
          and (select code is null and reason is null from my_decisions() where action = 'report.handled'),
  'Melderin: Ergebnis ohne Admin, ohne interne Begründung');

-- Konten mit Rolle auch auf dem Meldungsweg nicht sperren oder verwarnen
select tests.authenticate_as(:'r');
insert into reports (target_type, target_id, reason) values ('listing', :'la', 'scam');
select tests.authenticate_as(:'adm', 'aal2');
select is(tests.q56_err(format($$ select resolve_reports('listing', %L, 'account_blocked', 'scam', 'x') $$, :'la')), '42501',
  'Meldung gegen Anzeige eines Admins: Sperre über resolve_reports abgelehnt');
select is(tests.q56_err(format($$ select resolve_reports('listing', %L, 'account_warned', 'scam', 'x') $$, :'la')), '42501',
  '… Verwarnung ebenso');
select tests.as_postgres();
select ok(not (select is_blocked from profiles where user_id = :'adm2'), 'Admin-Konto bleibt ungesperrt');

-- removed: auch der Besitzer mit gesetztem Flag revier.appeal verlässt es nicht
select tests.authenticate_as(:'o');
select set_config('revier.appeal', 'on', true);
select is(tests.q56_err(format($$ update listings set status = 'pending_review' where id = %L $$, :'l')), '42501',
  'Besitzer mit Flag revier.appeal: removed bleibt (listings_guard)');
select set_config('revier.appeal', '', true);
select is(tests.q56_err(format($$ update listings set title = 'Q56 neuer Titel' where id = %L $$, :'l')), '42501',
  'Besitzer ändert eine entfernte Anzeige nicht');
select tests.authenticate_as(:'adm2', 'aal2');
select is(tests.q56_err(format($$ select moderate_listing(%L, 'approve', %L) $$, :'l', :'v')), 'RV003', 'Admin gibt removed nicht direkt frei');

-- ---------------------------------------------------------------------------
-- 6. Orakel: einheitliche Codes
-- ---------------------------------------------------------------------------
select tests.authenticate_as(:'u');
select is(tests.q56_err(format($$ select withdraw_verification(%L) $$, :'vr')), 'P0002', 'withdraw: fremder Antrag P0002');
select is(tests.q56_err(format($$ select withdraw_verification(%L) $$, gen_random_uuid())), 'P0002', 'withdraw: unbekannt P0002');
select tests.as_postgres();
select decision_audit_id as d_rep1 from reports where id = :'rep1' \gset
select tests.authenticate_as(:'u');
select is(tests.q56_err(format($$ select submit_appeal(%L, 'Fremde Entscheidung anfechten.') $$, :'d_rep1')), 'P0002',
  'submit_appeal: fremde Entscheidung einer Meldenden P0002');
select is(tests.q56_err(format($$ select submit_appeal(%L, 'Audit-ID ohne Entscheidung.') $$,
  (select id from audit_log where action = 'verification.document_viewed' limit 1))), 'P0002',
  'submit_appeal: Audit-Eintrag, der keine Entscheidung ist, P0002');
select is(tests.q56_err(format($$ insert into reports (target_type, target_id, reason) values ('listing', %L, 'other') $$, gen_random_uuid())),
  '42501', 'Melden: unbekanntes Ziel 42501');
select tests.as_postgres();
insert into listings (owner_id, kind, direction, title, content_language, region_id) values (:'o', 'helper', 'offer', 'Q56 Entwurf', 'de', :'dd')
returning id as ldraft \gset
select tests.authenticate_as(:'u');
select is(tests.q56_err(format($$ insert into reports (target_type, target_id, reason) values ('listing', %L, 'other') $$, :'ldraft')),
  '42501', 'Melden: fremder Entwurf (nicht sichtbar) ebenso 42501');
select tests.authenticate_as(:'adm', 'aal2');
select is(tests.q56_err(format($$ select admin_set_account_blocked(%L, true, 'spam') $$, gen_random_uuid())), 'P0002', 'Sperre: unbekanntes Konto P0002');
select is(tests.q56_err(format($$ select decide_appeal(%L, 'upheld', 'x') $$, gen_random_uuid())), 'P0002', 'decide_appeal: unbekannt P0002');

-- ---------------------------------------------------------------------------
-- 7. Konto suchen (A9)
-- ---------------------------------------------------------------------------
select tests.as_postgres();
delete from private.admin_lookups;
select tests.authenticate_as(:'adm', 'aal2');
select is((select display_name from admin_find_account('  Q56-U@Test.Local ')), 'Uwe56', 'Suche: Groß-/Kleinschreibung und Leerzeichen egal');
select is((select count(*)::int from admin_find_account('q56-nobody@test.local')), 0, 'Unbekannte Adresse: leer');
select tests.as_postgres();
select is((select count(*)::int from private.admin_lookups where actor_id = :'adm'), 2, 'Auch erfolglose Suchen zählen zum Limit');
select ok(not exists (select 1 from audit_log where action = 'user.looked_up' and (details::text ilike '%q56%' or details::text like '%@%')),
  'Audit user.looked_up ohne Adresse');
select is((select count(*)::int from audit_log where action = 'user.looked_up' and target_id = :'u'), 1, 'Audit nur für den Treffer');
update profiles set deleted_at = now() where user_id = :'r2';
select tests.authenticate_as(:'adm', 'aal2');
select is((select count(*)::int from admin_find_account('q56-r2@test.local')), 0, 'Konto mit deleted_at: nicht auffindbar');
select tests.as_postgres();
update profiles set deleted_at = null where user_id = :'r2';

-- ---------------------------------------------------------------------------
-- 8. Beschwerden: Wiedereröffnen (F1), Ausweichregel (F2), Ergebnis-Mail (F4)
-- ---------------------------------------------------------------------------
insert into listings (owner_id, kind, direction, title, content_language, region_id, status, expires_at)
values (:'o', 'helper', 'offer', 'Q56 Zweimal gemeldet', 'de', :'dd', 'active', now() + interval '30 days') returning id as l2 \gset
select tests.make_ready(:'l2');
select tests.authenticate_as(:'r2');
insert into reports (target_type, target_id, reason) values ('listing', :'l2', 'scam');
select tests.authenticate_as(:'adm', 'aal2');
select resolve_reports('listing', :'l2', 'no_action', null, 'Erste Prüfung');
select tests.authenticate_as(:'r2');
insert into reports (target_type, target_id, reason) values ('listing', :'l2', 'scam') returning id as rep_l2b \gset
select tests.authenticate_as(:'adm', 'aal2');
select resolve_reports('listing', :'l2', 'no_action', null, 'Zweite Prüfung');
select tests.as_postgres();
select decision_audit_id as d_l2b from reports where id = :'rep_l2b' \gset
update private.account_notifications set done_at = now(), sent_at = now() where user_id = :'r2';
select tests.authenticate_as(:'r2');
select submit_appeal(:'d_l2b', 'Es ist eindeutig Betrug, bitte erneut prüfen.') as ap_l2 \gset
select tests.authenticate_as(:'adm2', 'aal2');
-- F1 behoben (Migration 20261112160000_qa_m9b_fixes)
select is(tests.q56_err(format($$ select decide_appeal(%L, 'reversed', 'Neu prüfen') $$, :'ap_l2')), 'ok',
  'Beschwerde der Meldenden nach zwei Meldezyklen: reversed möglich');
select is((select count(*)::int from reports where target_id = :'l2' and status = 'open'), 1, '… danach genau eine offene Meldung');

-- Einfacher Fall (ein Zyklus): Wiedereröffnen geht; neue Entscheidung → neue Ergebnis-Mail (F4)
select tests.as_postgres();
insert into listings (owner_id, kind, direction, title, content_language, region_id, status, expires_at)
values (:'o', 'helper', 'offer', 'Q56 Einmal gemeldet', 'de', :'dd', 'active', now() + interval '30 days') returning id as l3 \gset
select tests.authenticate_as(:'r2');
insert into reports (target_type, target_id, reason) values ('listing', :'l3', 'scam') returning id as rep_l3 \gset
select tests.authenticate_as(:'adm', 'aal2');
select resolve_reports('listing', :'l3', 'no_action', null, 'Kein Verstoß');
select tests.as_postgres();
select decision_audit_id as d_l3 from reports where id = :'rep_l3' \gset
update private.account_notifications set done_at = now(), sent_at = now() where user_id = :'r2';
select tests.authenticate_as(:'r2');
select submit_appeal(:'d_l3', 'Es ist eindeutig Betrug, bitte erneut prüfen.') as ap_l3 \gset
select tests.authenticate_as(:'adm2', 'aal2');
select is(decide_appeal(:'ap_l3', 'reversed', 'Neu prüfen'), 'reversed', 'Ein Zyklus: Wiedereröffnen per Beschwerde');
select tests.as_postgres();
select is((select status::text from reports where id = :'rep_l3'), 'open', '… Meldung wieder offen');
select tests.authenticate_as(:'adm2', 'aal2');
select resolve_reports('listing', :'l3', 'account_warned', 'scam', 'Verwarnt nach Beschwerde');
select tests.as_postgres();
-- F4 behoben (Migration 20261112160000_qa_m9b_fixes)
select is((select count(*)::int from private.account_notifications where user_id = :'r2' and kind = 'report_resolved' and done_at is null), 1,
  'Nach Wiedereröffnung und neuer Entscheidung: neue Ergebnis-Mail an die Meldende');
select tests.authenticate_as(:'r2');
select is((select count(*)::int from my_decisions() where action = 'report.handled' and target_id = :'l3'), 2,
  'my_decisions zeigt beide Entscheidungen zur Meldung (anfechtbar die neue)');

-- Ausweichregel mit zwei Admins: Anzeige von Ben entfernt Ada; Ben legt Beschwerde ein
select tests.as_postgres();
select tests.authenticate_as(:'adm', 'aal2');
select (admin_report_target('listing', :'la') -> 'listing' ->> 'version') as va \gset
-- F5: Codes der Konto-Maßnahmen passen nicht zu listings.reject_code (die Admin-Seite bietet beide an).
select is(tests.q56_err(format($$ select resolve_reports('listing', %L, 'content_removed', 'scam', 'x', %L) $$, :'la', :'va')), '23514',
  'F5: Entfernen mit Konto-Code „scam“ scheitert am Check von listings.reject_code');
select resolve_reports('listing', :'la', 'content_removed', 'prohibited_content', 'Q56 Admin-Anzeige entfernt', :'va');
select tests.as_postgres();
select id as d_la from audit_log where action = 'listing.removed' and target_id = :'la' \gset
select tests.authenticate_as(:'adm2');
select submit_appeal(:'d_la', 'Meine Anzeige war in Ordnung, bitte prüfen.') as ap_la \gset
select tests.authenticate_as(:'adm2', 'aal2');
select is(tests.q56_err(format($$ select decide_appeal(%L, 'reversed', 'x') $$, :'ap_la')), '42501', 'Ben entscheidet die eigene Beschwerde nicht');
select tests.authenticate_as(:'adm', 'aal2');
-- F2 behoben (Migration 20261112160000_qa_m9b_fixes)
select is(tests.q56_err(format($$ select decide_appeal(%L, 'reversed', 'Neu geprüft') $$, :'ap_la')), 'ok',
  'Zwei Admins, einer ist Beschwerdeführer: Ada entscheidet mit same_reviewer');

-- ---------------------------------------------------------------------------
-- 9. Kartenpunkt entfernen: Begründung und Mail an den Besitzer (F3)
-- ---------------------------------------------------------------------------
select tests.as_postgres();
select id as big from regions where code = 'DE-14628' \gset
insert into listings (owner_id, kind, direction, title, content_language, region_id) values (:'u', 'helper', 'offer', 'Q56 Punkt', 'de', :'big')
returning id as lp \gset
select tests.make_ready(:'lp');
select tests.authenticate_as(:'u');
select set_listing_location(:'lp', :'big', (select postal_code from listing_places where listing_id = :'lp'), 'Testort', 'set', 50.95, 13.95);
update listings set status = 'pending_review' where id = :'lp';
select tests.authenticate_as(:'adm', 'aal2');
select moderate_listing(:'lp', 'approve', admin_listing_version(:'lp'));
select tests.authenticate_as(:'r');
insert into reports (target_type, target_id, reason) values ('listing', :'lp', 'other');
select tests.authenticate_as(:'adm', 'aal2');
select is(resolve_reports('listing', :'lp', 'point_removed', 'other', 'Q56 Hochsitz exakt erkennbar'), 'point_removed', 'Kartenpunkt entfernt');
select tests.as_postgres();
-- F3 behoben (Migration 20261112160000_qa_m9b_fixes)
select tests.authenticate_as(:'u');
select is((select reason from my_decisions() where action = 'listing.point_removed' and target_id = :'lp'), 'Q56 Hochsitz exakt erkennbar',
  'Besitzer sieht die Begründung der Entfernung des Kartenpunkts');
select tests.as_postgres();
select ok(exists (select 1 from private.moderation_notifications where listing_id = :'lp' and decision <> 'approved')
          or exists (select 1 from private.account_notifications where user_id = :'u' and ref_id in
                     (select id from audit_log where action = 'listing.point_removed' and target_id = :'lp')),
  'Besitzer bekommt eine Mail zur Entfernung des Kartenpunkts');

-- ---------------------------------------------------------------------------
-- 10. Dienstmail-Warteschlange (A11)
-- ---------------------------------------------------------------------------
select is(tests.q56_err(format($$ insert into private.account_notifications (kind, user_id, ref_id, payload) values ('account_blocked', %L, gen_random_uuid(), '{"reason":"x"}') $$, :'u')),
  '23514', 'Payload-Allowlist: account_blocked ohne Payload');
select is(tests.q56_err(format($$ insert into private.account_notifications (kind, user_id, ref_id, payload) values ('draft_expiry_notice', %L, gen_random_uuid(), '{"deletes_at":"2027-01-01","title":"x"}') $$, :'u')),
  '23514', 'Payload-Allowlist: draft_expiry_notice nur deletes_at');
select is(tests.q56_err(format($$ insert into private.account_notifications (kind, user_id, ref_id) values ('report_new', %L, gen_random_uuid()) $$, :'u')),
  '23514', 'Unbekannte Art: Check-Constraint');
select ok(not exists (select 1 from information_schema.columns where table_schema = 'private' and table_name = 'account_notifications'
                      and column_name ~ 'mail|address|reason|note|text|title'),
  'Keine Spalte für Adresse oder Freitext in der Warteschlange');
-- Empfänger: gesperrt ja, gelöscht und unbestätigt nein
update private.account_notifications set done_at = now() where done_at is null;
update profiles set is_blocked = true where user_id = :'o';
select tests.authenticate_as(:'adm', 'aal2');
select admin_warn_account(:'r', 'spam', 'Q56 Verwarnung Rita');
select tests.as_postgres();
insert into audit_log (action, target_type, target_id, details) values ('profile.warned', 'profile', :'o', '{"code":"spam","reason":"Q56 gesperrt"}')
returning id as warn_o \gset
insert into private.account_notifications (kind, user_id, ref_id) values ('account_warned', :'o', :'warn_o');
update profiles set deleted_at = now() where user_id = :'r';
update auth.users set email_confirmed_at = null where id = :'u';
insert into audit_log (action, target_type, target_id, details) values ('profile.warned', 'profile', :'u', '{"code":"spam"}') returning id as warn_u \gset
insert into private.account_notifications (kind, user_id, ref_id) values ('account_warned', :'u', :'warn_u');
select is(tests.q56_err($$ select claim_account_notifications('falsch') $$), '42501', 'claim mit falschem Secret: 42501');
select is(tests.q56_err($$ select confirm_account_notifications('falsch', array[gen_random_uuid()]) $$), '42501', 'confirm mit falschem Secret: 42501');
select is(tests.q56_err($$ select release_account_notifications('falsch', array[gen_random_uuid()]) $$), '42501', 'release mit falschem Secret: 42501');
select claim_account_notifications(:'secret', 50) as aclaims \gset
select is((select array_agg(e ->> 'email' order by e ->> 'email') from jsonb_array_elements(:'aclaims'::jsonb) e), array['q56-o@test.local'],
  'Nur das gesperrte Konto bekommt die Mail; gelöscht und unbestätigt: ohne Versand erledigt');
select ok((select bool_and(done_at is not null and sent_at is null) from private.account_notifications where user_id in (:'r', :'u') and kind = 'account_warned'),
  '… die übrigen sind erledigt, nicht versendet');
select ok(not (:'aclaims'::jsonb::text ~ 'user_id|actor|q56-adm|Ada56'), 'Claim ohne Nutzer-ID und ohne Admin');
select (e ->> 'claim_id') as cid from jsonb_array_elements(:'aclaims'::jsonb) e limit 1 \gset
select is(release_account_notifications(:'secret', array[:'cid'::uuid]), 1, 'release gibt frei');
select is((select attempts from private.account_notifications where ref_id = :'warn_o'), 1, '… mit Versuchszähler');
select claim_account_notifications(:'secret', 50) as aclaims2 \gset
select (e ->> 'claim_id') as cid2 from jsonb_array_elements(:'aclaims2'::jsonb) e limit 1 \gset
select is(confirm_account_notifications(:'secret', array[:'cid2'::uuid]), 1, 'confirm bestätigt');
select is(confirm_account_notifications(:'secret', array[:'cid2'::uuid]), 0, 'zweites confirm: nichts mehr offen');
update profiles set deleted_at = null, is_blocked = false where user_id in (:'r', :'o');
update auth.users set email_confirmed_at = now() where id = :'u';

-- ---------------------------------------------------------------------------
-- 11. Fristen an den Grenzen (Aufräumjobs)
-- ---------------------------------------------------------------------------
insert into private.verification_attempts (user_id, created_at) values (:'u', now() - interval '29 days 23 hours'), (:'u', now() - interval '30 days 1 hour');
insert into private.account_notifications (kind, user_id, ref_id, created_at, done_at)
values ('account_warned', :'u', gen_random_uuid(), now() - interval '40 days', now() - interval '29 days 23 hours'),
       ('account_warned', :'u', gen_random_uuid(), now() - interval '40 days', now() - interval '30 days 1 hour');
select private.purge_trust_records();
select is((select count(*)::int from private.verification_attempts where user_id = :'u' and created_at < now() - interval '29 days'), 1,
  'Zählerzeilen: 29 T 23 h bleibt, 30 T 1 h weg');
select is((select count(*)::int from private.account_notifications where user_id = :'u' and created_at < now() - interval '39 days'), 1,
  'Warteschlange: erledigt vor 29 T 23 h bleibt, vor 30 T 1 h weg');
-- Beschwerden: 23 Monate bleibt, 25 Monate weg, offene unabhängig vom Alter
select tests.authenticate_as(:'o');
select tests.as_postgres();
select id as d_any from audit_log where action = 'listing.removed' and target_id = :'l' \gset
insert into appeals (user_id, decision_audit_id, decision_action, text, status, decided_at, decision_note, created_at)
values (:'o', null, 'listing.removed', 'Q56 Beschwerde alt 23', 'upheld', now() - interval '23 months', 'n', now() - interval '24 months'),
       (:'o', null, 'listing.removed', 'Q56 Beschwerde alt 25', 'upheld', now() - interval '25 months', 'n', now() - interval '26 months'),
       (:'o', null, 'listing.removed', 'Q56 Beschwerde offen alt', 'open', null, null, now() - interval '30 months');
select private.purge_trust_records();
select is((select array_agg(text order by text) from appeals where text like 'Q56 Beschwerde%'), array['Q56 Beschwerde alt 23', 'Q56 Beschwerde offen alt'],
  'Beschwerden: 23 Monate bleibt, 25 Monate weg, offene bleiben');
-- Verifizierungsdokumente: 29 Tage nach Entscheidung kein Kandidat, 31 Tage schon; offene nie
select tests.authenticate_as(:'adm', 'aal2');
select decide_verification(:'vr', 'reject', 'unreadable');
select tests.as_postgres();
update verifications set decided_at = now() - interval '29 days' where id = :'vr';
set local session_replication_role = replica;
update verifications set submitted_at = now() - interval '60 days', created_at = now() - interval '60 days' where id = :'vu';
set local session_replication_role = origin;
update storage.objects set created_at = now() - interval '60 days' where name in (:'pu', :'pr');
select is((select count(*)::int from maintenance_storage_objects(:'msecret') where name in (:'pr', :'pu')), 0,
  'Dokumente: 29 Tage nach Entscheidung und offener Antrag (60 Tage alt) kein Kandidat');
update verifications set decided_at = now() - interval '31 days' where id = :'vr';
select is((select reason from maintenance_storage_objects(:'msecret') where name = :'pr'), 'verification_expired', '31 Tage nach Entscheidung: Kandidat');
-- Nicht eingereicht: 23 h bleibt, 25 h weg
select tests.authenticate_as(:'r2');
select (begin_verification('jagdschein') ->> 'id') as v_new \gset
select tests.as_postgres();
set local session_replication_role = replica;
update verifications set created_at = now() - interval '23 hours' where id = :'v_new';
set local session_replication_role = origin;
select private.run_trust_maintenance();
select is((select count(*)::int from verifications where id = :'v_new'), 1, 'Nicht eingereicht, 23 h: bleibt');
set local session_replication_role = replica;
update verifications set created_at = now() - interval '25 hours' where id = :'v_new';
set local session_replication_role = origin;
select private.run_trust_maintenance();
select is((select count(*)::int from verifications where id = :'v_new'), 0, 'Nicht eingereicht, 25 h: gelöscht');
select ok((select count(*) from verifications where id = :'vu') = 1, 'Eingereichter offener Antrag bleibt');

-- Verlassene Entwürfe: Grenze des Hinweises, keine anderen Status, Löschung erst 30 Tage nach dem Hinweis
insert into listings (owner_id, kind, direction, title, content_language, region_id) values
  (:'u', 'helper', 'offer', 'Q56 E knapp', 'de', :'dd'), (:'u', 'helper', 'offer', 'Q56 E fällig', 'de', :'dd');
insert into listings (owner_id, kind, direction, title, content_language, region_id, status, expires_at) values
  (:'u', 'helper', 'offer', 'Q56 aktiv alt', 'de', :'dd', 'active', now() + interval '10 days'),
  (:'u', 'helper', 'offer', 'Q56 pausiert alt', 'de', :'dd', 'paused', now() + interval '10 days');
update listings set edited_at = now() - interval '12 months' + interval '31 days' where title = 'Q56 E knapp';
update listings set edited_at = now() - interval '12 months' + interval '29 days' where title = 'Q56 E fällig';
update listings set edited_at = now() - interval '24 months' where title in ('Q56 aktiv alt', 'Q56 pausiert alt');
update listings set draft_notice_at = null where owner_id = :'u';
select private.run_trust_maintenance();
select is((select array_agg(title order by title) from listings where owner_id = :'u' and draft_notice_at is not null), array['Q56 E fällig'],
  'Hinweis nur für den Entwurf über der Grenze (nicht 1 Tag davor, nicht aktiv/pausiert)');
update listings set draft_notice_at = now() - interval '29 days', edited_at = now() - interval '13 months' where title = 'Q56 E fällig';
select private.run_trust_maintenance();
select is((select count(*)::int from listings where title = 'Q56 E fällig'), 1, 'Hinweis 29 Tage alt: noch nicht gelöscht');
update listings set draft_notice_at = now() - interval '31 days' where title = 'Q56 E fällig';
select private.run_trust_maintenance();
select is((select array_agg(title order by title collate "C") from listings where owner_id = :'u' and title like 'Q56 %' and title <> 'Q56 Punkt'),
  array['Q56 E knapp', 'Q56 aktiv alt', 'Q56 pausiert alt'], 'Nach 31 Tagen nur der verlassene Entwurf gelöscht');

-- edited_at: nur der Besitzer; Admin-Entscheidung und Server zählen nicht; Pausieren/Fortsetzen ohne neue Prüfung
update listings set edited_at = now() - interval '2 years' where title = 'Q56 E knapp';
select tests.authenticate_as(:'adm', 'aal2');
select is(tests.q56_err($$ update listings set title = 'Q56 Admin ändert' where title = 'Q56 E knapp' $$), '42501', 'Admin ändert fremde Entwürfe nicht');
select tests.as_postgres();
select ok((select edited_at < now() - interval '1 year' from listings where title = 'Q56 E knapp'), 'Admin stempelt edited_at nicht');
select tests.authenticate_as(:'u');
select is(tests.q56_err($$ update listings set draft_notice_at = null where title = 'Q56 E knapp' $$), '42501', 'Besitzer setzt draft_notice_at nicht');
select tests.as_postgres();
update listings set status = 'active', expires_at = now() + interval '20 days' where title = 'Q56 aktiv alt';
select tests.make_ready((select id from listings where title = 'Q56 aktiv alt'));
select id as lact from listings where title = 'Q56 aktiv alt' \gset
update listings set status = 'pending_review' where id = :'lact';
select tests.authenticate_as(:'adm', 'aal2');
select moderate_listing(:'lact', 'approve', admin_listing_version(:'lact'));
select tests.authenticate_as(:'u');
update listings set status = 'paused' where id = :'lact';
select tests.as_postgres();
select ok((select edited_at > now() - interval '1 minute' from listings where id = :'lact'), 'Pausieren durch den Besitzer stempelt edited_at');
select tests.authenticate_as(:'u');
update listings set status = 'active' where id = :'lact';
select tests.as_postgres();
select is((select status::text from listings where id = :'lact'), 'active', 'Fortsetzen nach dem Stempel: aktiv ohne neue Prüfung');

-- ---------------------------------------------------------------------------
-- 12. Kontolöschung: neue Tabellen per Kaskade, Admin-Bezug per set null
-- ---------------------------------------------------------------------------
select is((select decided_by from appeals where id = :'ap_l3'), :'adm2'::uuid, 'Vorher: Beschwerde von Ben entschieden');
delete from private.user_roles where user_id = :'adm2';
delete from auth.users where id = :'adm2';
select ok((select decided_by is null and status = 'reversed' from appeals where id = :'ap_l3'),
  'Gelöschter Admin: decided_by wird null, die Beschwerde bleibt');
select tests.authenticate_as(:'r2');
select (begin_verification('jagdschein') ->> 'id') as v_del \gset
select tests.as_postgres();
select ok((select count(*) from appeals where user_id = :'r2') > 0 and (select count(*) from private.verification_attempts where user_id = :'r2') > 0
          and (select count(*) from private.account_notifications where user_id = :'r2') > 0,
  'Vorher: Beschwerden, Zählerzeilen und Mails von Rolf vorhanden');
delete from auth.users where id = :'r2';
select ok((select count(*) from appeals where user_id = :'r2') = 0 and (select count(*) from private.verification_attempts where user_id = :'r2') = 0
          and (select count(*) from private.account_notifications where user_id = :'r2') = 0
          and (select count(*) from verifications where user_id = :'r2') = 0
          and (select count(*) from reports where reporter_id = :'r2') = 0,
  'Nachher: Beschwerden, Zählerzeilen, Mails, Anträge weg, Meldungen pseudonymisiert');

select * from finish();
rollback;
