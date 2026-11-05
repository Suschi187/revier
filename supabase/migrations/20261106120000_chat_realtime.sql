-- M7 Commit 4 (ADR 017, Plan M7 Review A4, B3): Realtime per Broadcast aus der Datenbank auf einen privaten
-- Kanal je Nutzer (user:<uuid>). Nutzlast nur IDs und Zeitpunkte, nie der Nachrichtentext; den lädt der Client
-- über conversation_messages (RLS). realtime.messages liegt im Datenbank-Image, auch ohne Realtime-Dienst
-- (Probe mit frischem start und db reset, 2026-11-05).

-- Nur der eigene Kanal ist abonnierbar. Keine INSERT-Policy: kein Client-Broadcast, keine Presence.
create policy chat_own_user_topic on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) = 'user:' || (select auth.uid())::text
  );

create function private.chat_broadcast(p_users uuid[], p_event text, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid;
begin
  foreach target in array p_users loop
    -- realtime.send fängt eigene Fehler ab (Warnung): eine Benachrichtigung bricht nie das Senden ab.
    perform realtime.send(p_payload, p_event, 'user:' || target::text, true);
  end loop;
end;
$$;
revoke execute on function private.chat_broadcast(uuid[], text, jsonb) from public, anon, authenticated;

create function private.messages_broadcast_new()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Beide Teilnehmer: der Empfänger für Anzeige und Zähler, der Absender für seine weiteren Tabs.
  perform private.chat_broadcast(array[new.recipient_id, new.sender_id], 'message.new', jsonb_build_object(
    'conversation_id', new.conversation_id, 'message_id', new.id, 'sender_id', new.sender_id, 'created_at', new.created_at));
  perform private.chat_broadcast(array[new.recipient_id], 'unread.changed', jsonb_build_object('conversation_id', new.conversation_id));
  return null;
end;
$$;
revoke execute on function private.messages_broadcast_new() from public, anon, authenticated;

create trigger messages_broadcast_new
  after insert on public.messages
  for each row execute function private.messages_broadcast_new();

-- Gelesen: Ereignis an beide (Absender sieht „gelesen“), Zähler beim Leser.
create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  c record;
  marked integer;
begin
  select cv.owner_id, cv.interested_id into c from public.conversations cv
  where cv.id = p_conversation_id and uid in (cv.owner_id, cv.interested_id);
  if uid is null or c.owner_id is null then
    raise exception 'Unterhaltung nicht gefunden' using errcode = '42501';
  end if;
  update public.messages set read_at = now()
  where conversation_id = p_conversation_id and recipient_id = uid and read_at is null;
  get diagnostics marked = row_count;
  if marked > 0 then
    perform private.chat_broadcast(array[c.owner_id, c.interested_id], 'message.read',
      jsonb_build_object('conversation_id', p_conversation_id, 'reader_id', uid, 'read_up_to', now()));
    perform private.chat_broadcast(array[uid], 'unread.changed', jsonb_build_object('conversation_id', p_conversation_id));
  end if;
  return marked;
end;
$$;
