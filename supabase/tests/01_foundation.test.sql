begin;
\ir _helpers.psql
select plan(12);

select tests.create_user('admin@test.local') as admin_id \gset
select tests.create_user('user@test.local') as user_id \gset
select tests.make_admin(:'admin_id');

-- is_admin verlangt Rolle UND 2FA
select tests.authenticate_as(:'admin_id', 'aal2');
select ok(private.is_admin(), 'Admin mit 2FA ist Admin');

select tests.authenticate_as(:'admin_id', 'aal1');
select ok(not private.is_admin(), 'Admin ohne 2FA ist kein Admin');
select ok(private.has_admin_role(), 'has_admin_role zeigt die Rolle auch ohne 2FA (nur UI)');

select tests.authenticate_as(:'user_id', 'aal2');
select ok(not private.is_admin(), 'Nutzer mit 2FA ist kein Admin');

select tests.as_anon();
select ok(not private.is_admin(), 'anon ist kein Admin');

-- private-Tabellen sind für API-Rollen nicht lesbar oder schreibbar
select tests.authenticate_as(:'user_id', 'aal2');
select throws_ok(
  $$ select * from private.user_roles $$,
  '42501', null, 'authenticated liest user_roles nicht'
);
select throws_ok(
  format($$ insert into private.user_roles (user_id, role) values (%L, 'admin') $$, :'user_id'),
  '42501', null, 'authenticated kann sich nicht selbst zum Admin machen'
);
select throws_ok(
  $$ select * from private.app_settings $$,
  '42501', null, 'authenticated liest app_settings nicht'
);
select throws_ok(
  $$ select private.custom_access_token_hook('{}'::jsonb) $$,
  '42501', null, 'authenticated kann den Hook nicht aufrufen'
);

-- Hook setzt bzw. entfernt app_role
select tests.as_postgres();
select is(
  private.custom_access_token_hook(jsonb_build_object('user_id', :'admin_id', 'claims', '{"role": "authenticated"}'::jsonb)) #>> '{claims,app_role}',
  'admin', 'Hook setzt app_role für Admins'
);
select is(
  private.custom_access_token_hook(jsonb_build_object('user_id', :'user_id', 'claims', '{"app_role": "admin"}'::jsonb)) #>> '{claims,app_role}',
  null, 'Hook entfernt einen untergeschobenen app_role-Claim'
);

-- Entzug wirkt sofort
delete from private.user_roles where user_id = :'admin_id';
select tests.authenticate_as(:'admin_id', 'aal2');
select ok(not private.is_admin(), 'Nach Entzug der Rolle sofort kein Admin mehr');

select * from finish();
rollback;
