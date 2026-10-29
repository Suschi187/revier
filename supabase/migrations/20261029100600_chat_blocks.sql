-- M1 Blockieren, Unterhaltungen, Nachrichten (SPEC 3.1, 3.4).
-- Admins lesen Chats nicht pauschal; gemeldete Nachrichten sieht die Moderation ab M9 gezielt.

create table public.blocks (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  blocker_id uuid not null default auth.uid() references public.profiles (user_id) on delete cascade,
  blocked_id uuid not null references public.profiles (user_id) on delete cascade,
  unique (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index blocks_blocked_idx on public.blocks (blocked_id);

alter table public.blocks enable row level security;

-- Nur der Blockierende sieht seine Sperren; der Blockierte erfährt davon nichts.
create policy blocks_own on public.blocks
  for all to authenticated
  using (blocker_id = (select auth.uid()))
  with check (blocker_id = (select auth.uid()));

grant select, delete on public.blocks to authenticated;
grant insert (blocked_id) on public.blocks to authenticated;

create function private.is_blocked_pair(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.blocks
    where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a)
  );
$$;
grant execute on function private.is_blocked_pair(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  owner_id uuid not null references public.profiles (user_id) on delete cascade,
  interested_id uuid not null default auth.uid() references public.profiles (user_id) on delete cascade,
  last_message_at timestamptz,
  unique (listing_id, interested_id),
  check (owner_id <> interested_id)
);
create index conversations_owner_idx on public.conversations (owner_id, last_message_at desc);
create index conversations_interested_idx on public.conversations (interested_id, last_message_at desc);

alter table public.conversations enable row level security;

-- owner_id kommt immer aus der Anzeige, nie aus dem Request.
create function private.conversations_set_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select l.owner_id into new.owner_id from public.listings l where l.id = new.listing_id;
  return new;
end;
$$;
revoke execute on function private.conversations_set_owner() from public, anon, authenticated;

create trigger conversations_set_owner
  before insert on public.conversations
  for each row execute function private.conversations_set_owner();

create function private.is_conversation_participant(conversation uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.conversations c
    where c.id = conversation and (select auth.uid()) in (c.owner_id, c.interested_id)
  );
$$;
grant execute on function private.is_conversation_participant(uuid) to authenticated;

create policy conversations_select_participant on public.conversations
  for select to authenticated
  using ((select auth.uid()) in (owner_id, interested_id));

-- Kontakt nur zu öffentlichen Anzeigen (status active, siehe listings_select_public).
create policy conversations_insert_interested on public.conversations
  for insert to authenticated
  with check (
    interested_id = (select auth.uid())
    and (select private.is_active_user((select auth.uid())))
    and exists (select 1 from public.listings l where l.id = listing_id and l.status = 'active' and l.expires_at > now())
    and not (select private.is_blocked_pair(owner_id, interested_id))
  );

grant select on public.conversations to authenticated;
grant insert (listing_id) on public.conversations to authenticated;

-- ---------------------------------------------------------------------------
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null default auth.uid() references public.profiles (user_id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  read_at timestamptz
);
create index messages_conversation_idx on public.messages (conversation_id, created_at);
create index messages_unread_idx on public.messages (conversation_id) where read_at is null;

alter table public.messages enable row level security;

create function private.can_write_in(conversation uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.conversations c
    where c.id = conversation
      and (select auth.uid()) in (c.owner_id, c.interested_id)
      and not private.is_blocked_pair(c.owner_id, c.interested_id)
      and private.is_active_user((select auth.uid()))
  );
$$;
grant execute on function private.can_write_in(uuid) to authenticated;

create policy messages_select_participant on public.messages
  for select to authenticated
  using ((select private.is_conversation_participant(conversation_id)));

create policy messages_insert_participant on public.messages
  for insert to authenticated
  with check (sender_id = (select auth.uid()) and (select private.can_write_in(conversation_id)));

-- Gelesen markieren darf nur der Empfänger.
create policy messages_mark_read on public.messages
  for update to authenticated
  using (sender_id <> (select auth.uid()) and (select private.is_conversation_participant(conversation_id)))
  with check (sender_id <> (select auth.uid()) and read_at is not null);

grant select on public.messages to authenticated;
grant insert (conversation_id, body) on public.messages to authenticated;
grant update (read_at) on public.messages to authenticated;

create function private.messages_touch_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversations set last_message_at = new.created_at where id = new.conversation_id;
  return null;
end;
$$;
revoke execute on function private.messages_touch_conversation() from public, anon, authenticated;

create trigger messages_touch_conversation
  after insert on public.messages
  for each row execute function private.messages_touch_conversation();
