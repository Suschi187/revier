-- M7 Commit 2 (ADR 017, Plan M7 Review B1, A1, A8, A9, A10): Schreibwege des Chats nur über Definer-RPCs mit
-- ausdrücklichen Prüfungen in fester Reihenfolge, recipient_id vom Server, read_at nur null → now(),
-- Textregeln, Rate-Limits (RV002 mit scope), Legal-Gate (RV001).

-- ---------------------------------------------------------------------------
-- Einstellungen
-- ---------------------------------------------------------------------------
insert into private.app_settings (key, value, description) values
  ('chat_new_conversations_daily', '10', 'Neue Unterhaltungen je Konto in 24 h (ADR 017)'),
  ('chat_new_conversations_daily_new', '3', 'Neue Unterhaltungen je neuem Konto in 24 h (ADR 017)'),
  ('chat_messages_per_10min', '30', 'Nachrichten je Konto in 10 Minuten (ADR 017)'),
  ('chat_messages_per_10min_new', '15', 'Nachrichten je neuem Konto in 10 Minuten (ADR 017)'),
  ('chat_unanswered_max', '5', 'Nachrichten in einer Unterhaltung, solange das Gegenüber nie geantwortet hat (ADR 017)'),
  ('chat_new_account_days', '7', 'Konten jünger als diese Zahl Tage gelten im Chat als neu (ADR 017)');

-- ---------------------------------------------------------------------------
-- Textregeln (A9): getrimmt, LF statt CRLF/CR, keine Steuer- und Bidi-Zeichen, 1–2000 Codepoints.
-- Gleichlautend in Zod (web/lib/chat/rules.ts), Fälle in supabase/tests/fixtures/chat_rules.json.
-- ---------------------------------------------------------------------------
create function private.chat_normalize_body(p_body text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select private.trim_all(regexp_replace(p_body, '\r\n?', E'\n', 'g'));
$$;

create function private.chat_body_valid(p_body text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_body is not null
    and char_length(p_body) between 1 and 2000
    and p_body = private.trim_all(p_body)
    and p_body !~ '[\x01-\x08\x0B-\x1F\x7F-\x9F‪-‮⁦-⁩]';
$$;
revoke execute on function private.chat_normalize_body(text) from public, anon, authenticated;
revoke execute on function private.chat_body_valid(text) from public, anon, authenticated;

alter table public.messages drop constraint messages_body_check;
alter table public.messages add constraint messages_body_valid check (private.chat_body_valid(body));

-- ---------------------------------------------------------------------------
-- recipient_id (H3): aus der Unterhaltung, nie aus dem Request, unveränderlich
-- ---------------------------------------------------------------------------
alter table public.messages add column recipient_id uuid references public.profiles (user_id) on delete cascade;
update public.messages m set recipient_id = case when c.owner_id = m.sender_id then c.interested_id else c.owner_id end
from public.conversations c where c.id = m.conversation_id;
alter table public.messages alter column recipient_id set not null;

create function private.messages_set_recipient()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select case when c.owner_id = new.sender_id then c.interested_id
              when c.interested_id = new.sender_id then c.owner_id end
  into new.recipient_id
  from public.conversations c where c.id = new.conversation_id;
  if new.recipient_id is null then
    raise exception 'Absender ist nicht Teilnehmer' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function private.messages_set_recipient() from public, anon, authenticated;

create trigger messages_set_recipient
  before insert on public.messages
  for each row execute function private.messages_set_recipient();

-- read_at nur null → now(); alles andere an einer Nachricht ist unveränderlich, auch für den Server.
create function private.messages_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.id, new.created_at, new.conversation_id, new.sender_id, new.recipient_id, new.body)
     is distinct from (old.id, old.created_at, old.conversation_id, old.sender_id, old.recipient_id, old.body)
     or (old.read_at is not null and new.read_at is distinct from old.read_at)
     or (old.read_at is null and new.read_at is not null and new.read_at <> now()) then
    raise exception 'Nachrichten sind unveränderlich' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function private.messages_guard_update() from public, anon, authenticated;

create trigger messages_guard_update
  before update on public.messages
  for each row execute function private.messages_guard_update();

drop index public.messages_unread_idx;
drop index public.messages_conversation_idx;
create index messages_unread_recipient_idx on public.messages (recipient_id, created_at) where read_at is null;
create index messages_conversation_idx on public.messages (conversation_id, created_at desc, id desc);
create index messages_sender_idx on public.messages (sender_id, created_at);
create index conversations_interested_created_idx on public.conversations (interested_id, created_at);

-- ---------------------------------------------------------------------------
-- Direkte Schreibwege schließen (A1): nur noch die RPCs unten
-- ---------------------------------------------------------------------------
drop policy conversations_insert_interested on public.conversations;
revoke insert on public.conversations from authenticated;
drop policy messages_insert_participant on public.messages;
drop policy messages_mark_read on public.messages;
revoke insert, update on public.messages from authenticated;
drop function private.can_write_in(uuid);

-- ---------------------------------------------------------------------------
-- Hilfsfunktionen (nur für die RPCs, ohne API-Rechte)
-- ---------------------------------------------------------------------------
create function private.chat_retry_after(p_at timestamptz)
returns text
language sql
immutable
set search_path = ''
as $$
  select to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
$$;

-- Rate-Limits unter einer Sperre je Nutzer (A8). scope: chat_conversations oder chat_messages.
create function private.chat_check_rate(p_uid uuid, p_scope text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  is_new boolean;
  max_count integer;
  recent integer;
  oldest timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext('chat:' || p_uid::text));
  select coalesce(now() - u.created_at < make_interval(days => private.setting_int('chat_new_account_days')), true)
  into is_new from auth.users u where u.id = p_uid;
  is_new := coalesce(is_new, true);
  if p_scope = 'chat_conversations' then
    max_count := private.setting_int(case when is_new then 'chat_new_conversations_daily_new' else 'chat_new_conversations_daily' end);
    select count(*), min(c.created_at) into recent, oldest
    from public.conversations c where c.interested_id = p_uid and c.created_at > now() - interval '24 hours';
    if recent >= max_count then
      raise exception 'chat_rate_limited' using errcode = 'RV002',
        hint = jsonb_build_object('retry_after', private.chat_retry_after(oldest + interval '24 hours'), 'scope', p_scope)::text;
    end if;
  else
    max_count := private.setting_int(case when is_new then 'chat_messages_per_10min_new' else 'chat_messages_per_10min' end);
    select count(*), min(m.created_at) into recent, oldest
    from public.messages m where m.sender_id = p_uid and m.created_at > now() - interval '10 minutes';
    if recent >= max_count then
      raise exception 'chat_rate_limited' using errcode = 'RV002',
        hint = jsonb_build_object('retry_after', private.chat_retry_after(oldest + interval '10 minutes'), 'scope', p_scope)::text;
    end if;
  end if;
end;
$$;

-- Schreiben in einer Unterhaltung: Teilnehmer, keine Sperre, beide Konten aktiv (A10). Gibt das Gegenüber zurück.
create function private.chat_writable_counterpart(p_conversation_id uuid, p_uid uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case when c.owner_id = p_uid then c.interested_id else c.owner_id end
  from public.conversations c
  where c.id = p_conversation_id
    and p_uid in (c.owner_id, c.interested_id)
    and not private.is_blocked_pair(c.owner_id, c.interested_id)
    and private.is_active_user(c.owner_id)
    and private.is_active_user(c.interested_id);
$$;

-- Ohne Antwort höchstens chat_unanswered_max Nachrichten (A8). Erst nach der Teilnahmeprüfung aufrufen,
-- sonst zählte sie in fremden Unterhaltungen (Orakel).
create function private.chat_check_unanswered(p_conversation_id uuid, p_uid uuid, p_counterpart uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.messages m where m.conversation_id = p_conversation_id and m.sender_id = p_counterpart)
     and (select count(*) from public.messages m where m.conversation_id = p_conversation_id and m.sender_id = p_uid)
         >= private.setting_int('chat_unanswered_max') then
    raise exception 'chat_rate_limited' using errcode = 'RV002',
      hint = jsonb_build_object('retry_after', null, 'scope', 'chat_unanswered')::text;
  end if;
end;
$$;

-- Gemeinsame Vorprüfung: angemeldet, aktiv, Zustimmung, Text. Gibt den normalisierten Text zurück.
create function private.chat_precheck(p_body text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  body text := private.chat_normalize_body(p_body);
begin
  if uid is null or not private.is_active_user(uid) then
    raise exception 'Nicht erlaubt' using errcode = '42501';
  end if;
  perform private.require_current_legal();
  if not private.chat_body_valid(body) then
    raise exception 'Ungültige Nachricht' using errcode = '22023', hint = 'body';
  end if;
  return body;
end;
$$;

revoke execute on function private.chat_retry_after(timestamptz) from public, anon, authenticated;
revoke execute on function private.chat_check_rate(uuid, text) from public, anon, authenticated;
revoke execute on function private.chat_writable_counterpart(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.chat_check_unanswered(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function private.chat_precheck(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------
-- Neue Unterhaltung nur zu öffentlichen, fremden Anzeigen ohne Sperre; gibt es sie schon, gelten die Regeln
-- für bestehende Unterhaltungen (Schreiben auch, wenn die Anzeige nicht mehr öffentlich ist).
create function public.start_conversation(p_listing_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  body text := private.chat_precheck(p_body);
  conversation uuid;
  counterpart uuid;
  l record;
begin
  select c.id into conversation from public.conversations c where c.listing_id = p_listing_id and c.interested_id = uid;
  if conversation is null then
    perform private.chat_check_rate(uid, 'chat_conversations');
    perform private.chat_check_rate(uid, 'chat_messages');
    select l2.owner_id, l2.status, l2.expires_at into l from public.listings l2 where l2.id = p_listing_id;
    if l.owner_id is null or l.owner_id = uid or not private.listing_is_public(l.status, l.expires_at, l.owner_id)
       or private.is_blocked_pair(l.owner_id, uid) then
      raise exception 'Unterhaltung nicht möglich' using errcode = '42501';
    end if;
    insert into public.conversations (listing_id, interested_id) values (p_listing_id, uid)
    on conflict (listing_id, interested_id) do nothing
    returning id into conversation;
    if conversation is null then
      -- Parallel angelegt: wie eine bestehende Unterhaltung behandeln.
      select c.id into conversation from public.conversations c where c.listing_id = p_listing_id and c.interested_id = uid;
    end if;
  else
    perform private.chat_check_rate(uid, 'chat_messages');
  end if;

  counterpart := private.chat_writable_counterpart(conversation, uid);
  if counterpart is null then
    raise exception 'Unterhaltung nicht möglich' using errcode = '42501';
  end if;
  perform private.chat_check_unanswered(conversation, uid, counterpart);
  insert into public.messages (conversation_id, sender_id, body) values (conversation, uid, body);
  return conversation;
end;
$$;

create function public.send_message(p_conversation_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  body text := private.chat_precheck(p_body);
  counterpart uuid;
  message uuid;
begin
  perform private.chat_check_rate(uid, 'chat_messages');
  counterpart := private.chat_writable_counterpart(p_conversation_id, uid);
  if counterpart is null then
    raise exception 'Unterhaltung nicht möglich' using errcode = '42501';
  end if;
  perform private.chat_check_unanswered(p_conversation_id, uid, counterpart);
  insert into public.messages (conversation_id, sender_id, body) values (p_conversation_id, uid, body)
  returning id into message;
  return message;
end;
$$;

-- Lesen ist auch bei Sperre und für gesperrte Konten möglich; kein Legal-Gate.
create function public.mark_conversation_read(p_conversation_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  marked integer;
begin
  if uid is null or not exists (
    select 1 from public.conversations c where c.id = p_conversation_id and uid in (c.owner_id, c.interested_id)
  ) then
    raise exception 'Unterhaltung nicht gefunden' using errcode = '42501';
  end if;
  update public.messages set read_at = now()
  where conversation_id = p_conversation_id and recipient_id = uid and read_at is null;
  get diagnostics marked = row_count;
  return marked;
end;
$$;

revoke execute on function public.start_conversation(uuid, text) from public, anon;
revoke execute on function public.send_message(uuid, text) from public, anon;
revoke execute on function public.mark_conversation_read(uuid) from public, anon;
grant execute on function public.start_conversation(uuid, text) to authenticated;
grant execute on function public.send_message(uuid, text) to authenticated;
grant execute on function public.mark_conversation_read(uuid) to authenticated;
