begin;
\ir _helpers.psql
select plan(6);

-- Snapshot der Tabellenrechte (Review M1): Änderungen müssen hier bewusst nachgezogen werden.
select set_eq(
  $$ select table_name::text || ':' || privilege_type::text from information_schema.role_table_grants
     where table_schema = 'public' and grantee = 'anon' $$,
  array['game_species:SELECT', 'listing_photos:SELECT', 'listing_species:SELECT', 'listings:SELECT',
        'public_profiles:SELECT', 'regions:SELECT'],
  'anon darf nur die öffentlichen Tabellen lesen'
);

select is(
  array(select distinct privilege_type::text from information_schema.role_table_grants
        where table_schema = 'public' and grantee in ('anon', 'authenticated', 'service_role')
          and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')),
  array[]::text[],
  'Kein TRUNCATE/REFERENCES/TRIGGER für API-Rollen (TRUNCATE umgeht RLS)'
);

select is(
  array(select c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'v')
          and not (has_table_privilege('service_role', c.oid, 'select')
                   and (c.relkind = 'v' or (has_table_privilege('service_role', c.oid, 'insert')
                        and has_table_privilege('service_role', c.oid, 'update')
                        and has_table_privilege('service_role', c.oid, 'delete'))))
        order by 1),
  array[]::text[],
  'service_role hat CRUD auf allen Tabellen (Server-Pfade)'
);

-- Server-Kontext so, wie Edge Functions ihn haben (Rolle service_role, nicht postgres).
select tests.create_user('a@test.local') as a_id \gset
select id as district from regions where code = 'DE-09184' \gset
select tests.as_postgres();
insert into listings (owner_id, kind, direction, title, content_language, region_id)
values (:'a_id', 'lease', 'offer', 'Server-Test', 'de', :'district') returning id as listing \gset

select set_config('role', 'service_role', true);
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
update listings set status = 'expired' where id = :'listing';
select is((select status::text from listings where id = :'listing'), 'expired', 'service_role setzt Status (z. B. Ablauf-Job)');
select lives_ok(format($$ update profiles set is_blocked = true where user_id = %L $$, :'a_id'), 'service_role sperrt Konten');
select lives_ok($$ select count(*) from audit_log $$, 'service_role liest das Audit-Log');

select * from finish();
rollback;
