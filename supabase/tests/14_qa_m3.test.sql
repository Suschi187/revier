begin;
\ir _helpers.psql
select plan(5);

-- QA M3 Zwischenstand (docs/QA-REPORT.md): offene Funde als TODO-Tests mit dem Soll-Verhalten.
-- TODO-Tests schlagen den Lauf nicht fehl; nach der Behebung meldet pg_prove sie als „unexpectedly
-- succeeded“, dann todo_start/todo_end entfernen.

select tests.create_user('owner-admin@test.local') as adm \gset
select tests.make_admin(:'adm');
select id as district from regions where code = 'DE-14612' \gset

select tests.authenticate_as(:'adm', 'aal2');
insert into listings (kind, direction, title, content_language, region_id)
values ('helper', 'offer', 'Eigene Anzeige eines Admins', 'de', :'district') returning id as l \gset
-- Ausgangszustand als postgres herstellen (Freigabe durch einen anderen Admin)
select tests.as_postgres();
update listings set status = 'active', expires_at = now() + interval '30 days' where id = :'l';

-- Positivkontrolle: Ohne 2FA (kein Admin) führt eine Änderung zurück in die Prüfung.
select tests.authenticate_as(:'adm', 'aal1');
insert into listing_photos (listing_id, sort_order) values (:'l', 0);
select is((select status::text from listings where id = :'l'), 'pending_review',
  'Admin ohne 2FA: neues Foto an eigener aktiver Anzeige → pending_review');

select tests.as_postgres();
update listings set status = 'active' where id = :'l';
select tests.authenticate_as(:'adm', 'aal2');

select todo_start('QA M3 F1: Admin-Besitzer umgeht die Prüfung (Vier-Augen-Prinzip)');
insert into listing_photos (listing_id, sort_order) values (:'l', 1);
select is((select status::text from listings where id = :'l'), 'pending_review',
  'Admin mit 2FA: neues Foto an eigener aktiver Anzeige → pending_review');
select tests.as_postgres();
update listings set status = 'active' where id = :'l';
select tests.authenticate_as(:'adm', 'aal2');
update listing_photos set alt_text = 'Neuer Alt-Text' where listing_id = :'l' and sort_order = 1;
select is((select status::text from listings where id = :'l'), 'pending_review',
  'Admin mit 2FA: Alt-Text an eigener aktiver Anzeige → pending_review');
update listings set title = 'Eigene Anzeige, ungeprüft umgeschrieben' where id = :'l';
select is((select status::text from listings where id = :'l'), 'pending_review',
  'Admin mit 2FA: Titel der eigenen aktiven Anzeige → pending_review');
select todo_end();

select tests.as_postgres();
select todo_start('QA M3 F4: service_role liest das Standort-Secret (ADR 006: „nur über die Trigger-Funktion“)');
select ok(not has_table_privilege('service_role', 'vault.decrypted_secrets', 'select'),
  'service_role hat kein SELECT auf vault.decrypted_secrets');
select todo_end();

select * from finish();
rollback;
