begin;
\ir _helpers.psql
select plan(5);

-- Jede Tabelle in public hat RLS (CLAUDE.md: keine Tabelle ohne Policy).
select is(
  array(select c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity order by 1),
  array[]::text[],
  'Alle Tabellen in public haben RLS aktiv'
);

select is(
  array(select c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p')
          and not exists (select 1 from pg_policy p where p.polrelid = c.oid) order by 1),
  array[]::text[],
  'Alle Tabellen in public haben mindestens eine Policy'
);

-- Tabellen in private sind für API-Rollen nicht erreichbar.
select is(
  array(select distinct table_name::text from information_schema.role_table_grants
        where table_schema = 'private' and grantee in ('anon', 'authenticated') order by 1),
  array[]::text[],
  'Keine Tabellenrechte für anon/authenticated im Schema private'
);

-- Keine Funktion in public ist für anon/authenticated ausführbar, ohne dass sie bewusst freigegeben wurde.
select is(
  array(select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
        order by 1),
  array['accept_legal', 'legal_status', 'register_device']::text[],
  'Nur bewusst freigegebene RPCs in public sind ausführbar (Allowlist)'
);

-- Auch in private nur bewusst ausführbare Hilfsfunktionen (Policies brauchen sie). Ableitungen wie die
-- Standortverfremdung dürfen nie darunter sein (Review Plan M3, B2).
select is(
  array(select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'private'
          and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
        order by 1),
  array['can_report', 'can_write_in', 'has_accepted_current_legal', 'has_admin_role', 'is_active_user', 'is_admin',
        'is_blocked_with', 'is_conversation_participant', 'is_server', 'is_server_caller', 'owns_editable_listing',
        'setting_int']::text[],
  'Nur bewusst freigegebene Hilfsfunktionen in private sind ausführbar (Allowlist)'
);

select * from finish();
rollback;
