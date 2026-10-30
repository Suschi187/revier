-- QA M4 F3: Ernennen nur nach einer Kontosuche per E-Mail (ADR 014, Review A9). Ohne diese Regel ließ sich
-- jede Nutzer-ID ernennen (z. B. aus dem Audit-Log), an Such-Limit und Such-Eintrag vorbei.
-- Gefordert ist ein `user.looked_up`-Eintrag desselben Admins für dasselbe Konto aus der letzten Stunde.

create or replace function public.grant_admin(p_user_id uuid)
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
  if not exists (select 1 from public.audit_log a
                 where a.action = 'user.looked_up' and a.target_type = 'profile' and a.target_id = p_user_id
                   and a.actor_id = (select auth.uid()) and a.created_at > now() - interval '1 hour') then
    raise exception 'Konto zuerst per E-Mail suchen' using errcode = '42501', hint = '{"reason":"lookup_required"}';
  end if;
  perform set_config('revier.role_change', 'on', true);
  insert into private.user_roles (user_id, role) values (p_user_id, 'admin');
  perform set_config('revier.role_change', '', true);
end;
$$;
revoke execute on function public.grant_admin(uuid) from public, anon;
grant execute on function public.grant_admin(uuid) to authenticated;
