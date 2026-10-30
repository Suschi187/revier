begin;
\ir _helpers.psql
select plan(27);

-- M4 Commit 4 (ADR 014, Review B2/A2/A9): Admins ernennen und entziehen.
create function tests.state_of(statement text) returns text language plpgsql as $$
begin
  execute statement;
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;
grant execute on function tests.state_of(text) to authenticated, anon;

select tests.create_user('alt@test.local') as old_id \gset
select tests.create_user('neu@test.local') as new_id \gset
select tests.create_user('kandidat@test.local') as cand_id \gset
select tests.create_user('zweiter@test.local') as cand2_id \gset
select tests.create_user('gesperrt@test.local') as blocked_id \gset
select tests.make_admin(:'old_id');
-- Der erste Admin ist länger als die Karenz im Amt (Runbook setzt created_at zurück).
update private.user_roles set created_at = now() - interval '30 days' where user_id = :'old_id';
update profiles set is_blocked = true where user_id = :'blocked_id';
select count(*)::int as audit_before from audit_log where action like 'role.%' \gset

-- Zugangsstatus (A2)
select tests.authenticate_as(:'cand_id');
select is((select (has_role, aal2) from admin_access()), (false, false), 'Nutzer: keine Rolle');
select tests.authenticate_as(:'old_id', 'aal1');
select is((select (has_role, aal2) from admin_access()), (true, false), 'Admin ohne 2FA: Rolle, kein aal2');
select tests.authenticate_as(:'old_id', 'aal2');
select is((select (has_role, aal2) from admin_access()), (true, true), 'Admin mit 2FA');

-- Kontosuche (A9)
select tests.authenticate_as(:'cand_id');
select is(tests.state_of($$ select * from admin_find_user('kandidat@test.local') $$), '42501', 'Nutzer sucht nicht');
select tests.authenticate_as(:'old_id', 'aal2');
select is((select user_id from admin_find_user('  KANDIDAT@test.local ')), :'cand_id'::uuid, 'Exakte E-Mail, Groß-/Kleinschreibung egal');
select is((select count(*)::int from admin_find_user('kandidat@test')), 0, 'Keine Teiltreffer');
select is((select count(*)::int from admin_find_user('%@test.local')), 0, 'Keine Wildcards');
select is((select count(*)::int from admin_find_user('alt@test.local')), 0, 'Das eigene Konto ist kein Treffer');
select is((select count(*)::int from admin_find_user('gesperrt@test.local')), 0, 'Gesperrte Konten sind kein Treffer');
select tests.as_postgres();
select is((select count(*)::int from audit_log where action = 'user.looked_up' and target_id = :'cand_id'), 1, 'Treffer im Audit-Log');
select ok((select not (details ? 'email') from audit_log where action = 'user.looked_up' and target_id = :'cand_id'), 'ohne E-Mail');

-- Step-up (B2)
select tests.authenticate_as(:'old_id', 'aal2');
select is(tests.state_of(format($$ select grant_admin(%L) $$, :'cand_id')), 'RV005', 'Ohne TOTP-Claim: Step-up nötig');
select tests.authenticate_totp(:'old_id', 11);
select is(tests.state_of(format($$ select grant_admin(%L) $$, :'cand_id')), 'RV005', 'TOTP älter als 10 Minuten: Step-up nötig');
select tests.authenticate_totp(:'old_id', 2);
select is(tests.state_of(format($$ select grant_admin(%L) $$, :'blocked_id')), 'P0002', 'Gesperrtes Konto wird kein Admin');
select is(tests.state_of(format($$ select grant_admin(%L) $$, :'cand_id')), 'ok', 'Ernennen mit frischem TOTP');
select tests.as_postgres();
select is((select details from audit_log where action = 'role.granted' and target_id = :'cand_id'),
  '{"role": "admin", "via": "ui"}'::jsonb, 'Audit der Ernennung (über die UI)');
select is((select actor_id from audit_log where action = 'role.granted' and target_id = :'cand_id'), :'old_id'::uuid, 'mit Akteur');

-- Karenz: der neue Admin moderiert sofort, ändert aber noch keine Rollen
select tests.authenticate_totp(:'cand_id', 0);
select ok(private.is_admin(), 'Neuer Admin ist sofort Admin (mit 2FA)');
select is(tests.state_of(format($$ select grant_admin(%L) $$, :'cand2_id')), '42501', 'Neuer Admin ernennt in der Karenz niemanden');

-- Letzter Admin und Limits
select tests.authenticate_totp(:'old_id', 0);
select is(tests.state_of(format($$ select revoke_admin(%L) $$, :'cand_id')), 'ok', 'Entziehen');
select is(tests.state_of(format($$ select revoke_admin(%L) $$, :'old_id')), '23514', 'Letzten Admin nicht entziehbar (auch nicht sich selbst)');
select is(tests.state_of(format($$ select revoke_admin(%L) $$, :'cand2_id')), 'P0002', 'Kein Admin: nichts zu entziehen');
select is(tests.state_of(format($$ select grant_admin(%L) $$, :'cand2_id')), 'ok', 'Dritte Rollenänderung');
select is(tests.state_of(format($$ select revoke_admin(%L) $$, :'cand2_id')), '54000', 'Vierte Änderung in 24 h: Limit');

-- Rollen per SQL werden protokolliert
select tests.as_postgres();
insert into private.user_roles (user_id, role) values (:'new_id', 'admin');
select is((select (actor_id, details ->> 'via')::text from audit_log where action = 'role.granted' and target_id = :'new_id'), '(,sql)',
  'SQL-Ernennung im Audit-Log, ohne Akteur');
select is((select count(*)::int from audit_log where action like 'role.%') - :audit_before, 4, 'Alle Rollenänderungen protokolliert');

-- Liste der Admins nur für Admins
select tests.authenticate_as(:'cand_id');
select is((select count(*)::int from admin_list_admins()), 0, 'Nutzer sieht keine Admin-Liste');

select * from finish();
rollback;
