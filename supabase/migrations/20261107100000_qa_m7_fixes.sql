-- QA M7 F4 (docs/QA-REPORT.md, „M7 – Abnahme“): Nach einem erfolgreichen Versand beginnen die drei Versuche für
-- spätere Mails neu. Die Function meldet Erfolge ausdrücklich zurück; ein Zurücksetzen beim Claim ginge nicht, weil
-- release den alten Zeitpunkt wiederherstellt und jeder Wiederholungsversuch sonst wieder bei 0 begänne.
create function public.confirm_chat_notifications(p_secret text, p_recipients uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  confirmed integer;
begin
  if not private.chat_notifications_secret_valid(p_secret) then
    raise exception 'Nicht erlaubt' using errcode = '42501';
  end if;
  update private.chat_notifications n
  set attempts = 0
  where n.channel = 'email' and n.recipient_id = any (p_recipients) and n.attempts > 0;
  get diagnostics confirmed = row_count;
  return confirmed;
end;
$$;
revoke execute on function public.confirm_chat_notifications(text, uuid[]) from public, anon, authenticated;
grant execute on function public.confirm_chat_notifications(text, uuid[]) to service_role;
