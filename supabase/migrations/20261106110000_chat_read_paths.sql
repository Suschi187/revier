-- M7 Commit 3 (ADR 017, Plan M7 4.4, Review A5, A10, H3): Lesen des Chats per RPC. Alle als security invoker:
-- RLS entscheidet, was sichtbar ist (Teilnehmer; Anzeigentitel nur, wenn öffentlich oder eigene Anzeige;
-- Gegenüber über public_profiles, sonst Rückfall ohne Namen).

create index conversations_owner_keyset_idx on public.conversations (owner_id, last_message_at desc, id desc);
create index conversations_interested_keyset_idx on public.conversations (interested_id, last_message_at desc, id desc);
drop index public.conversations_owner_idx;
drop index public.conversations_interested_idx;

-- Eine Unterhaltung aus Sicht des angemeldeten Nutzers. Ungelesen zählen nur Nachrichten, auf die man noch
-- reagieren kann: keine Sperre, Absender aktiv (A10), sonst bliebe der Zähler für immer stehen.
create function private.chat_item(c public.conversations)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with me as (select (select auth.uid()) as uid),
  other as (
    select case when c.owner_id = me.uid then c.interested_id else c.owner_id end as id,
           case when c.owner_id = me.uid then 'owner' else 'interested' end as role
    from me
  ),
  state as (
    select private.is_blocked_with(other.id) as blocked,
           private.is_active_user(other.id) as other_active,
           exists (select 1 from public.blocks b where b.blocker_id = me.uid and b.blocked_id = other.id) as blocked_by_me
    from me, other
  )
  select jsonb_build_object(
    'id', c.id,
    'role', other.role,
    'listing', case when c.listing_id is null then null else
      (select jsonb_build_object('id', l.id, 'title', l.title, 'kind', l.kind,
                                 'public', private.listing_is_public(l.status, l.expires_at, l.owner_id),
                                 'status', case when l.owner_id = me.uid then l.status end)
       from public.listings l where l.id = c.listing_id) end,
    'counterpart', jsonb_build_object(
      'id', other.id,
      'profile', (select jsonb_build_object('display_name', p.display_name, 'account_type', p.account_type,
                                            'business_name', p.business_name, 'verified', p.verification_status = 'verified')
                  from public.public_profiles p where p.user_id = other.id)),
    'last_message_at', c.last_message_at,
    'last_message', (select jsonb_build_object('body', left(m.body, 140), 'mine', m.sender_id = me.uid, 'created_at', m.created_at)
                     from public.messages m where m.conversation_id = c.id order by m.created_at desc, m.id desc limit 1),
    'unread', case when state.blocked or not state.other_active then 0 else
      (select count(*)::int from public.messages m where m.conversation_id = c.id and m.recipient_id = me.uid and m.read_at is null) end,
    'can_write', not state.blocked and state.other_active and private.is_active_user(me.uid),
    'blocked_by_me', state.blocked_by_me
  )
  from me, other, state;
$$;
revoke execute on function private.chat_item(public.conversations) from public, anon;
grant execute on function private.chat_item(public.conversations) to authenticated;

-- Liste, neueste zuerst. Cursor: base64 von "last_message_at|id" der letzten Zeile (wie die Suche, ADR 015).
create function public.my_conversations(p_cursor text default null, p_limit integer default 30)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
set extra_float_digits = 3
as $$
declare
  uid uuid := (select auth.uid());
  after_at timestamptz;
  after_id uuid;
  lim integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  ids uuid[];
  rows jsonb;
  more boolean;
begin
  if uid is null then
    raise exception 'Nicht angemeldet' using errcode = '42501';
  end if;
  if p_cursor is not null then
    begin
      after_at := split_part(convert_from(decode(p_cursor, 'base64'), 'UTF8'), '|', 1)::timestamptz;
      after_id := split_part(convert_from(decode(p_cursor, 'base64'), 'UTF8'), '|', 2)::uuid;
    exception when others then
      raise exception 'Ungültiger Cursor' using errcode = '22023', hint = 'cursor';
    end;
  end if;

  select array_agg(x.id order by x.last_message_at desc, x.id desc) into ids
  from (
    select c.id, c.last_message_at from public.conversations c
    where (c.owner_id = uid or c.interested_id = uid)
      and (after_at is null or (c.last_message_at, c.id) < (after_at, after_id))
    order by c.last_message_at desc, c.id desc
    limit lim + 1
  ) x;
  more := coalesce(array_length(ids, 1), 0) > lim;
  ids := ids[1:lim];
  select coalesce(jsonb_agg(private.chat_item(c) order by array_position(ids, c.id)), '[]') into rows
  from public.conversations c where c.id = any (ids);

  return jsonb_build_object(
    'items', rows,
    -- encode() bricht base64 nach 76 Zeichen um; der Cursor steht in URLs, also ohne Zeilenumbruch.
    'next_cursor', case when more then translate(encode(convert_to(
      (rows -> (jsonb_array_length(rows) - 1) ->> 'last_message_at') || '|' || (rows -> (jsonb_array_length(rows) - 1) ->> 'id'),
      'UTF8'), 'base64'), E'\n', '') end
  );
end;
$$;

-- Kopf einer Unterhaltung; fremd und unbekannt ergeben gleich null.
create function public.conversation_info(p_conversation_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.chat_item(c) from public.conversations c where c.id = p_conversation_id;
$$;

-- Nachrichten einer Unterhaltung. Ohne Grenze: die neuesten. p_before_*: ältere (rückwärts blättern).
-- p_after_*: neuere (Lücke nach dem Wiederverbinden, A5; der Client lädt mit Überlappung und entdoppelt nach id).
-- Ausgabe immer aufsteigend nach (created_at, id); has_more: ältere (ohne Grenze, before) bzw. neuere (after) gibt es.
create function public.conversation_messages(
  p_conversation_id uuid,
  p_before_at timestamptz default null,
  p_before_id uuid default null,
  p_after_at timestamptz default null,
  p_after_id uuid default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  lim integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  ids uuid[];
  rows jsonb;
  more boolean;
begin
  if uid is null or not exists (select 1 from public.conversations c where c.id = p_conversation_id) then
    raise exception 'Unterhaltung nicht gefunden' using errcode = '42501';
  end if;
  if (p_before_at is null) <> (p_before_id is null) or (p_after_at is null) <> (p_after_id is null)
     or (p_before_at is not null and p_after_at is not null) then
    raise exception 'Ungültige Grenze' using errcode = '22023', hint = 'cursor';
  end if;

  -- Eine Zeile mehr als nötig zeigt, ob es weitere gibt.
  select array_agg(x.id order by x.created_at, x.id) filter (where x.n <= lim), count(*) > lim into ids, more
  from (
    select m.id, m.created_at, row_number() over (
             order by case when p_after_at is null then m.created_at end desc, case when p_after_at is null then m.id end desc,
                      m.created_at, m.id) as n
    from public.messages m
    where m.conversation_id = p_conversation_id
      and (p_before_at is null or (m.created_at, m.id) < (p_before_at, p_before_id))
      and (p_after_at is null or (m.created_at, m.id) > (p_after_at, p_after_id))
  ) x
  where x.n <= lim + 1;
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'mine', m.sender_id = uid, 'body', m.body,
                                               'created_at', m.created_at, 'read_at', m.read_at)
                            order by m.created_at, m.id), '[]') into rows
  from public.messages m where m.id = any (coalesce(ids, '{}'));

  return jsonb_build_object('items', rows, 'has_more', coalesce(more, false));
end;
$$;

-- Zähler für die Navigation (A10: ohne gesperrte Paare und inaktive Absender).
create function public.unread_count()
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select count(*)::int
  from public.messages m
  where m.recipient_id = (select auth.uid()) and m.read_at is null
    and not private.is_blocked_with(m.sender_id)
    and private.is_active_user(m.sender_id);
$$;

revoke execute on function public.my_conversations(text, integer) from public, anon;
revoke execute on function public.conversation_info(uuid) from public, anon;
revoke execute on function public.conversation_messages(uuid, timestamptz, uuid, timestamptz, uuid, integer) from public, anon;
revoke execute on function public.unread_count() from public, anon;
grant execute on function public.my_conversations(text, integer) to authenticated;
grant execute on function public.conversation_info(uuid) to authenticated;
grant execute on function public.conversation_messages(uuid, timestamptz, uuid, timestamptz, uuid, integer) to authenticated;
grant execute on function public.unread_count() to authenticated;
