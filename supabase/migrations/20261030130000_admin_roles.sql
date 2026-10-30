-- M4 Commit 4 (ADR 014, Review B2/A2/A9): Admins per UI ernennen und entziehen, mit Step-up (frischer TOTP-
-- Code), Limits, Karenz, Schutz des letzten Admins und Audit per Trigger. Zugangsstatus für Proxy und Gate.

insert into private.app_settings (key, value, description) values
  ('role_change_limit_per_admin', '3', 'Rollenänderungen je Admin in 24 h (ADR 014)'),
  ('role_change_limit_total', '10', 'Rollenänderungen insgesamt in 24 h (ADR 014)'),
  ('role_change_waiting_days', '7', 'Tage nach der eigenen Ernennung, bevor ein Admin Rollen ändern darf (ADR 014)'),
  ('role_step_up_minutes', '10', 'Höchstalter der TOTP-Bestätigung für Rollenänderungen (ADR 014)'),
  ('admin_lookup_limit_per_hour', '30', 'Kontosuchen per E-Mail je Admin und Stunde (ADR 014)');

-- Kontosuchen zählen (Rate-Limit), auch ohne Treffer. Nur für den Server, nie über die API.
create table private.admin_lookups (
  id bigint generated always as identity primary key,
  actor_id uuid not null,
  created_at timestamptz not null default now()
);
create index admin_lookups_actor_idx on private.admin_lookups (actor_id, created_at);
alter table private.admin_lookups enable row level security;

-- ---------------------------------------------------------------------------
-- Audit per Trigger: auch Änderungen per SQL (Runbook, Dashboard) landen im Log.
-- ---------------------------------------------------------------------------
create function private.user_roles_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_data private.user_roles := coalesce(new, old);
begin
  perform private.write_audit(
    case when tg_op = 'INSERT' then 'role.granted' else 'role.revoked' end,
    'profile', row_data.user_id,
    jsonb_build_object('role', row_data.role,
                       'via', case when coalesce(current_setting('revier.role_change', true), '') = 'on' then 'ui' else 'sql' end));
  return null;
end;
$$;
revoke execute on function private.user_roles_audit() from public, anon, authenticated;

create trigger user_roles_audit
  after insert or delete on private.user_roles
  for each row execute function private.user_roles_audit();

-- ---------------------------------------------------------------------------
-- Prüfungen für Rollenänderungen
-- ---------------------------------------------------------------------------
-- TOTP-Bestätigung der letzten Minuten laut JWT-Claim amr (Supabase: [{method, timestamp}]).
create function private.has_fresh_totp()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((
    select bool_or((e ->> 'method') = 'totp'
                   and to_timestamp((e ->> 'timestamp')::double precision)
                       >= now() - make_interval(mins => private.setting_int('role_step_up_minutes')))
    from jsonb_array_elements(case when jsonb_typeof(auth.jwt() -> 'amr') = 'array' then auth.jwt() -> 'amr' else '[]'::jsonb end) e
  ), false);
$$;
revoke execute on function private.has_fresh_totp() from public, anon, service_role;

create function private.check_role_change()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  since timestamptz;
begin
  if not private.is_admin() then
    raise exception 'Nur für Admins mit Zwei-Faktor' using errcode = '42501';
  end if;
  if not private.has_fresh_totp() then
    raise exception 'step_up_required' using errcode = 'RV005';
  end if;
  select r.created_at into since from private.user_roles r where r.user_id = actor and r.role = 'admin';
  if since > now() - make_interval(days => private.setting_int('role_change_waiting_days')) then
    raise exception 'waiting_period' using errcode = '42501',
      hint = jsonb_build_object('reason', 'waiting_period',
                                'until', since + make_interval(days => private.setting_int('role_change_waiting_days')))::text;
  end if;
  -- Eine Sperre für alle Rollenänderungen: Zählen und „letzter Admin“ sehen einen festen Stand.
  perform pg_advisory_xact_lock(hashtext('private.user_roles'));
  if (select count(*) from public.audit_log a
      where a.action like 'role.%' and a.actor_id = actor and a.created_at > now() - interval '24 hours')
     >= private.setting_int('role_change_limit_per_admin')
     or (select count(*) from public.audit_log a
         where a.action like 'role.%' and a.created_at > now() - interval '24 hours')
     >= private.setting_int('role_change_limit_total') then
    raise exception 'Zu viele Rollenänderungen' using errcode = '54000';
  end if;
end;
$$;
revoke execute on function private.check_role_change() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------
create function public.grant_admin(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.check_role_change();
  if not exists (select 1 from auth.users u where u.id = p_user_id and u.email_confirmed_at is not null)
     or not private.is_active_user(p_user_id) then
    raise exception 'Konto nicht gefunden' using errcode = 'P0002';
  end if;
  if exists (select 1 from private.user_roles r where r.user_id = p_user_id and r.role = 'admin') then
    return;
  end if;
  perform set_config('revier.role_change', 'on', true);
  insert into private.user_roles (user_id, role) values (p_user_id, 'admin');
  perform set_config('revier.role_change', '', true);
end;
$$;
revoke execute on function public.grant_admin(uuid) from public, anon;
grant execute on function public.grant_admin(uuid) to authenticated;

create function public.revoke_admin(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.check_role_change();
  if not exists (select 1 from private.user_roles r where r.user_id = p_user_id and r.role = 'admin') then
    raise exception 'Kein Admin' using errcode = 'P0002';
  end if;
  -- Nach dem Entzug muss ein aktiver Admin bleiben (gezählt unter der Sperre aus check_role_change).
  if not exists (select 1 from private.user_roles r
                 where r.role = 'admin' and r.user_id <> p_user_id and private.is_active_user(r.user_id)) then
    raise exception 'last_admin' using errcode = '23514', hint = '{"reason":"last_admin"}';
  end if;
  perform set_config('revier.role_change', 'on', true);
  delete from private.user_roles where user_id = p_user_id and role = 'admin';
  perform set_config('revier.role_change', '', true);
end;
$$;
revoke execute on function public.revoke_admin(uuid) from public, anon;
grant execute on function public.revoke_admin(uuid) to authenticated;

-- Konto per exakter E-Mail (A9): nur aktive, bestätigte Konten, nie das eigene, nie die E-Mail im Ergebnis.
create function public.admin_find_user(p_email text)
returns table (user_id uuid, display_name text, member_since timestamptz, is_admin boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  found_id uuid;
begin
  if not private.is_admin() then
    raise exception 'Nur für Admins mit Zwei-Faktor' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('admin_lookups:' || actor::text));
  if (select count(*) from private.admin_lookups l where l.actor_id = actor and l.created_at > now() - interval '1 hour')
     >= private.setting_int('admin_lookup_limit_per_hour') then
    raise exception 'Zu viele Suchen' using errcode = '54000';
  end if;
  insert into private.admin_lookups (actor_id) values (actor);

  select u.id into found_id from auth.users u
  where lower(u.email) = lower(btrim(coalesce(p_email, ''))) and u.email_confirmed_at is not null
    and u.id <> actor and private.is_active_user(u.id);
  if found_id is null then
    return;
  end if;
  perform private.write_audit('user.looked_up', 'profile', found_id);
  return query
    select p.user_id, p.display_name, p.created_at,
           exists (select 1 from private.user_roles r where r.user_id = p.user_id and r.role = 'admin')
    from public.profiles p where p.user_id = found_id;
end;
$$;
revoke execute on function public.admin_find_user(text) from public, anon;
grant execute on function public.admin_find_user(text) to authenticated;

-- Liste der Admins für die Verwaltungsseite (nur Admins).
create function public.admin_list_admins()
returns table (user_id uuid, display_name text, admin_since timestamptz, active boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select r.user_id, p.display_name, r.created_at, private.is_active_user(r.user_id)
  from private.user_roles r left join public.profiles p on p.user_id = r.user_id
  where r.role = 'admin' and private.is_admin()
  order by r.created_at, r.user_id;
$$;
revoke execute on function public.admin_list_admins() from public, anon;
grant execute on function public.admin_list_admins() to authenticated;

-- Zugangsstatus für Proxy und Gate (A2): Rolle (ohne 2FA, nur zum Leiten) und ob die Session aal2 hat.
create function public.admin_access()
returns table (has_role boolean, aal2 boolean)
language sql
stable
security invoker
set search_path = ''
as $$
  select private.has_admin_role() and private.is_active_user((select auth.uid())),
         coalesce((select auth.jwt() ->> 'aal') = 'aal2', false);
$$;
revoke execute on function public.admin_access() from public, anon;
grant execute on function public.admin_access() to authenticated;
