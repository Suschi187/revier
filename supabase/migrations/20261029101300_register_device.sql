-- Review M1 (Architekt 4): Ein APNs-Token gehört immer dem zuletzt angemeldeten Konto.
-- Meldet sich B auf dem Gerät von A an, wird das Token umgehängt, damit Pushes für A nicht bei B
-- landen. Beim Abmelden löscht die App ihr Token (delete auf devices ist erlaubt).

create function public.register_device(apns_token text, language public.language_code default 'de')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null or not private.is_active_user(uid) then
    raise exception 'Nur für angemeldete, aktive Konten' using errcode = '42501';
  end if;

  insert into public.devices (user_id, apns_token, platform, language)
  values (uid, register_device.apns_token, 'ios', register_device.language)
  on conflict on constraint devices_apns_token_key
  do update set user_id = excluded.user_id, language = excluded.language, created_at = now();
end;
$$;

revoke execute on function public.register_device(text, public.language_code) from public, anon;
grant execute on function public.register_device(text, public.language_code) to authenticated;

-- Registrieren nur noch über die Funktion.
revoke insert on public.devices from authenticated;
