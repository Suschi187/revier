-- M7 Commit 7 (ADR 017, Plan M7 Review A11, H7): Blockieren und Entsperren aus der Unterhaltung, Liste der
-- eigenen Sperren, Melden nur fremder Nachrichten der eigenen Unterhaltung, private Kopie gemeldeter Nachrichten.
-- Blockieren, Entsperren und Melden ohne Legal-Gate und auch für gesperrte Konten (App Store, DSA).

-- ---------------------------------------------------------------------------
-- Blockieren (H7): nicht mehr mit beliebiger blocked_id (der FK-Fehler verriet, ob ein Konto existiert)
-- ---------------------------------------------------------------------------
revoke insert on public.blocks from authenticated;

create function public.block_in_conversation(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  other uuid;
begin
  select case when c.owner_id = uid then c.interested_id else c.owner_id end into other
  from public.conversations c where c.id = p_conversation_id and uid in (c.owner_id, c.interested_id);
  if uid is null or other is null then
    raise exception 'Unterhaltung nicht gefunden' using errcode = '42501';
  end if;
  insert into public.blocks (blocker_id, blocked_id) values (uid, other) on conflict (blocker_id, blocked_id) do nothing;
end;
$$;

create function public.unblock_in_conversation(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  other uuid;
begin
  select case when c.owner_id = uid then c.interested_id else c.owner_id end into other
  from public.conversations c where c.id = p_conversation_id and uid in (c.owner_id, c.interested_id);
  if uid is null or other is null then
    raise exception 'Unterhaltung nicht gefunden' using errcode = '42501';
  end if;
  delete from public.blocks where blocker_id = uid and blocked_id = other;
end;
$$;

-- Eigene Sperren mit Namen (Rückfall null für gelöschte oder gesperrte Konten). Entsperren per DELETE auf blocks
-- (Policy blocks_own) oder aus der Unterhaltung.
create function public.my_blocks()
returns table (blocked_id uuid, display_name text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select b.blocked_id,
         case when p.deleted_at is null and not p.is_blocked then
           case when p.account_type = 'business' and p.business_name is not null then p.business_name else p.display_name end
         end,
         b.created_at
  from public.blocks b
  left join public.profiles p on p.user_id = b.blocked_id
  where b.blocker_id = (select auth.uid())
  order by b.created_at desc;
$$;

revoke execute on function public.block_in_conversation(uuid) from public, anon;
revoke execute on function public.unblock_in_conversation(uuid) from public, anon;
revoke execute on function public.my_blocks() from public, anon;
grant execute on function public.block_in_conversation(uuid) to authenticated;
grant execute on function public.unblock_in_conversation(uuid) to authenticated;
grant execute on function public.my_blocks() to authenticated;

-- ---------------------------------------------------------------------------
-- Melden: Nachrichten nur fremde aus der eigenen Unterhaltung (A11)
-- ---------------------------------------------------------------------------
create or replace function private.can_report(target_type public.report_target, target_id uuid)
returns boolean
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  return case target_type
    when 'listing' then exists (select 1 from public.listings where id = target_id)
    -- RLS auf messages: nur Teilnehmer sehen die Nachricht.
    when 'message' then exists (select 1 from public.messages m where m.id = target_id and m.sender_id <> (select auth.uid()))
    when 'profile' then exists (select 1 from public.public_profiles where user_id = target_id)
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Private Kopie gemeldeter Nachrichten (A11): bleibt, auch wenn der Absender sein Konto löscht. Ohne API-Rechte;
-- lesbar ab M9 nur für Admins mit aal2 über eine RPC. Frist wie bearbeitete Meldungen (handled_reports_months,
-- ADR 008, Löschjob in M9).
-- ---------------------------------------------------------------------------
create table private.reported_message_snapshots (
  report_id uuid primary key references public.reports (id) on delete cascade,
  message_id uuid not null,
  conversation_id uuid not null,
  sender_id uuid not null,
  body text not null,
  message_created_at timestamptz not null,
  captured_at timestamptz not null default now()
);
alter table private.reported_message_snapshots enable row level security;
revoke all on private.reported_message_snapshots from public, anon, authenticated;

create function private.reports_snapshot_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.reported_message_snapshots (report_id, message_id, conversation_id, sender_id, body, message_created_at)
  select new.id, m.id, m.conversation_id, m.sender_id, m.body, m.created_at
  from public.messages m where m.id = new.target_id;
  return null;
end;
$$;
revoke execute on function private.reports_snapshot_message() from public, anon, authenticated;

create trigger reports_snapshot_message
  after insert on public.reports
  for each row when (new.target_type = 'message')
  execute function private.reports_snapshot_message();

-- Melden auch für gesperrte Konten (ADR 017, App Store/DSA: wer belästigt wird, muss melden können, auch wenn das
-- eigene Konto gesperrt ist). Grenze 20 je 24 h bleibt (reports_guard).
drop policy reports_insert_own on public.reports;
create policy reports_insert_own on public.reports
  for insert to authenticated
  with check (
    reporter_id = (select auth.uid())
    and private.can_report(target_type, target_id)
  );
