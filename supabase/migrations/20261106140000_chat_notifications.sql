-- M7 Commit 8 (ADR 017, Plan M7 Review B2, A6, A7, H5): E-Mail-Benachrichtigung bei neuen Nachrichten.
-- Fällig nur zu Nachrichten seit der letzten Mail, je Empfänger höchstens eine Mail je Intervall, at-most-once mit
-- Claim vor dem Versand und Rücksetzen bei erkanntem Fehler (höchstens 3 Versuche). Auslöser: pg_cron jede Minute
-- per pg_net an die Edge Function send-chat-notifications; ohne URL im Vault macht der Job nichts.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

insert into private.app_settings (key, value, description) values
  ('chat_email_delay_minutes', '2', 'Minuten, die eine Nachricht ungelesen sein muss, bevor eine Mail fällig ist (ADR 017)'),
  ('chat_email_min_interval_minutes', '15', 'Mindestabstand zwischen zwei Chat-Mails an denselben Empfänger (ADR 017)'),
  ('chat_email_batch', '50', 'Höchstzahl Empfänger je Lauf der Benachrichtigung (ADR 017)');

-- ---------------------------------------------------------------------------
-- Abmeldung im Profil
-- ---------------------------------------------------------------------------
alter table public.profiles add column notify_chat_email boolean not null default true;
grant update (notify_chat_email) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Stand je Unterhaltung, Empfänger und Kanal (channel push für I5)
-- ---------------------------------------------------------------------------
create table private.chat_notifications (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  recipient_id uuid not null references public.profiles (user_id) on delete cascade,
  channel text not null check (channel in ('email', 'push')),
  last_sent_at timestamptz,
  previous_sent_at timestamptz,
  attempts integer not null default 0,
  primary key (conversation_id, recipient_id, channel)
);
create index chat_notifications_recipient_idx on private.chat_notifications (recipient_id, channel, last_sent_at);
alter table private.chat_notifications enable row level security;
revoke all on private.chat_notifications from public, anon, authenticated;

-- Geheimnis für den Aufruf der Function (A6). Zufällig erzeugt, nie im Repo; die Function prüft es über die RPC.
do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'chat_notifications_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'chat_notifications_secret',
      'Aufruf der Edge Function send-chat-notifications durch pg_cron (ADR 017).');
  end if;
end;
$$;

create function private.chat_notifications_secret_valid(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- Vergleich über Hashes gleicher Länge: keine Zeitunterschiede je übereinstimmendem Präfix.
  select p_secret is not null and exists (
    select 1 from vault.decrypted_secrets s
    where s.name = 'chat_notifications_secret'
      and extensions.digest(s.decrypted_secret, 'sha256') = extensions.digest(p_secret, 'sha256')
  );
$$;
revoke execute on function private.chat_notifications_secret_valid(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Claim: fällige Empfänger sperren, last_sent_at setzen, Inhalt für die Mail liefern (nur service_role)
-- ---------------------------------------------------------------------------
create function public.claim_chat_notifications(p_secret text, p_limit integer default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  delay interval := make_interval(mins => private.setting_int('chat_email_delay_minutes'));
  gap interval := make_interval(mins => private.setting_int('chat_email_min_interval_minutes'));
  lim integer := least(coalesce(p_limit, private.setting_int('chat_email_batch')), private.setting_int('chat_email_batch'));
  result jsonb;
begin
  if not private.chat_notifications_secret_valid(p_secret) then
    raise exception 'Nicht erlaubt' using errcode = '42501';
  end if;

  -- Fällige Paare: ungelesene Nachricht, älter als delay, neuer als die letzte Mail zu dieser Unterhaltung; beide Konten
  -- aktiv, keine Sperre, Empfänger nicht abgemeldet. Empfänger mit einer Mail im Intervall fallen ganz weg.
  insert into private.chat_notifications (conversation_id, recipient_id, channel)
  select distinct m.conversation_id, m.recipient_id, 'email'
  from public.messages m
  where m.read_at is null and m.created_at < now() - delay
  on conflict do nothing;

  with due as (
    select n.conversation_id, n.recipient_id
    from private.chat_notifications n
    join public.profiles r on r.user_id = n.recipient_id
    where n.channel = 'email'
      and r.notify_chat_email and private.is_active_user(n.recipient_id)
      and exists (
        select 1 from public.messages m
        where m.conversation_id = n.conversation_id and m.recipient_id = n.recipient_id and m.read_at is null
          and m.created_at < now() - delay and m.created_at > coalesce(n.last_sent_at, '-infinity')
          and private.is_active_user(m.sender_id) and not private.is_blocked_pair(m.sender_id, m.recipient_id))
      and not exists (
        select 1 from private.chat_notifications o
        where o.recipient_id = n.recipient_id and o.channel = 'email' and o.last_sent_at > now() - gap)
  ),
  recipients as (
    select distinct recipient_id from due order by recipient_id limit lim
  ),
  locked as (
    select n.conversation_id, n.recipient_id
    from private.chat_notifications n
    where n.channel = 'email' and (n.conversation_id, n.recipient_id) in (select d.conversation_id, d.recipient_id from due d
                                                                         where d.recipient_id in (select recipient_id from recipients))
    for update skip locked
  ),
  claimed as (
    update private.chat_notifications n
    set previous_sent_at = n.last_sent_at, last_sent_at = now()
    from locked l
    where n.channel = 'email' and n.conversation_id = l.conversation_id and n.recipient_id = l.recipient_id
    returning n.conversation_id, n.recipient_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'recipient_id', r.recipient_id,
      'email', u.email,
      'language', p.preferred_language,
      'conversations', (
        select jsonb_agg(jsonb_build_object(
          'conversation_id', c.id,
          'sender_name', case when sp.deleted_at is null and not sp.is_blocked then
                           case when sp.account_type = 'business' and sp.business_name is not null then sp.business_name else sp.display_name end end,
          -- Titel nur, wenn öffentlich oder der Empfänger Besitzer ist.
          'listing_title', case when l.id is not null and (l.owner_id = r.recipient_id or private.listing_is_public(l.status, l.expires_at, l.owner_id))
                                then l.title end
        ) order by c.last_message_at desc)
        from claimed cl
        join public.conversations c on c.id = cl.conversation_id
        left join public.listings l on l.id = c.listing_id
        left join public.profiles sp on sp.user_id = case when c.owner_id = r.recipient_id then c.interested_id else c.owner_id end
        where cl.recipient_id = r.recipient_id)
    )), '[]')
  into result
  from (select distinct recipient_id from claimed) r
  join auth.users u on u.id = r.recipient_id
  join public.profiles p on p.user_id = r.recipient_id;

  return result;
end;
$$;

-- Nach einem erkannten Versandfehler: alten Stand zurück, höchstens 3 Versuche; danach ist die Mail verloren
-- (at-most-once) und der Zähler beginnt für spätere Nachrichten neu.
create function public.release_chat_notifications(p_secret text, p_recipients uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  released integer;
begin
  if not private.chat_notifications_secret_valid(p_secret) then
    raise exception 'Nicht erlaubt' using errcode = '42501';
  end if;
  update private.chat_notifications n
  set attempts = case when n.attempts + 1 >= 3 then 0 else n.attempts + 1 end,
      last_sent_at = case when n.attempts + 1 >= 3 then n.last_sent_at else n.previous_sent_at end
  where n.channel = 'email' and n.recipient_id = any (p_recipients) and n.last_sent_at > now() - interval '10 minutes';
  get diagnostics released = row_count;
  return released;
end;
$$;

revoke execute on function public.claim_chat_notifications(text, integer) from public, anon, authenticated;
revoke execute on function public.release_chat_notifications(text, uuid[]) from public, anon, authenticated;
grant execute on function public.claim_chat_notifications(text, integer) to service_role;
grant execute on function public.release_chat_notifications(text, uuid[]) to service_role;

-- ---------------------------------------------------------------------------
-- Auslöser: pg_cron jede Minute. URL im Vault (lokal per Hand, Cloud per Checkliste); ohne URL nichts.
-- ---------------------------------------------------------------------------
create function private.trigger_chat_notifications()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  url text;
  secret text;
begin
  select s.decrypted_secret into url from vault.decrypted_secrets s where s.name = 'chat_notifications_url';
  select s.decrypted_secret into secret from vault.decrypted_secrets s where s.name = 'chat_notifications_secret';
  if url is null or secret is null then
    return;
  end if;
  perform net.http_post(
    url := url,
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-chat-notify-secret', secret),
    timeout_milliseconds := 20000
  );
end;
$$;
revoke execute on function private.trigger_chat_notifications() from public, anon, authenticated;

select cron.schedule('chat-notifications', '* * * * *', 'select private.trigger_chat_notifications()');
