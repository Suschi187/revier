begin;
\ir _helpers.psql
select plan(25);

select tests.create_user('a@test.local', accepted => false) as a_id \gset
select tests.create_user('b@test.local', accepted => false) as b_id \gset
select tests.create_user('admin@test.local', accepted => false) as admin_id \gset
select tests.make_admin(:'admin_id');

-- Ausgangslage: keine Zustimmung
select tests.authenticate_as(:'a_id');
select results_eq($$ select terms_version, privacy_version, accepted from legal_status() $$,
  $$ values ('2026-10-draft'::text, '2026-10-draft'::text, false) $$, 'legal_status liefert aktuelle Versionen, noch nicht zugestimmt');
select ok(not private.has_accepted_current_legal(), 'DB-Gate: ohne Zustimmung false');
-- Als Funktionseigentümer mit den Claims von A (wie in einer security-definer-RPC ab M3).
select set_config('role', 'postgres', true);
select throws_ok($$ select private.require_current_legal() $$, 'RV001', 'legal_consent_required', 'require_current_legal: eigener Fehlercode ohne Zustimmung');
select tests.authenticate_as(:'a_id');

-- Zustimmen
select throws_ok($$ select accept_legal('2025-01', '2026-10-draft', 'web') $$, '22023', null, 'Veraltete AGB-Version wird abgelehnt');
select throws_ok($$ select accept_legal('2026-10-draft', null, 'web') $$, '22023', null, 'Fehlende Datenschutz-Version wird abgelehnt');
select is((select count(*)::int from legal_acceptances), 0, 'Abgelehnte Zustimmung schreibt nichts');
select lives_ok($$ select accept_legal('2026-10-draft', '2026-10-draft', 'web') $$, 'A stimmt der aktuellen Version zu');
select lives_ok($$ select accept_legal('2026-10-draft', '2026-10-draft', 'ios') $$, 'Wiederholung ist harmlos (idempotent)');
select results_eq($$ select document::text, version, source::text from legal_acceptances order by document $$,
  $$ values ('privacy', '2026-10-draft', 'web'), ('terms', '2026-10-draft', 'web') $$, 'Je Dokument genau ein Nachweis mit Herkunft');
select ok((select accepted from legal_status()), 'legal_status: zugestimmt');
select ok(private.has_accepted_current_legal(), 'DB-Gate: mit Zustimmung true');
select set_config('role', 'postgres', true);
select lives_ok($$ select private.require_current_legal() $$, 'require_current_legal: mit Zustimmung kein Fehler');
select tests.authenticate_as(:'a_id');

-- Nachweis ist unveränderlich und nur über die RPC schreibbar
select throws_ok(format($$ insert into legal_acceptances (user_id, document, version, source) values (%L, 'terms', 'x', 'web') $$, :'a_id'),
  '42501', null, 'Kein direktes Insert');
select throws_ok($$ update legal_acceptances set version = 'x' $$, '42501', null, 'Kein Update');
select throws_ok($$ delete from legal_acceptances $$, '42501', null, 'Kein Delete');

select throws_ok($$ select private.require_current_legal() $$, '42501', null, 'require_current_legal ist für Nutzer nicht direkt aufrufbar');

-- Fremde und anon
select tests.authenticate_as(:'b_id');
select is((select count(*)::int from legal_acceptances), 0, 'B liest die Nachweise von A nicht');
select ok(not (select accepted from legal_status()), 'Zustimmung von A gilt nicht für B');
select tests.as_anon();
select throws_ok($$ select * from legal_acceptances $$, '42501', null, 'anon liest keine Nachweise');
select throws_ok($$ select accept_legal('2026-10-draft', '2026-10-draft', 'web') $$, '42501', null, 'anon stimmt nicht zu');

-- Admin nur mit 2FA
-- Gegen die Gesamtzahl als postgres, nicht gegen eine feste Zahl: Konten aus E2E-Läufen bleiben ohne db reset liegen (QA M2 F6).
select tests.as_postgres();
select count(*)::int as all_acceptances from legal_acceptances \gset
select tests.authenticate_as(:'admin_id', 'aal2');
select is((select count(*)::int from legal_acceptances), :all_acceptances, 'Admin mit 2FA liest alle Nachweise');
select is((select count(*)::int from legal_acceptances where user_id = :'a_id'), 2, 'Admin mit 2FA sieht die Nachweise von A');
select tests.authenticate_as(:'admin_id', 'aal1');
select is((select count(*)::int from legal_acceptances), 0, 'Admin ohne 2FA liest keine fremden Nachweise');

-- Neue Version der Rechtstexte verlangt erneute Zustimmung
select tests.as_postgres();
update private.app_settings set value = '"2027-01"' where key = 'legal_terms_version';
select tests.authenticate_as(:'a_id');
select ok(not private.has_accepted_current_legal(), 'Neue AGB-Version: Gate wieder geschlossen');

-- Gesperrte Konten stimmen nicht zu
select tests.as_postgres();
update profiles set is_blocked = true where user_id = :'b_id';
select tests.authenticate_as(:'b_id');
select throws_ok($$ select accept_legal('2027-01', '2026-10-draft', 'web') $$, '42501', null, 'Gesperrtes Konto stimmt nicht zu');

select * from finish();
rollback;
