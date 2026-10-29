begin;
\ir _helpers.psql
select plan(32);

select tests.create_user('a@test.local', 'Anna') as a_id \gset
select tests.create_user('b@test.local', 'Bernd') as b_id \gset
select tests.create_user('admin@test.local') as admin_id \gset
select tests.make_admin(:'admin_id');

-- Anlegen per Trigger, Metadaten werden validiert
select ok(exists (select 1 from profiles where user_id = :'a_id'), 'Profil wird beim Registrieren angelegt');

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'evil@test.local',
  '{"display_name": "Eve", "country": "pl", "preferred_language": "xx", "verification_status": "verified", "is_blocked": false, "role": "admin"}');
select results_eq(
  $$ select country::text, preferred_language::text, verification_status::text from profiles where user_id = '11111111-1111-1111-1111-111111111111' $$,
  $$ values ('PL', 'de', 'none') $$,
  'Metadaten: gültiges Land übernommen, ungültige Sprache ersetzt, Status nie übernommen'
);
select is((select display_name from profiles where user_id = '11111111-1111-1111-1111-111111111111'), 'Nutzer',
  'Anzeigename aus Metadaten wird nie übernommen (fremd registrierte Adressen)');
select is((select count(*)::int from private.user_roles where user_id = '11111111-1111-1111-1111-111111111111'), 0, 'Metadaten machen niemanden zum Admin');

-- Lesen
select tests.authenticate_as(:'a_id');
select is((select count(*)::int from profiles), 1, 'A sieht nur das eigene Profil');
select is((select count(*)::int from profiles where user_id = :'b_id'), 0, 'A liest das Profil von B nicht');

select tests.as_anon();
select throws_ok($$ select * from profiles $$, '42501', null, 'anon liest profiles nicht direkt');
select is((select count(*)::int from public_profiles), 0, 'Konten ohne öffentliche Anzeige sind nicht öffentlich');

select tests.as_postgres();
select columns_are('public', 'public_profiles',
  array['user_id', 'display_name', 'account_type', 'business_name', 'verification_status', 'country'],
  'public_profiles gibt nur die freigegebenen Spalten aus');

-- Ändern
select tests.authenticate_as(:'a_id');
update profiles set display_name = 'Anna M.' where user_id = :'a_id';
select is((select display_name from profiles where user_id = :'a_id'), 'Anna M.', 'A ändert den eigenen Anzeigenamen');

update profiles set display_name = 'gehackt' where user_id = :'b_id';
select tests.as_postgres();
select is((select display_name from profiles where user_id = :'b_id'), 'Bernd', 'A ändert das Profil von B nicht');

select tests.authenticate_as(:'a_id');
select throws_ok($$ update profiles set verification_status = 'verified' $$, '42501', null, 'A setzt verification_status nicht selbst');
select throws_ok($$ update profiles set is_blocked = false $$, '42501', null, 'A ändert is_blocked nicht');
select throws_ok($$ update profiles set deleted_at = null $$, '42501', null, 'A ändert deleted_at nicht');
select throws_ok($$ update profiles set user_id = gen_random_uuid() $$, '42501', null, 'A ändert user_id nicht');
select throws_ok(format($$ insert into profiles (user_id, display_name) values (%L, 'x') $$, :'b_id'), '42501', null, 'A legt keine Profile an');
select throws_ok($$ delete from profiles $$, '42501', null, 'A löscht keine Profile direkt');

-- Admin
-- Gegen die Gesamtzahl als postgres, nicht gegen eine feste Zahl: Konten aus E2E-Läufen bleiben ohne db reset liegen (QA M2 F6).
select tests.as_postgres();
select count(*)::int as all_profiles from profiles \gset
select tests.authenticate_as(:'admin_id', 'aal2');
select is((select count(*)::int from profiles), :all_profiles, 'Admin mit 2FA liest alle Profile');
select tests.authenticate_as(:'admin_id', 'aal1');
select is((select count(*)::int from profiles), 1, 'Admin ohne 2FA liest nur das eigene Profil');

-- Öffentlich sind nur Anbieter und die eigenen Chatpartner (Review M1)
select tests.as_postgres();
select id as district from regions where code = 'DE-09184' \gset
insert into listings (owner_id, kind, direction, title, content_language, region_id, status, expires_at)
values (:'b_id', 'lease', 'offer', 'Pacht von Bernd', 'de', :'district', 'active', now() + interval '30 days') returning id as listing_b \gset
insert into listings (owner_id, kind, direction, title, content_language, region_id)
values ('11111111-1111-1111-1111-111111111111', 'lease', 'offer', 'Nur Entwurf', 'de', :'district');
update profiles set verification_status = 'rejected' where user_id = :'b_id';

select tests.as_anon();
select set_eq($$ select display_name from public_profiles $$, array['Bernd'], 'Nur Anbieter mit öffentlicher Anzeige sind öffentlich');
select is((select verification_status::text from public_profiles where display_name = 'Bernd'), 'none',
  'Abgelehnte Verifizierung ist öffentlich nicht sichtbar');

select tests.as_postgres();
update profiles set verification_status = 'verified' where user_id = :'b_id';
select tests.as_anon();
select is((select verification_status::text from public_profiles where display_name = 'Bernd'), 'verified', 'Verifiziert ist öffentlich sichtbar');

select tests.authenticate_as(:'a_id');
insert into conversations (listing_id) values (:'listing_b');
select tests.authenticate_as(:'b_id');
select set_eq($$ select display_name from public_profiles $$, array['Bernd', 'Anna M.'], 'Anbieter sieht den Namen seines Chatpartners');
select tests.authenticate_as(:'admin_id');
select set_eq($$ select display_name from public_profiles $$, array['Bernd'], 'Unbeteiligte sehen den Chatpartner nicht');

-- Gesperrte und gelöschte Konten verschwinden aus der öffentlichen Sicht
select tests.as_postgres();
update profiles set is_blocked = true where user_id = :'b_id';
select tests.as_anon();
select is((select count(*)::int from public_profiles), 0, 'Gesperrte Anbieter sind nicht öffentlich');
select tests.authenticate_as(:'b_id');
update profiles set display_name = 'Neu' where user_id = :'b_id';
select is((select display_name from profiles where user_id = :'b_id'), 'Bernd', 'Gesperrte ändern das eigene Profil nicht (QA M2 F4)');
select is((select is_blocked from profiles where user_id = :'b_id'), true, 'Gesperrte lesen das eigene Profil weiter');

-- Ohne Anzeigenamen kein E-Mail-Bestandteil als Name
select tests.as_postgres();
insert into auth.users (id, instance_id, aud, role, email)
values ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'max.mustermann@test.local');
select is((select display_name from profiles where user_id = '22222222-2222-2222-2222-222222222222'), 'Nutzer',
  'Fallback-Name verrät nichts aus der E-Mail-Adresse');

-- Onboarding/Profilformular (M2): Kontotyp und Firmenname
select tests.authenticate_as(:'a_id');
select throws_ok($$ update profiles set business_name = 'Forst GmbH' $$, '23514', null, 'Firmenname nur bei gewerblichem Konto');
update profiles set account_type = 'business', business_name = 'Forst GmbH', country = 'AT', preferred_language = 'en';
select results_eq($$ select account_type::text, business_name, country::text, preferred_language::text from profiles $$,
  $$ values ('business', 'Forst GmbH', 'AT', 'en') $$, 'A wird gewerblich mit Firmenname, Land und Sprache');
select throws_ok($$ update profiles set account_type = 'private' $$, '23514', null, 'Wechsel auf privat ohne Leeren des Firmennamens schlägt fehl');
update profiles set account_type = 'private', business_name = null;
select is((select account_type::text from profiles), 'private', 'Wechsel auf privat mit Leeren des Firmennamens');

select * from finish();
rollback;
