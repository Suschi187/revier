begin;
\ir _helpers.psql
select plan(3);

-- QA M2 F1 (ADR 010): Kein Passwort-Hash bleibt gespeichert, egal wie er geschrieben wird.
select tests.create_user('a@test.local') as a_id \gset

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'pw@test.local', extensions.crypt('Angreifer-Passwort-1', extensions.gen_salt('bf')), now(), now());
select is((select encrypted_password from auth.users where email = 'pw@test.local'), '', 'Registrierung mit Passwort speichert keinen Hash');

update auth.users set encrypted_password = extensions.crypt('Neues-Passwort-1', extensions.gen_salt('bf')) where id = :'a_id';
select is((select encrypted_password from auth.users where id = :'a_id'), '', 'Passwort setzen speichert keinen Hash');

update auth.users set email_confirmed_at = now() where id = :'a_id';
select is((select encrypted_password from auth.users where id = :'a_id'), '', 'Andere Updates lassen den Hash leer');

select * from finish();
rollback;
