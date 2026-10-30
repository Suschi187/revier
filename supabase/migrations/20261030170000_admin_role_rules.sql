-- QA M4 F6: Die Oberfläche nennt die Regeln für Rollenänderungen aus private.app_settings statt fester Zahlen.
-- security invoker: setting_int ist für authenticated freigegeben; Werte nur für Admins mit 2FA.

create function public.admin_role_rules()
returns table (waiting_days integer, limit_per_admin integer, limit_total integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select private.setting_int('role_change_waiting_days'),
         private.setting_int('role_change_limit_per_admin'),
         private.setting_int('role_change_limit_total')
  where private.is_admin();
$$;
revoke execute on function public.admin_role_rules() from public, anon;
grant execute on function public.admin_role_rules() to authenticated;
