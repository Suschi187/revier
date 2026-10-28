begin;
\ir _helpers.psql
select plan(19);

select tests.create_user('a@test.local', 'Anna') as a_id \gset
select tests.create_user('b@test.local', 'Bernd') as b_id \gset
select tests.create_user('admin@test.local') as admin_id \gset
select tests.make_admin(:'admin_id');

-- Anlegen per Trigger, Metadaten werden validiert
select is((select display_name from profiles where user_id = :'a_id'), 'Anna', 'Profil wird beim Registrieren angelegt');

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'evil@test.local',
  '{"display_name": "Eve", "country": "pl", "preferred_language": "xx", "verification_status": "verified", "is_blocked": false, "role": "admin"}');
select results_eq(
  $$ select country::text, preferred_language::text, verification_status::text from profiles where user_id = '11111111-1111-1111-1111-111111111111' $$,
  $$ values ('PL', 'de', 'none') $$,
  'Metadaten: gültiges Land übernommen, ungültige Sprache ersetzt, Status nie übernommen'
);
select is((select count(*)::int from private.user_roles where user_id = '11111111-1111-1111-1111-111111111111'), 0, 'Metadaten machen niemanden zum Admin');

-- Lesen
select tests.authenticate_as(:'a_id');
select is((select count(*)::int from profiles), 1, 'A sieht nur das eigene Profil');
select is((select count(*)::int from profiles where user_id = :'b_id'), 0, 'A liest das Profil von B nicht');

select tests.as_anon();
select throws_ok($$ select * from profiles $$, '42501', null, 'anon liest profiles nicht direkt');
select is((select count(*)::int from public_profiles), 4, 'anon liest public_profiles');

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
select tests.authenticate_as(:'admin_id', 'aal2');
select is((select count(*)::int from profiles), 4, 'Admin mit 2FA liest alle Profile');
select tests.authenticate_as(:'admin_id', 'aal1');
select is((select count(*)::int from profiles), 1, 'Admin ohne 2FA liest nur das eigene Profil');

-- Gesperrte und gelöschte Konten verschwinden aus der öffentlichen Sicht
select tests.as_postgres();
update profiles set is_blocked = true where user_id = :'b_id';
update profiles set deleted_at = now() where user_id = '11111111-1111-1111-1111-111111111111';
select tests.as_anon();
select set_eq($$ select display_name from public_profiles $$, array['Anna M.', 'admin'], 'Gesperrte und gelöschte Konten sind nicht öffentlich');

select * from finish();
rollback;
