-- M1 Meldungen, Verifizierungen, Bewertungen (Phase 2, gesperrt), Geräte, Audit-Log.
-- Löschregeln: docs/adr/008-retention-loeschung.md.

-- ---------------------------------------------------------------------------
-- Audit-Log: nur anhängen, nur über Trigger/Server-Funktionen, nie Nachrichteninhalte.
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor_id uuid references public.profiles (user_id) on delete set null,
  action text not null check (action ~ '^[a-z_]+\.[a-z_]+$'),
  target_type text not null,
  target_id uuid not null,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object')
);
create index audit_log_target_idx on public.audit_log (target_type, target_id);
create index audit_log_created_idx on public.audit_log (created_at);

alter table public.audit_log enable row level security;

create policy audit_log_select_admin on public.audit_log
  for select to authenticated
  using ((select private.is_admin()));

grant select on public.audit_log to authenticated;

create function private.write_audit(action text, target_type text, target_id uuid, details jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values ((select auth.uid()), action, target_type, target_id, details);
$$;
revoke execute on function private.write_audit(text, text, uuid, jsonb) from public, anon, authenticated;

-- Moderationsentscheidungen an Anzeigen protokollieren.
create function private.listings_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('active', 'rejected', 'removed') and new.status is distinct from old.status
     or (old.status = 'pending_review' and new.status = 'draft' and new.reject_reason is not null) then
    if private.is_admin() then
      perform private.write_audit('listing.' || new.status::text, 'listing', new.id,
        jsonb_build_object('from', old.status, 'reason', new.reject_reason));
    end if;
  end if;
  return null;
end;
$$;
revoke execute on function private.listings_audit() from public, anon, authenticated;

create trigger listings_audit
  after update of status on public.listings
  for each row execute function private.listings_audit();

-- Sperren und Entsperren von Konten protokollieren.
create function private.profiles_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.write_audit(case when new.is_blocked then 'profile.blocked' else 'profile.unblocked' end,
    'profile', new.user_id);
  return null;
end;
$$;
revoke execute on function private.profiles_audit() from public, anon, authenticated;

create trigger profiles_audit
  after update of is_blocked on public.profiles
  for each row when (new.is_blocked is distinct from old.is_blocked)
  execute function private.profiles_audit();

-- ---------------------------------------------------------------------------
-- Meldungen (SPEC 3.1, DSA): Ziel ohne FK, damit Meldungen eine Löschung überdauern.
-- ---------------------------------------------------------------------------
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  reporter_id uuid default auth.uid() references public.profiles (user_id) on delete set null,
  target_type public.report_target not null,
  target_id uuid not null,
  reason public.report_reason not null,
  note text check (note is null or char_length(note) <= 1000),
  status public.report_status not null default 'open',
  handled_by uuid references public.profiles (user_id) on delete set null,
  handled_at timestamptz
);
create index reports_status_idx on public.reports (status, created_at);
create index reports_reporter_idx on public.reports (reporter_id, created_at);
create index reports_target_idx on public.reports (target_type, target_id);

alter table public.reports enable row level security;

-- Melden nur, was man selbst sehen kann (kein Raten fremder IDs).
create function private.can_report(target_type public.report_target, target_id uuid)
returns boolean
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  return case target_type
    when 'listing' then exists (select 1 from public.listings where id = target_id)
    when 'message' then exists (select 1 from public.messages where id = target_id)
    when 'profile' then exists (select 1 from public.public_profiles where user_id = target_id)
  end;
end;
$$;
grant execute on function private.can_report(public.report_target, uuid) to authenticated;

create policy reports_insert_own on public.reports
  for insert to authenticated
  with check (
    reporter_id = (select auth.uid())
    and (select private.is_active_user((select auth.uid())))
    and private.can_report(target_type, target_id)
  );

-- Meldende sehen den Stand ihrer eigenen Meldungen (DSA Art. 16).
create policy reports_select_own on public.reports
  for select to authenticated
  using (reporter_id = (select auth.uid()));

create policy reports_select_admin on public.reports
  for select to authenticated
  using ((select private.is_admin()));

create policy reports_update_admin on public.reports
  for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

grant select on public.reports to authenticated;
grant insert (target_type, target_id, reason, note) on public.reports to authenticated;
grant update (status) on public.reports to authenticated;

create function private.reports_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if not private.is_server_caller()
       and (select count(*) from public.reports
            where reporter_id = new.reporter_id and created_at > now() - interval '24 hours') >= 20 then
      raise exception 'Zu viele Meldungen in 24 Stunden' using errcode = '54000';
    end if;
    new.status := 'open';
    new.handled_by := null;
    new.handled_at := null;
  elsif new.status is distinct from old.status then
    new.handled_by := case when new.status = 'handled' then (select auth.uid()) end;
    new.handled_at := case when new.status = 'handled' then now() end;
    perform private.write_audit('report.' || new.status::text, 'report', new.id,
      jsonb_build_object('target_type', new.target_type, 'reason', new.reason));
  end if;
  return new;
end;
$$;
revoke execute on function private.reports_guard() from public, anon, authenticated;

create trigger reports_guard
  before insert or update on public.reports
  for each row execute function private.reports_guard();

-- ---------------------------------------------------------------------------
-- Verifizierungen (SPEC 3.1 v0.3): Dokument im privaten Bucket, Pfad im eigenen Ordner.
-- ---------------------------------------------------------------------------
create table public.verifications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null default auth.uid() references public.profiles (user_id) on delete cascade,
  document_path text,
  document_type public.document_type not null,
  status public.verification_request_status not null default 'pending',
  reviewed_by uuid references public.profiles (user_id) on delete set null,
  reviewed_at timestamptz,
  decided_at timestamptz,
  document_deleted_at timestamptz,
  reject_reason text check (reject_reason is null or char_length(btrim(reject_reason)) between 1 and 1000),
  constraint document_path_in_own_folder check (
    document_path is null or document_path ~ ('^' || user_id::text || '/[A-Za-z0-9._-]{1,100}$')
  ),
  constraint document_present_until_deleted check ((document_path is null) = (document_deleted_at is not null)),
  constraint rejection_needs_reason check (status <> 'rejected' or reject_reason is not null)
);
create unique index verifications_one_pending_idx on public.verifications (user_id) where status = 'pending';
create index verifications_status_idx on public.verifications (status, created_at);

alter table public.verifications enable row level security;

create policy verifications_select_own on public.verifications
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy verifications_select_admin on public.verifications
  for select to authenticated
  using ((select private.is_admin()));

create policy verifications_insert_own on public.verifications
  for insert to authenticated
  with check (user_id = (select auth.uid()) and (select private.is_active_user((select auth.uid()))));

create policy verifications_update_admin on public.verifications
  for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

grant select on public.verifications to authenticated;
grant insert (document_path, document_type) on public.verifications to authenticated;
grant update (status, reject_reason) on public.verifications to authenticated;

create function private.verifications_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.document_path is null then
      raise exception 'Verifizierung braucht ein Dokument' using errcode = '23514';
    end if;
    new.status := 'pending';
    new.reviewed_by := null;
    new.reviewed_at := null;
    new.decided_at := null;
    new.document_deleted_at := null;
    new.reject_reason := null;
    -- Eine bestehende Verifizierung geht durch einen neuen Antrag nicht verloren.
    update public.profiles set verification_status = 'pending'
      where user_id = new.user_id and verification_status <> 'verified';
    return new;
  end if;

  if new.status is distinct from old.status then
    if old.status <> 'pending' then
      raise exception 'Entschiedene Verifizierungen sind abgeschlossen' using errcode = '42501';
    end if;
    new.reviewed_by := (select auth.uid());
    new.reviewed_at := now();
    new.decided_at := now();
    if new.status = 'verified' then
      new.reject_reason := null;
    end if;
    update public.profiles set verification_status = new.status::text::public.verification_status
      where user_id = new.user_id and (new.status = 'verified' or verification_status <> 'verified');
    perform private.write_audit('verification.' || new.status::text, 'verification', new.id,
      jsonb_build_object('user_id', new.user_id, 'reason', new.reject_reason));
  end if;
  return new;
end;
$$;
revoke execute on function private.verifications_guard() from public, anon, authenticated;

create trigger verifications_guard
  before insert or update on public.verifications
  for each row execute function private.verifications_guard();

-- ---------------------------------------------------------------------------
-- Bewertungen: Tabelle für Phase 2 angelegt, bis dahin gesperrt (nur Admin liest).
-- ---------------------------------------------------------------------------
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  author_id uuid not null references public.profiles (user_id) on delete cascade,
  target_id uuid not null references public.profiles (user_id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  text text check (text is null or char_length(text) <= 2000),
  unique (conversation_id, author_id),
  check (author_id <> target_id)
);

alter table public.reviews enable row level security;

create policy reviews_select_admin on public.reviews
  for select to authenticated
  using ((select private.is_admin()));

grant select on public.reviews to authenticated;

-- ---------------------------------------------------------------------------
-- Geräte für iOS-Push (ab I5)
-- ---------------------------------------------------------------------------
create table public.devices (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null default auth.uid() references public.profiles (user_id) on delete cascade,
  apns_token text not null unique check (apns_token ~ '^[0-9a-f]{64,200}$'),
  platform public.device_platform not null default 'ios',
  language public.language_code not null default 'de'
);
create index devices_user_idx on public.devices (user_id);

alter table public.devices enable row level security;

create policy devices_own on public.devices
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, delete on public.devices to authenticated;
grant insert (apns_token, platform, language) on public.devices to authenticated;
grant update (language) on public.devices to authenticated;
