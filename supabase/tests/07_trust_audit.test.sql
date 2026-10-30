begin;
\ir _helpers.psql
select plan(43);

select tests.create_user('a@test.local') as a_id \gset
select tests.create_user('b@test.local') as b_id \gset
select tests.create_user('admin@test.local') as admin_id \gset
select tests.make_admin(:'admin_id');
select id as district from regions where code = 'AT-601' \gset

select tests.as_postgres();
insert into listings (owner_id, kind, direction, title, content_language, region_id, status, expires_at)
values (:'b_id', 'trophy_hunt', 'offer', 'Gamsjagd', 'de', :'district', 'active', now() + interval '30 days') returning id as listing \gset
insert into listings (owner_id, kind, direction, title, content_language, region_id)
values (:'b_id', 'lease', 'offer', 'Entwurf', 'de', :'district') returning id as draft \gset

-- Verifizierungen: Akzeptanzkriterium M1 (Verifizierungsdokumente) ------------------
select tests.authenticate_as(:'a_id');
insert into verifications (document_path, document_type) values (:'a_id' || '/jagdschein.jpg', 'jagdschein') returning id as ver_a \gset
select is((select verification_status::text from profiles where user_id = :'a_id'), 'pending', 'Antrag setzt das Profil auf pending');
select throws_ok(format($$ insert into verifications (document_path, document_type) values (%L, 'jagdschein') $$, :'b_id' || '/fremd.jpg'),
  '23514', null, 'Dokumentpfad muss im eigenen Ordner liegen');
select throws_ok(format($$ insert into verifications (document_path, document_type) values (%L, 'jagdkarte') $$, :'a_id' || '/zweites.jpg'),
  '23505', null, 'Nur ein offener Antrag gleichzeitig');
update verifications set status = 'verified' where id = :'ver_a';
select is((select status::text from verifications where id = :'ver_a'), 'pending', 'Nutzer verifiziert sich nicht selbst');

select tests.authenticate_as(:'b_id');
select is((select count(*)::int from verifications), 0, 'B liest die Verifizierung von A nicht');
select tests.as_anon();
select throws_ok($$ select * from verifications $$, '42501', null, 'anon liest keine Verifizierungen');
select tests.authenticate_as(:'admin_id', 'aal1');
select is((select count(*)::int from verifications), 0, 'Admin ohne 2FA liest keine Verifizierungen');

select tests.authenticate_as(:'admin_id', 'aal2');
select is((select count(*)::int from verifications), 1, 'Admin mit 2FA liest Verifizierungen');
select throws_ok(format($$ update verifications set status = 'rejected' where id = %L $$, :'ver_a'), '23514', null, 'Ablehnung braucht einen Grund');
update verifications set status = 'verified' where id = :'ver_a';
select tests.as_postgres();
select results_eq(format($$ select reviewed_by, decided_at is not null from verifications where id = %L $$, :'ver_a'),
  format($$ values (%L::uuid, true) $$, :'admin_id'), 'Entscheidung setzt Prüfer und Datum');
select tests.authenticate_as(:'admin_id', 'aal2');
select throws_ok(format($$ update verifications set reject_reason = 'nachträglich' where id = %L $$, :'ver_a'), '42501', null,
  'Grund einer entschiedenen Verifizierung ist unveränderlich');
select tests.authenticate_as(:'a_id');
select throws_ok($$ select reviewed_by from verifications $$, '42501', null, 'Antragsteller sieht nicht, welcher Admin geprüft hat');
select tests.authenticate_as(:'admin_id', 'aal2');
select is((select verification_status::text from profiles where user_id = :'a_id'), 'verified', 'Profil wird verifiziert');
select throws_ok(format($$ update verifications set status = 'rejected', reject_reason = 'doch nicht' where id = %L $$, :'ver_a'), '42501', null,
  'Entschiedene Verifizierungen sind abgeschlossen');

select tests.authenticate_as(:'a_id');
insert into verifications (document_path, document_type) values (:'a_id' || '/jagdkarte.jpg', 'jagdkarte');
select is((select verification_status::text from profiles where user_id = :'a_id'), 'verified', 'Neuer Antrag hebt eine bestehende Verifizierung nicht auf');

-- Meldungen -------------------------------------------------------------------
select tests.authenticate_as(:'a_id');
insert into reports (target_type, target_id, reason, note) values ('listing', :'listing', 'scam', 'Vorkasse verlangt') returning id as rep \gset
select is((select status::text from reports where id = :'rep'), 'open', 'A meldet eine Anzeige und sieht den Stand');
select throws_ok(format($$ insert into reports (target_type, target_id, reason) values ('listing', %L, 'scam') $$, :'draft'), '42501', null,
  'Nicht sichtbare Ziele lassen sich nicht melden');
select throws_ok(format($$ insert into reports (target_type, target_id, reason) values ('profile', %L, 'harassment') $$, gen_random_uuid()), '42501', null,
  'Erfundene IDs lassen sich nicht melden');
update reports set status = 'handled' where id = :'rep';
select is((select status::text from reports where id = :'rep'), 'open', 'Meldende erledigen ihre Meldung nicht selbst');

select tests.authenticate_as(:'b_id');
select is((select count(*)::int from reports), 0, 'Gemeldeter sieht die Meldung nicht');

select tests.authenticate_as(:'admin_id', 'aal2');
update reports set status = 'handled' where id = :'rep';
select tests.as_postgres();
select is((select handled_by from reports where id = :'rep'), :'admin_id'::uuid, 'Erledigt setzt handled_by');
select tests.authenticate_as(:'a_id');
select throws_ok($$ select handled_by from reports $$, '42501', null, 'Meldende sehen nicht, welcher Admin entschieden hat');
select is((select status::text from reports where id = :'rep'), 'handled', 'Meldende sehen den Stand ihrer Meldung');

select tests.authenticate_as(:'a_id');
insert into reports (target_type, target_id, reason) select 'listing', :'listing', 'other' from generate_series(1, 19);
select throws_ok(format($$ insert into reports (target_type, target_id, reason) values ('listing', %L, 'other') $$, :'listing'), '54000', null,
  'Höchstens 20 Meldungen in 24 Stunden');

-- Audit-Log -------------------------------------------------------------------
select tests.authenticate_as(:'admin_id', 'aal2');
update listings set status = 'removed', reject_code = 'prohibited_content', reject_reason = 'Betrug' where id = :'listing';
select tests.as_postgres();
update profiles set is_blocked = true where user_id = :'b_id';
select set_eq($$ select action from audit_log $$,
  array['verification.verified', 'report.handled', 'listing.removed', 'profile.blocked'],
  'Moderationsentscheidungen und Sperren stehen im Audit-Log');
select is((select actor_id from audit_log where action = 'listing.removed'), :'admin_id'::uuid, 'Audit-Log nennt den handelnden Admin');

select tests.authenticate_as(:'admin_id', 'aal2');
select is((select count(*)::int from audit_log), 4, 'Admin mit 2FA liest das Audit-Log');
select throws_ok($$ insert into audit_log (action, target_type, target_id) values ('x.y', 'x', gen_random_uuid()) $$, '42501', null,
  'Auch Admins schreiben nicht direkt ins Audit-Log');
select throws_ok($$ delete from audit_log $$, '42501', null, 'Niemand löscht Einträge über die API');
select tests.authenticate_as(:'a_id');
select is((select count(*)::int from audit_log), 0, 'Nutzer lesen das Audit-Log nicht');

-- Bewertungen: Phase 2, gesperrt ---------------------------------------------------
select tests.authenticate_as(:'a_id');
select is((select count(*)::int from reviews), 0, 'Bewertungen sind für Nutzer nicht lesbar');
select throws_ok(format($$ insert into reviews (conversation_id, author_id, target_id, rating) values (gen_random_uuid(), %L, %L, 5) $$, :'a_id', :'b_id'),
  '42501', null, 'Bewertungen lassen sich vor Phase 2 nicht anlegen');

-- Geräte: Registrierung nur per RPC, Token wandert mit dem Konto (Review M1) -------
select tests.authenticate_as(:'a_id');
select lives_ok(format($$ select register_device(%L, 'de') $$, repeat('ab', 32)), 'A registriert ein Gerät per RPC');
select is((select count(*)::int from devices), 1, 'A sieht das eigene Gerät');
select throws_ok(format($$ insert into devices (apns_token) values (%L) $$, repeat('cd', 32)), '42501', null, 'Direktes Anlegen ist gesperrt');
-- B ist oben gesperrt worden; für den Kontowechsel ein frisches Konto C.
select tests.as_postgres();
select tests.create_user('c@test.local') as c_id \gset
select tests.authenticate_as(:'c_id');
select is((select count(*)::int from devices), 0, 'C sieht die Geräte von A nicht');
select lives_ok(format($$ select register_device(%L, 'pl') $$, repeat('ab', 32)), 'C meldet sich auf demselben Gerät an');
select tests.as_postgres();
select results_eq(format($$ select user_id, language::text from devices where apns_token = %L $$, repeat('ab', 32)),
  format($$ values (%L::uuid, 'pl') $$, :'c_id'), 'Token gehört jetzt C, Pushes für A landen nicht mehr bei C');
select tests.authenticate_as(:'b_id');
select throws_ok(format($$ select register_device(%L) $$, repeat('12', 32)), '42501', null, 'Gesperrte Konten registrieren keine Geräte');
select tests.as_anon();
select throws_ok(format($$ select register_device(%L) $$, repeat('ef', 32)), '42501', null, 'anon registriert keine Geräte');

-- Pseudonymisierung bei Account-Löschung (ADR 008) --------------------------------
select tests.as_postgres();
delete from auth.users where id = :'admin_id';
select is((select count(*)::int from audit_log where actor_id is null and action not like 'role.%'), 4, 'Audit-Einträge bleiben, Admin-ID wird entfernt');
-- Die Rolle fällt per Kaskade weg; der Trigger auf user_roles protokolliert das (ADR 014).
select is((select details ->> 'via' from audit_log where action = 'role.revoked' and target_id = :'admin_id'), 'sql',
  'Wegfall der Admin-Rolle beim Löschen ist protokolliert');
delete from auth.users where id = :'a_id';
select is((select count(*)::int from reports where reporter_id is null), 20, 'Meldungen bleiben pseudonymisiert erhalten');

select * from finish();
rollback;
