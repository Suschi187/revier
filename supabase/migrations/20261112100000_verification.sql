-- M9b (ADR 020, Plan M9 4.3, Review A6, B3): Verifizierung „Zeile zuerst“.
-- - begin_verification legt den Antrag an (Pfad {user_id}/{id}), submit_verification reicht ihn ein, sobald die Datei
--   liegt; withdraw_verification zieht einen offenen Antrag zurück. Limit verification_requests_per_30d in eigenen
--   Zählerzeilen (Zurückziehen und Aufräumen umgehen es nicht), RV002 mit scope verification.
-- - Entscheiden nur per decide_verification, Widerruf per revoke_verification (aal2, nie das eigene Konto). Roh-INSERT
--   und Roh-UPDATE an verifications entfallen; der Guard lässt Statuswechsel nur mit dem Flag revier.verification zu.
-- - Storage: Upload nur auf den Pfad eines eigenen, nicht eingereichten Antrags, Löschen durch den Besitzer bis zur
--   Einreichung, keine Update-Policy. Admins lesen ein Dokument nur mit frischem Audit verification.document_viewed
--   (2 Minuten, Review B3). Bucket ohne HEIC.
-- - Der Profilstatus wird aus den Anträgen abgeleitet; jeder Wechsel zu oder weg von verified erhöht den Cache-Zähler.
-- - Export version 3 mit den neuen Spalten.

insert into private.app_settings (key, value, description) values
  ('verification_requests_per_30d', '3', 'Verifizierungsanträge je Konto in 30 Tagen (ADR 020, Platzhalter)'),
  ('verification_doc_link_seconds', '60', 'Laufzeit der signierten URL eines Verifizierungsdokuments im Admin (ADR 020)');

update storage.buckets set allowed_mime_types = array['image/jpeg', 'image/png', 'application/pdf']
where id = 'verification-docs';

-- Spalten ------------------------------------------------------------------------------------------------------------
alter table public.verifications
  add column submitted_at timestamptz,
  add column reject_code text check (reject_code in ('unreadable', 'expired', 'mismatch', 'wrong_document', 'other')),
  add column revoked_at timestamptz,
  add column revoke_code text check (revoke_code in ('expired', 'mismatch', 'fraud', 'other')),
  add column revoke_reason text check (revoke_reason is null or char_length(btrim(revoke_reason)) between 1 and 1000);

-- Bestandsanträge (nur Testdaten vor M9b) gelten als eingereicht.
update public.verifications set submitted_at = created_at where submitted_at is null and document_path is not null;

alter table public.verifications
  drop constraint rejection_needs_reason,
  add constraint rejection_needs_reason check (status <> 'rejected' or reject_code is not null or reject_reason is not null),
  add constraint other_needs_reason check (reject_code is distinct from 'other' or reject_reason is not null),
  add constraint revoke_other_needs_reason check (revoke_code is distinct from 'other' or revoke_reason is not null),
  add constraint revoked_only_verified check (revoked_at is null or (status = 'verified' and revoke_code is not null)),
  add constraint decided_after_submit check (status = 'pending' or submitted_at is not null or document_deleted_at is not null);

create unique index verifications_document_path_idx on public.verifications (document_path) where document_path is not null;
create index verifications_queue_idx on public.verifications (submitted_at, id) where status = 'pending' and submitted_at is not null;

-- Nur noch über die RPCs.
drop policy verifications_insert_own on public.verifications;
drop policy verifications_update_admin on public.verifications;
revoke insert, update on public.verifications from authenticated;
grant select (submitted_at, reject_code, revoked_at, revoke_code, revoke_reason) on public.verifications to authenticated;

-- Zählerzeilen für das Limit (Review A6) -----------------------------------------------------------------------------
create table private.verification_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  created_at timestamptz not null default now()
);
create index verification_attempts_user_idx on private.verification_attempts (user_id, created_at);
alter table private.verification_attempts enable row level security;
revoke all on private.verification_attempts from public, anon, authenticated;

-- Profilstatus aus den Anträgen --------------------------------------------------------------------------------------
-- verified, solange ein verifizierter Antrag nicht widerrufen ist (ein neuer Antrag oder eine Ablehnung hebt das nicht
-- auf); sonst pending bei einem eingereichten offenen Antrag; sonst rejected, wenn die letzte Entscheidung (Widerruf
-- eingeschlossen) eine Ablehnung war; sonst none.
create function private.sync_verification_status(p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profiles p set verification_status = s.status
  from (
    select case
      when exists (select 1 from public.verifications v
                   where v.user_id = p_user_id and v.status = 'verified' and v.revoked_at is null) then 'verified'
      when exists (select 1 from public.verifications v
                   where v.user_id = p_user_id and v.status = 'pending' and v.submitted_at is not null) then 'pending'
      -- Letzte Entscheidung; ein Widerruf zählt mit seinem Zeitpunkt (danach none, nicht eine ältere Ablehnung).
      when (select v.status from public.verifications v where v.user_id = p_user_id and v.status <> 'pending'
            order by coalesce(v.revoked_at, v.decided_at) desc nulls last, v.revoked_at is not null desc, v.created_at desc
            limit 1) = 'rejected' then 'rejected'
      else 'none'
    end::public.verification_status as status
  ) s
  where p.user_id = p_user_id and p.verification_status is distinct from s.status;
$$;
revoke execute on function private.sync_verification_status(uuid) from public, anon, authenticated;

create function private.verifications_sync_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.sync_verification_status(coalesce(new.user_id, old.user_id));
  return null;
end;
$$;
revoke execute on function private.verifications_sync_profile() from public, anon, authenticated;

create trigger verifications_sync_profile after insert or update or delete on public.verifications
  for each row execute function private.verifications_sync_profile();

-- Badge auf gecachten Seiten und im Filter „nur verifizierte“ (Review A6).
create trigger profiles_verified_bump_cache after update of verification_status on public.profiles
  for each row when ((old.verification_status = 'verified') is distinct from (new.verification_status = 'verified'))
  execute function private.bump_public_cache_epoch();

-- Guard --------------------------------------------------------------------------------------------------------------
create or replace function private.verifications_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  via_rpc boolean := coalesce(current_setting('revier.verification', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if new.document_path is null then
      raise exception 'Verifizierung braucht einen Dokumentpfad' using errcode = '23514';
    end if;
    new.status := 'pending';
    new.submitted_at := null;
    new.reviewed_by := null;
    new.reviewed_at := null;
    new.decided_at := null;
    new.document_deleted_at := null;
    new.reject_code := null;
    new.reject_reason := null;
    new.revoked_at := null;
    new.revoke_code := null;
    new.revoke_reason := null;
    return new;
  end if;

  if new.user_id is distinct from old.user_id or new.document_type is distinct from old.document_type and old.submitted_at is not null
     or new.created_at is distinct from old.created_at then
    raise exception 'Antrag ist unveränderlich' using errcode = '42501';
  end if;
  -- Den Pfad ändert nur der Aufräumjob (Datei gelöscht → null).
  if new.document_path is distinct from old.document_path and new.document_path is not null then
    raise exception 'Dokumentpfad ist unveränderlich' using errcode = '42501';
  end if;

  if old.status <> 'pending' then
    -- Entschiedene Anträge sind abgeschlossen, auch Code und Grund. Erlaubt bleibt nur der einmalige Widerruf.
    if new.status is distinct from old.status or new.reject_reason is distinct from old.reject_reason
       or new.reject_code is distinct from old.reject_code or new.submitted_at is distinct from old.submitted_at then
      raise exception 'Entschiedene Verifizierungen sind abgeschlossen' using errcode = '42501';
    end if;
    if (new.revoked_at, new.revoke_code, new.revoke_reason) is distinct from (old.revoked_at, old.revoke_code, old.revoke_reason) then
      if not via_rpc or old.status <> 'verified' or old.revoked_at is not null then
        raise exception 'Widerruf nur per revoke_verification' using errcode = '42501';
      end if;
      new.revoked_at := now();
      perform private.write_audit('verification.revoked', 'verification', new.id,
        jsonb_build_object('user_id', new.user_id, 'code', new.revoke_code, 'reason', new.revoke_reason));
    end if;
    return new;
  end if;

  if (new.revoked_at, new.revoke_code, new.revoke_reason) is distinct from (old.revoked_at, old.revoke_code, old.revoke_reason) then
    raise exception 'Nur verifizierte Anträge lassen sich widerrufen' using errcode = '42501';
  end if;

  if new.submitted_at is distinct from old.submitted_at then
    if not via_rpc or old.submitted_at is not null then
      raise exception 'Einreichen nur per submit_verification' using errcode = '42501';
    end if;
    new.submitted_at := now();
  end if;

  if new.status is distinct from old.status then
    if not via_rpc or old.submitted_at is null then
      raise exception 'Entscheiden nur per decide_verification' using errcode = '42501';
    end if;
    new.reviewed_by := (select auth.uid());
    new.reviewed_at := now();
    new.decided_at := now();
    if new.status = 'verified' then
      new.reject_code := null;
      new.reject_reason := null;
    end if;
    perform private.write_audit('verification.' || new.status::text, 'verification', new.id,
      jsonb_build_object('user_id', new.user_id, 'code', new.reject_code, 'reason', new.reject_reason));
  elsif new.reject_code is distinct from old.reject_code or new.reject_reason is distinct from old.reject_reason then
    raise exception 'Grund nur mit der Entscheidung' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Benachrichtigungs-Warteschlange (ADR 020, Review A11); Versand in send-search-notifications --------------------------
insert into private.app_settings (key, value, description) values
  ('account_email_batch', '50', 'Dienstmails (account_notifications) je Lauf (ADR 020)');

create table private.account_notifications (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('account_blocked', 'account_unblocked', 'account_warned', 'verification_verified',
                                     'verification_rejected', 'verification_revoked', 'report_resolved', 'appeal_decided',
                                     'draft_expiry_notice')),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  -- Audit- bzw. Fachdatensatz; der Text wird beim Versand daraus gelesen.
  ref_id uuid not null,
  -- Allowlist je Art: nur der Hinweis auf verlassene Entwürfe trägt das Löschdatum.
  payload jsonb not null default '{}'::jsonb check (
    case kind
      when 'draft_expiry_notice' then jsonb_typeof(payload) = 'object' and payload - 'deletes_at' = '{}'::jsonb
      else payload = '{}'::jsonb
    end),
  created_at timestamptz not null default now(),
  claim_id uuid,
  claimed_at timestamptz,
  sent_at timestamptz,
  attempts integer not null default 0,
  done_at timestamptz,
  unique (kind, ref_id, user_id),
  check ((claim_id is null) = (claimed_at is null)),
  check (sent_at is null or done_at is not null)
);
create index account_notifications_open_idx on private.account_notifications (created_at, id) where done_at is null and claim_id is null;
create index account_notifications_claim_idx on private.account_notifications (claim_id) where claim_id is not null;
create index account_notifications_user_idx on private.account_notifications (user_id);
create index account_notifications_retention_idx on private.account_notifications (coalesce(done_at, claimed_at, created_at));
alter table private.account_notifications enable row level security;
revoke all on private.account_notifications from public, anon, authenticated;

-- Inhalt je Art aus dem Fachdatensatz (Allowlist). null = Quelle fehlt, die Zeile wird ohne Versand erledigt.
-- Spätere Arten (Sperre, Meldung, Beschwerde, Entwurf) ergänzen ihre Zweige mit ihren Commits.
create function private.account_notification_details(p_kind text, p_ref_id uuid, p_user_id uuid, p_payload jsonb)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_kind in ('verification_verified', 'verification_rejected', 'verification_revoked') then (
      select jsonb_build_object(
        'document_type', v.document_type,
        'code', case p_kind when 'verification_rejected' then v.reject_code when 'verification_revoked' then v.revoke_code end,
        'reason', case p_kind when 'verification_rejected' then v.reject_reason when 'verification_revoked' then v.revoke_reason end,
        'decided_at', case p_kind when 'verification_revoked' then v.revoked_at else v.decided_at end)
      from public.verifications v
      where v.id = p_ref_id and v.user_id = p_user_id
        and case p_kind
              when 'verification_verified' then v.status = 'verified'
              when 'verification_rejected' then v.status = 'rejected'
              else v.revoked_at is not null
            end)
  end;
$$;
revoke execute on function private.account_notification_details(text, uuid, uuid, jsonb) from public, anon, authenticated;

create function public.claim_account_notifications(p_secret text, p_limit integer default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  lim integer := least(coalesce(p_limit, private.setting_int('account_email_batch')), private.setting_int('account_email_batch'));
  result jsonb;
begin
  if not private.search_notifications_secret_valid(p_secret) then
    raise exception 'Nicht erlaubt' using errcode = '42501';
  end if;

  -- Ohne Empfänger (gelöscht, ohne bestätigte Adresse) oder ohne Quelle: erledigt ohne Versand. Gesperrte Konten
  -- bekommen Dienstmails (ADR 020).
  update private.account_notifications n
  set done_at = now()
  where n.id in (
    select x.id from private.account_notifications x
    where x.done_at is null and x.claim_id is null
      and (not exists (
             select 1 from public.profiles p join auth.users u on u.id = p.user_id
             where p.user_id = x.user_id and p.deleted_at is null and u.email is not null and u.email_confirmed_at is not null)
           or private.account_notification_details(x.kind, x.ref_id, x.user_id, x.payload) is null)
    for update of x skip locked);

  with picked as (
    select x.id from private.account_notifications x
    where x.done_at is null and x.claim_id is null
    order by x.created_at, x.id
    limit greatest(lim, 0)
    for update of x skip locked
  ),
  claimed as (
    update private.account_notifications n
    set claim_id = gen_random_uuid(), claimed_at = now()
    from picked
    where n.id = picked.id
    returning n.claim_id, n.kind, n.user_id, n.ref_id, n.payload, n.created_at
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'claim_id', c.claim_id,
      'kind', c.kind,
      'email', u.email,
      'language', p.preferred_language,
      'details', private.account_notification_details(c.kind, c.ref_id, c.user_id, c.payload)
    ) order by c.created_at, c.claim_id), '[]'::jsonb)
  into result
  from claimed c
  join public.profiles p on p.user_id = c.user_id
  join auth.users u on u.id = c.user_id;

  return result;
end;
$$;

create function public.confirm_account_notifications(p_secret text, p_claim_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  confirmed integer;
begin
  if not private.search_notifications_secret_valid(p_secret) then
    raise exception 'Nicht erlaubt' using errcode = '42501';
  end if;
  update private.account_notifications n
  set sent_at = now(), done_at = now()
  where n.claim_id = any (p_claim_ids) and n.done_at is null;
  get diagnostics confirmed = row_count;
  return confirmed;
end;
$$;

create function public.release_account_notifications(p_secret text, p_claim_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  released integer;
begin
  if not private.search_notifications_secret_valid(p_secret) then
    raise exception 'Nicht erlaubt' using errcode = '42501';
  end if;
  update private.account_notifications n
  set attempts = n.attempts + 1,
      done_at = case when n.attempts + 1 >= 3 then now() end,
      claim_id = case when n.attempts + 1 >= 3 then n.claim_id end,
      claimed_at = case when n.attempts + 1 >= 3 then n.claimed_at end
  where n.claim_id = any (p_claim_ids) and n.done_at is null;
  get diagnostics released = row_count;
  return released;
end;
$$;

revoke execute on function public.claim_account_notifications(text, integer) from public, anon, authenticated;
revoke execute on function public.confirm_account_notifications(text, uuid[]) from public, anon, authenticated;
revoke execute on function public.release_account_notifications(text, uuid[]) from public, anon, authenticated;
grant execute on function public.claim_account_notifications(text, integer) to service_role;
grant execute on function public.confirm_account_notifications(text, uuid[]) to service_role;
grant execute on function public.release_account_notifications(text, uuid[]) to service_role;

-- Fristen: Warteschlange 30 Tage, Zählerzeilen 30 Tage (ADR 020).
create function private.purge_trust_records()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
  a integer;
begin
  delete from private.account_notifications where coalesce(done_at, claimed_at, created_at) < now() - interval '30 days';
  get diagnostics n = row_count;
  delete from private.verification_attempts where created_at < now() - interval '30 days';
  get diagnostics a = row_count;
  return jsonb_build_object('notifications', n, 'attempts', a);
end;
$$;
revoke execute on function private.purge_trust_records() from public, anon, authenticated;
select cron.schedule('trust-retention', '47 3 * * *', 'select private.purge_trust_records()');

-- RPCs für Nutzer ----------------------------------------------------------------------------------------------------
create function public.begin_verification(p_document_type public.document_type)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  existing record;
  recent integer;
  oldest timestamptz;
  new_id uuid := gen_random_uuid();
  path text;
begin
  if uid is null or not private.is_active_user(uid) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  perform private.require_current_legal();
  if p_document_type is null then
    raise exception 'Dokumenttyp fehlt' using errcode = '23514', hint = '{"fields":["document_type"]}';
  end if;
  if p_document_type = 'gewerbe'
     and (select p.account_type from public.profiles p where p.user_id = uid) is distinct from 'business' then
    raise exception 'gewerbe nur für gewerbliche Konten' using errcode = '23514', hint = '{"fields":["document_type"]}';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('verification:' || uid::text, 0));
  select v.id, v.submitted_at, v.document_path into existing
  from public.verifications v where v.user_id = uid and v.status = 'pending' for update;
  if found then
    if existing.submitted_at is not null then
      raise exception 'verification_open' using errcode = '23505';
    end if;
    -- Noch nicht eingereicht: derselbe Antrag, ohne neuen Versuch (erneuter Upload nach einem Fehler).
    update public.verifications set document_type = p_document_type where id = existing.id;
    return jsonb_build_object('id', existing.id, 'path', existing.document_path);
  end if;

  select count(*), min(a.created_at) into recent, oldest
  from private.verification_attempts a where a.user_id = uid and a.created_at > now() - interval '30 days';
  if recent >= private.setting_int('verification_requests_per_30d') then
    raise exception 'verification_rate_limited' using errcode = 'RV002',
      hint = jsonb_build_object('retry_after', to_char((oldest + interval '30 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                                'scope', 'verification')::text;
  end if;
  insert into private.verification_attempts (user_id) values (uid);

  path := uid::text || '/' || new_id::text;
  insert into public.verifications (id, user_id, document_type, document_path) values (new_id, uid, p_document_type, path);
  return jsonb_build_object('id', new_id, 'path', path);
end;
$$;

create function public.submit_verification(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  v record;
  previous_flag text := coalesce(current_setting('revier.verification', true), '');
begin
  if uid is null or not private.is_active_user(uid) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  perform private.require_current_legal();
  select x.id, x.status, x.submitted_at, x.document_path into v
  from public.verifications x where x.id = p_id and x.user_id = uid for update;
  if not found then
    raise exception 'Antrag nicht gefunden' using errcode = 'P0002';
  end if;
  if v.status <> 'pending' or v.submitted_at is not null then
    raise exception 'already_submitted' using errcode = 'RV003';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'verification-docs' and o.name = v.document_path) then
    raise exception 'Dokument fehlt' using errcode = '23514', hint = '{"fields":["document"]}';
  end if;
  perform set_config('revier.verification', 'on', true);
  update public.verifications set submitted_at = now() where id = p_id;
  perform set_config('revier.verification', previous_flag, true);
end;
$$;

-- Ohne Legal-Gate und auch gesperrt: Zurückziehen ist Datensparsamkeit. Vor der Einreichung löscht der Client die
-- Datei vorher selbst (Delete-Policy), danach räumt sie der 24-h-Job ab.
create function public.withdraw_verification(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null or not exists (select 1 from public.profiles p where p.user_id = uid and p.deleted_at is null) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  delete from public.verifications v where v.id = p_id and v.user_id = uid and v.status = 'pending';
  if not found then
    raise exception 'Antrag nicht gefunden' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.begin_verification(public.document_type) from public, anon;
revoke execute on function public.submit_verification(uuid) from public, anon;
revoke execute on function public.withdraw_verification(uuid) from public, anon;
grant execute on function public.begin_verification(public.document_type) to authenticated;
grant execute on function public.submit_verification(uuid) to authenticated;
grant execute on function public.withdraw_verification(uuid) to authenticated;

-- RPCs für Admins ----------------------------------------------------------------------------------------------------
create function public.decide_verification(p_id uuid, p_decision text, p_code text default null, p_note text default null)
returns public.verification_request_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
  target public.verification_request_status;
  code text := p_code;
  note text := nullif(private.trim_all(coalesce(p_note, '')), '');
  previous_flag text := coalesce(current_setting('revier.verification', true), '');
begin
  if not private.is_admin() then
    raise exception 'Nur für Admins mit Zwei-Faktor' using errcode = '42501';
  end if;
  target := case p_decision when 'verify' then 'verified' when 'reject' then 'rejected' end::public.verification_request_status;
  if target is null then
    raise exception 'Unbekannte Entscheidung' using errcode = '22023';
  end if;
  select x.id, x.user_id, x.status into v
  from public.verifications x where x.id = p_id and x.submitted_at is not null for update;
  if not found then
    raise exception 'Antrag nicht gefunden' using errcode = 'P0002';
  end if;
  -- Selbstentscheidungsverbot (kein Vier-Augen-Prinzip, ADR 020).
  if v.user_id = (select auth.uid()) then
    raise exception 'Eigene Anträge entscheidet ein anderer Admin' using errcode = '42501';
  end if;
  if v.status <> 'pending' then
    raise exception 'already_decided' using errcode = 'RV003', hint = jsonb_build_object('status', v.status)::text;
  end if;
  if target = 'verified' then
    code := null;
    note := null;
  elsif code is null or code not in ('unreadable', 'expired', 'mismatch', 'wrong_document', 'other') then
    raise exception 'Grund fehlt' using errcode = '23514', hint = '{"fields":["reject_code"]}';
  elsif code = 'other' and note is null then
    raise exception 'Freitext fehlt' using errcode = '23514', hint = '{"fields":["reject_reason"]}';
  end if;

  perform set_config('revier.verification', 'on', true);
  update public.verifications set status = target, reject_code = code, reject_reason = note where id = p_id;
  perform set_config('revier.verification', previous_flag, true);
  insert into private.account_notifications (kind, user_id, ref_id)
  values (case target when 'verified' then 'verification_verified' else 'verification_rejected' end, v.user_id, v.id);
  return target;
end;
$$;

create function public.revoke_verification(p_user_id uuid, p_code text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ver_id uuid;
  note text := nullif(private.trim_all(coalesce(p_note, '')), '');
  previous_flag text := coalesce(current_setting('revier.verification', true), '');
begin
  if not private.is_admin() then
    raise exception 'Nur für Admins mit Zwei-Faktor' using errcode = '42501';
  end if;
  if p_user_id = (select auth.uid()) then
    raise exception 'Eigene Verifizierung widerruft ein anderer Admin' using errcode = '42501';
  end if;
  if p_code is null or p_code not in ('expired', 'mismatch', 'fraud', 'other') then
    raise exception 'Grund fehlt' using errcode = '23514', hint = '{"fields":["revoke_code"]}';
  elsif p_code = 'other' and note is null then
    raise exception 'Freitext fehlt' using errcode = '23514', hint = '{"fields":["revoke_reason"]}';
  end if;
  select v.id into ver_id from public.verifications v
  where v.user_id = p_user_id and v.status = 'verified' and v.revoked_at is null
  order by v.decided_at desc limit 1 for update;
  if not found then
    raise exception 'Keine Verifizierung' using errcode = 'P0002';
  end if;
  perform set_config('revier.verification', 'on', true);
  -- Alle offenen verifizierten Anträge des Kontos, damit das Badge sicher fällt.
  update public.verifications set revoked_at = now(), revoke_code = p_code, revoke_reason = note
  where user_id = p_user_id and status = 'verified' and revoked_at is null;
  perform set_config('revier.verification', previous_flag, true);
  insert into private.account_notifications (kind, user_id, ref_id) values ('verification_revoked', p_user_id, ver_id);
end;
$$;

create function public.admin_verification_queue(p_after_submitted timestamptz default null, p_after_id uuid default null,
                                                p_limit integer default 50)
returns table (id uuid, submitted_at timestamptz, document_type public.document_type, user_id uuid, display_name text,
               account_type public.account_type, country public.country_code, profile_status public.verification_status,
               previous_requests integer, is_own boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'Nur für Admins mit Zwei-Faktor' using errcode = '42501';
  end if;
  return query
    select v.id, v.submitted_at, v.document_type, v.user_id, p.display_name, p.account_type, p.country, p.verification_status,
           (select count(*)::integer from public.verifications o where o.user_id = v.user_id and o.status <> 'pending'),
           v.user_id = (select auth.uid())
    from public.verifications v
    join public.profiles p on p.user_id = v.user_id
    where v.status = 'pending' and v.submitted_at is not null and p.deleted_at is null
      and (p_after_submitted is null or (v.submitted_at, v.id) > (p_after_submitted, p_after_id))
    order by v.submitted_at, v.id
    limit greatest(1, least(coalesce(p_limit, 50), 100));
end;
$$;

-- Ein Antrag mit Konto und Verlauf, ohne Pfad und ohne Prüfer (den Pfad gibt nur admin_open_verification_document).
create function public.admin_verification(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not private.is_admin() then
    raise exception 'Nur für Admins mit Zwei-Faktor' using errcode = '42501';
  end if;
  select jsonb_build_object(
      'id', v.id, 'status', v.status, 'document_type', v.document_type, 'submitted_at', v.submitted_at,
      'decided_at', v.decided_at, 'reject_code', v.reject_code, 'reject_reason', v.reject_reason,
      'revoked_at', v.revoked_at, 'revoke_code', v.revoke_code, 'revoke_reason', v.revoke_reason,
      'document_present', v.document_path is not null, 'is_own', v.user_id = (select auth.uid()),
      'user', jsonb_build_object('id', p.user_id, 'display_name', p.display_name, 'account_type', p.account_type,
                                 'business_name', p.business_name, 'country', p.country,
                                 'verification_status', p.verification_status, 'is_blocked', p.is_blocked,
                                 'member_since', p.created_at),
      'history', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'status', o.status, 'document_type', o.document_type,
                                                               'decided_at', o.decided_at, 'reject_code', o.reject_code,
                                                               'revoked_at', o.revoked_at) order by o.created_at desc)
                           from public.verifications o
                           where o.user_id = v.user_id and o.id <> v.id and o.submitted_at is not null), '[]'::jsonb))
  into result
  from public.verifications v
  join public.profiles p on p.user_id = v.user_id
  where v.id = p_id and v.submitted_at is not null and p.deleted_at is null;
  if result is null then
    raise exception 'Antrag nicht gefunden' using errcode = 'P0002';
  end if;
  return result;
end;
$$;

-- Review B3: schreibt das Audit und liefert den Pfad; erst danach erlaubt die Storage-Policy das Signieren.
create function public.admin_open_verification_document(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
begin
  if not private.is_admin() then
    raise exception 'Nur für Admins mit Zwei-Faktor' using errcode = '42501';
  end if;
  select x.id, x.user_id, x.document_path into v
  from public.verifications x where x.id = p_id and x.submitted_at is not null and x.document_path is not null;
  if not found then
    raise exception 'Dokument nicht gefunden' using errcode = 'P0002';
  end if;
  if v.user_id = (select auth.uid()) then
    raise exception 'Eigene Dokumente prüft ein anderer Admin' using errcode = '42501';
  end if;
  perform private.write_audit('verification.document_viewed', 'verification', v.id);
  return v.document_path;
end;
$$;

revoke execute on function public.decide_verification(uuid, text, text, text) from public, anon;
revoke execute on function public.revoke_verification(uuid, text, text) from public, anon;
revoke execute on function public.admin_verification_queue(timestamptz, uuid, integer) from public, anon;
revoke execute on function public.admin_verification(uuid) from public, anon;
revoke execute on function public.admin_open_verification_document(uuid) from public, anon;
grant execute on function public.decide_verification(uuid, text, text, text) to authenticated;
grant execute on function public.revoke_verification(uuid, text, text) to authenticated;
grant execute on function public.admin_verification_queue(timestamptz, uuid, integer) to authenticated;
grant execute on function public.admin_verification(uuid) to authenticated;
grant execute on function public.admin_open_verification_document(uuid) to authenticated;

-- Storage-Policies verification-docs (Review A6, B3) ----------------------------------------------------------------
create function private.verification_upload_allowed(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.verifications v
    where v.document_path = p_name and v.user_id = (select auth.uid())
      and v.status = 'pending' and v.submitted_at is null
  ) and private.is_active_user((select auth.uid()));
$$;
revoke execute on function private.verification_upload_allowed(text) from public, anon;
grant execute on function private.verification_upload_allowed(text) to authenticated;

create function private.verification_document_viewed(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.verifications v
    join public.audit_log a on a.target_type = 'verification' and a.target_id = v.id
    where v.document_path = p_name
      and a.action = 'verification.document_viewed'
      and a.actor_id = (select auth.uid())
      and a.created_at > now() - interval '2 minutes'
  );
$$;
revoke execute on function private.verification_document_viewed(text) from public, anon;
grant execute on function private.verification_document_viewed(text) to authenticated;

drop policy verification_docs_insert_own on storage.objects;
create policy verification_docs_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'verification-docs' and (select private.verification_upload_allowed(name)));

create policy verification_docs_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'verification-docs' and (select private.verification_upload_allowed(name)));

drop policy verification_docs_select_admin on storage.objects;
create policy verification_docs_select_admin on storage.objects
  for select to authenticated
  using (bucket_id = 'verification-docs' and (select private.is_admin()) and (select private.verification_document_viewed(name)));

-- Audit und Moderations-Mails auch auf Server-Pfaden (Review A7, Lücke M8) -------------------------------------------
-- Ein Transaktions-Flag (revier.moderation, ab der Beschwerde auch revier.appeal) gilt wie ein Admin-JWT.
create function private.moderation_path()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_admin()
      or coalesce(current_setting('revier.moderation', true), '') = 'on'
      or coalesce(current_setting('revier.appeal', true), '') = 'on';
$$;
revoke execute on function private.moderation_path() from public, anon;
grant execute on function private.moderation_path() to authenticated;

create or replace function private.listings_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('active', 'rejected', 'removed') and new.status is distinct from old.status
     or (old.status = 'pending_review' and new.status = 'draft' and new.reject_code is not null) then
    if private.moderation_path() then
      perform private.write_audit('listing.' || new.status::text, 'listing', new.id,
        jsonb_build_object('from', old.status, 'code', new.reject_code, 'reason', new.reject_reason));
    end if;
  end if;
  return null;
end;
$$;

create or replace function private.listings_moderation_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  decision text;
begin
  if new.status is not distinct from old.status
     or not private.moderation_path() or new.owner_id is not distinct from (select auth.uid()) then
    return null;
  end if;
  decision := case
    when old.status = 'pending_review' and new.status = 'active' then 'approved'
    when old.status = 'pending_review' and new.status = 'draft' and new.reject_code is not null then 'changes_requested'
    when new.status = 'rejected' then 'rejected'
    when new.status = 'removed' then 'removed'
  end;
  if decision is null then
    return null;
  end if;
  insert into private.moderation_notifications (listing_id, owner_id, decision, reject_code, reason)
  values (new.id, new.owner_id, decision,
          case when decision <> 'approved' then new.reject_code end,
          case when decision <> 'approved' then new.reject_reason end);
  return null;
end;
$$;

-- Export version 3: Verifizierungen mit Einreichung, Code und Widerruf ------------------------------------------------
create or replace function public.export_my_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  recent integer;
  oldest timestamptz;
begin
  if uid is null or not exists (select 1 from public.profiles p where p.user_id = uid and p.deleted_at is null) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('data_export:' || uid::text, 0));
  select count(*), min(e.created_at) into recent, oldest
  from private.data_exports e where e.user_id = uid and e.created_at > now() - interval '24 hours';
  if recent >= private.setting_int('export_per_24h') then
    raise exception 'export_rate_limited' using errcode = 'RV002',
      hint = jsonb_build_object('retry_after', to_char((oldest + interval '24 hours') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                                'scope', 'data_export')::text;
  end if;
  insert into private.data_exports (user_id) values (uid);

  return jsonb_build_object(
    'format', 'revier-export',
    'version', 3,
    'generated_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'account', (select jsonb_build_object('email', u.email, 'created_at', u.created_at, 'last_sign_in_at', u.last_sign_in_at)
                from auth.users u where u.id = uid),
    'profile', (select jsonb_build_object('display_name', p.display_name, 'account_type', p.account_type, 'business_name', p.business_name,
                  'country', p.country, 'preferred_language', p.preferred_language, 'verification_status', p.verification_status,
                  'is_blocked', p.is_blocked, 'notify_chat_email', p.notify_chat_email, 'created_at', p.created_at)
                from public.profiles p where p.user_id = uid),
    'roles', coalesce((select jsonb_agg(jsonb_build_object('role', r.role, 'created_at', r.created_at) order by r.created_at)
                from private.user_roles r where r.user_id = uid), '[]'::jsonb),
    'legal_acceptances', coalesce((select jsonb_agg(jsonb_build_object('document', a.document, 'version', a.version, 'source', a.source,
                  'accepted_at', a.accepted_at) order by a.accepted_at)
                from public.legal_acceptances a where a.user_id = uid), '[]'::jsonb),
    'listings', coalesce((select jsonb_agg(jsonb_build_object(
                  'id', l.id, 'kind', l.kind, 'direction', l.direction, 'title', l.title, 'description', l.description,
                  'content_language', l.content_language, 'country', l.country,
                  'region_code', (select g.code from public.regions g where g.id = l.region_id),
                  'price_minor', l.price_minor, 'currency', l.currency, 'price_unit', l.price_unit, 'area_hectares', l.area_hectares,
                  'start_date', l.start_date, 'end_date', l.end_date, 'attributes', l.attributes, 'status', l.status,
                  'reject_code', l.reject_code, 'reject_reason', l.reject_reason, 'created_at', l.created_at,
                  'submitted_at', l.submitted_at, 'published_at', l.published_at, 'approved_at', l.approved_at, 'expires_at', l.expires_at,
                  'species', coalesce((select jsonb_agg(s.species_code order by s.species_code) from public.listing_species s where s.listing_id = l.id), '[]'::jsonb),
                  'place', (select jsonb_build_object('postal_code', pl.postal_code, 'place_name', pl.place_name)
                            from public.listing_places pl where pl.listing_id = l.id),
                  'photos', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'sort_order', f.sort_order, 'alt_text', f.alt_text,
                              'width', f.width, 'height', f.height, 'created_at', f.created_at) order by f.sort_order)
                            from public.listing_photos f where f.listing_id = l.id and f.processed_at is not null), '[]'::jsonb))
                  order by l.created_at)
                from public.listings l where l.owner_id = uid), '[]'::jsonb),
    'favorites', coalesce((select jsonb_agg(jsonb_build_object('listing_id', f.listing_id,
                  'title', (select l.title from public.listings l
                            where l.id = f.listing_id and private.listing_is_public(l.status, l.expires_at, l.owner_id)),
                  'created_at', f.created_at) order by f.created_at)
                from public.favorites f where f.user_id = uid), '[]'::jsonb),
    'saved_searches', coalesce((select jsonb_agg(jsonb_build_object('name', s.name, 'filters', s.filters, 'cadence', s.cadence,
                  'notify_email', s.notify_email, 'notify_push', s.notify_push, 'paused_at', s.paused_at, 'expires_at', s.expires_at,
                  'created_at', s.created_at,
                  'matches', coalesce((select jsonb_agg(jsonb_build_object('listing_id', m.listing_id, 'matched_at', m.matched_at,
                                'sent_at', case when m.outcome = 'sent' then m.done_at end) order by m.matched_at)
                              from private.saved_search_matches m where m.saved_search_id = s.id and m.user_id = uid), '[]'::jsonb))
                  order by s.created_at)
                from public.saved_searches s where s.user_id = uid), '[]'::jsonb),
    'conversations', coalesce((select jsonb_agg(jsonb_build_object(
                  'role', case when c.owner_id = uid then 'owner' else 'interested' end,
                  'listing_id', c.listing_id, 'listing_title', (select l.title from public.listings l where l.id = c.listing_id),
                  'counterpart', private.export_party_name(case when c.owner_id = uid then c.interested_id else c.owner_id end),
                  'created_at', c.created_at,
                  'messages', coalesce((select jsonb_agg(jsonb_build_object('from', case when m.sender_id = uid then 'me' else 'counterpart' end,
                                'body', m.body, 'created_at', m.created_at, 'read_at', m.read_at) order by m.created_at, m.id)
                              from public.messages m where m.conversation_id = c.id), '[]'::jsonb))
                  order by c.created_at)
                from public.conversations c where uid in (c.owner_id, c.interested_id)), '[]'::jsonb),
    'blocks', coalesce((select jsonb_agg(jsonb_build_object('display_name', private.export_party_name(b.blocked_id),
                  'created_at', b.created_at) order by b.created_at)
                from public.blocks b where b.blocker_id = uid), '[]'::jsonb),
    'reports', coalesce((select jsonb_agg(jsonb_build_object('target_type', r.target_type,
                  'target_label', case r.target_type
                    when 'listing' then (select l.title from public.listings l where l.id = r.target_id)
                    when 'profile' then private.export_party_name(r.target_id)
                  end,
                  'reason', r.reason, 'note', r.note, 'status', r.status, 'created_at', r.created_at, 'handled_at', r.handled_at)
                  order by r.created_at)
                from public.reports r where r.reporter_id = uid), '[]'::jsonb),
    'devices', coalesce((select jsonb_agg(jsonb_build_object('platform', d.platform, 'language', d.language, 'created_at', d.created_at)
                  order by d.created_at)
                from public.devices d where d.user_id = uid), '[]'::jsonb),
    'verifications', coalesce((select jsonb_agg(jsonb_build_object('document_type', v.document_type, 'status', v.status,
                  'created_at', v.created_at, 'submitted_at', v.submitted_at, 'decided_at', v.decided_at,
                  'reject_code', v.reject_code, 'reject_reason', v.reject_reason, 'revoked_at', v.revoked_at,
                  'revoke_code', v.revoke_code, 'revoke_reason', v.revoke_reason,
                  'document_present', v.document_path is not null) order by v.created_at)
                from public.verifications v where v.user_id = uid), '[]'::jsonb),
    'reviews', coalesce((select jsonb_agg(jsonb_build_object('direction', case when rv.author_id = uid then 'written' else 'received' end,
                  'counterpart', private.export_party_name(case when rv.author_id = uid then rv.target_id else rv.author_id end),
                  'rating', rv.rating, 'text', rv.text, 'created_at', rv.created_at) order by rv.created_at)
                from public.reviews rv where uid in (rv.author_id, rv.target_id)), '[]'::jsonb)
  );
end;
$$;
