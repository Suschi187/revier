-- M9b Commit 8 (ADR 020, Plan M9 4.4/4.5, Review A7, A8, A9): Meldungen mit Ergebnis, Maßnahmen, Sperre und
-- Verwarnung, Entscheidungen der Betroffenen (DSA Art. 17) und Beschwerden (Art. 20). Alle Fristen und Wortlaute
-- sind Platzhalter (SPEC 7.2).
-- - reports: outcome, decision_audit_id; höchstens eine offene Meldung je Meldendem und Ziel; Erledigen nur per
--   resolve_reports (Flag revier.report), Roh-UPDATE entfällt.
-- - moderate_listing kennt remove (aus active, paused, pending_review, expired) mit Version aus admin_report_target.
-- - Konto: admin_find_account, admin_set_account_blocked, admin_warn_account (aal2, nie das eigene Konto, nie ein
--   Konto mit Rolle).
-- - my_decisions, appeals mit submit_appeal und decide_appeal (nicht der ursprüngliche Admin, Ausweichregel);
--   reversed macht die Maßnahme rückgängig. Ohne Flag revier.appeal verlässt keine Anzeige removed, auch nicht
--   auf Server-Pfaden.
-- - Dienstmails account_blocked/unblocked/warned, report_resolved, appeal_decided; Export version 4.

-- Codes für Maßnahmen gegen Konten (Platzhalter, Labels im Web unter Moderation.accountCodes).
create function private.account_action_codes()
returns text[]
language sql
immutable
set search_path = ''
as $$ select array['scam', 'illegal', 'weapons', 'harassment', 'spam', 'other'] $$;

-- Meldungen ----------------------------------------------------------------------------------------------------------
alter table public.reports
  add column outcome text check (outcome in ('no_action', 'content_removed', 'point_removed', 'account_warned', 'account_blocked', 'target_gone')),
  add column decision_audit_id uuid references public.audit_log (id) on delete set null,
  -- Offene Meldungen haben kein Ergebnis; erledigte aus der Zeit vor M9b bleiben ohne outcome.
  add constraint reports_outcome_when_handled check (status = 'handled' or outcome is null);

create unique index reports_one_open_idx on public.reports (reporter_id, target_type, target_id)
  where status = 'open' and reporter_id is not null;
create index reports_open_target_idx on public.reports (created_at, target_type, target_id) where status = 'open';

drop policy reports_update_admin on public.reports;
revoke update on public.reports from authenticated;
grant select (outcome) on public.reports to authenticated;

create or replace function private.reports_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  via_rpc boolean := coalesce(current_setting('revier.report', true), '') = 'on';
  audit_id uuid;
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
    new.outcome := null;
    new.decision_audit_id := null;
    return new;
  end if;

  -- Server-Pfade (Jobs, Tests, SQL-Eingriffe) wie bei den übrigen Guards; Nutzer haben kein UPDATE-Recht.
  if private.is_server_caller() and not via_rpc then
    return new;
  end if;
  -- reporter_id und handled_by fallen nur per FK auf null (Kontolöschung), decision_audit_id per FK (Audit-Frist).
  if (new.target_type, new.target_id, new.reason, new.note, new.created_at)
     is distinct from (old.target_type, old.target_id, old.reason, old.note, old.created_at)
     or (new.reporter_id is distinct from old.reporter_id and new.reporter_id is not null) then
    raise exception 'Meldungen sind unveränderlich' using errcode = '42501';
  end if;
  if (new.status, new.outcome) is not distinct from (old.status, old.outcome) then
    return new;
  end if;
  -- Nur resolve_reports (open → handled) und decide_appeal (handled → open).
  if not via_rpc then
    raise exception 'Meldungen nur per resolve_reports erledigen' using errcode = '42501';
  end if;
  if new.status = 'handled' and old.status = 'open' then
    if new.outcome is null then
      raise exception 'Ergebnis fehlt' using errcode = '23514';
    end if;
    new.handled_by := (select auth.uid());
    new.handled_at := now();
    insert into public.audit_log (actor_id, action, target_type, target_id, details)
    values ((select auth.uid()), 'report.handled', 'report', new.id,
            jsonb_build_object('target_type', new.target_type, 'reason', new.reason, 'outcome', new.outcome,
                               'code', nullif(current_setting('revier.report_code', true), ''),
                               'note', nullif(current_setting('revier.report_note', true), '')))
    returning id into audit_id;
    new.decision_audit_id := audit_id;
  elsif new.status = 'open' and old.status = 'handled' then
    new.handled_by := null;
    new.handled_at := null;
    new.outcome := null;
    new.decision_audit_id := null;
    perform private.write_audit('report.reopened', 'report', new.id, jsonb_build_object('target_type', new.target_type));
  else
    raise exception 'Statuswechsel nicht erlaubt' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Anzeigen: remove, Version für den Meldungsfall, Rücknahme per Beschwerde ------------------------------------------
-- Version des Inhalts für Admins an fremden Anzeigen in jedem Status (Review A7). admin_listing_version bleibt auf
-- pending_review beschränkt (QA M4 F4); diese Version gibt es nur über admin_report_target.
create function private.listing_moderation_version(p_listing_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when private.is_admin()
         and exists (select 1 from public.listings l where l.id = p_listing_id and l.owner_id is distinct from (select auth.uid()))
    then encode(private.listing_content_hash(p_listing_id), 'hex')
  end;
$$;
revoke execute on function private.listing_moderation_version(uuid) from public, anon, authenticated;

create or replace function public.moderate_listing(p_listing_id uuid, p_decision text, p_expected_version text, p_code text default null, p_note text default null)
returns public.listing_status
language plpgsql
set search_path = ''
as $$
declare
  listing record;
  target public.listing_status;
  code text := p_code;
  note text := nullif(private.trim_all(coalesce(p_note, '')), '');
  previous_flag text := coalesce(current_setting('revier.moderation', true), '');
begin
  if not private.is_admin() then
    raise exception 'Nur für Admins mit Zwei-Faktor' using errcode = '42501';
  end if;
  target := case p_decision
    when 'approve' then 'active'
    when 'request_changes' then 'draft'
    when 'reject' then 'rejected'
    when 'remove' then 'removed'
  end::public.listing_status;
  if target is null then
    raise exception 'Unbekannte Entscheidung' using errcode = '22023';
  end if;

  -- Zeile sperren: Besitzer-Änderungen und eine zweite Entscheidung warten oder sehen den neuen Stand.
  select l.id, l.owner_id, l.status into listing from public.listings l where l.id = p_listing_id for update;
  if not found then
    raise exception 'Anzeige nicht gefunden' using errcode = 'P0002';
  end if;
  if listing.owner_id = (select auth.uid()) then
    raise exception 'Eigene Anzeigen moderiert ein anderer Admin' using errcode = '42501';
  end if;
  if target = 'removed' then
    if listing.status not in ('active', 'paused', 'pending_review', 'expired') then
      raise exception 'already_decided' using errcode = 'RV003', hint = jsonb_build_object('status', listing.status)::text;
    end if;
    if p_expected_version is null or p_expected_version is distinct from private.listing_moderation_version(p_listing_id) then
      raise exception 'listing_changed' using errcode = 'RV004';
    end if;
    if note is null then
      raise exception 'Begründung fehlt' using errcode = '23514', hint = '{"fields":["reject_reason"]}';
    end if;
  else
    if listing.status <> 'pending_review' then
      raise exception 'already_decided' using errcode = 'RV003', hint = jsonb_build_object('status', listing.status)::text;
    end if;
    if p_expected_version is null or p_expected_version is distinct from private.listing_review_version(p_listing_id) then
      raise exception 'listing_changed' using errcode = 'RV004';
    end if;
  end if;

  if target = 'active' then
    code := null;
    note := null;
  elsif code is null then
    raise exception 'Grund fehlt' using errcode = '23514', hint = '{"fields":["reject_code"]}';
  elsif code = 'other' and note is null then
    raise exception 'Freitext fehlt' using errcode = '23514', hint = '{"fields":["reject_reason"]}';
  end if;

  perform set_config('revier.moderation', 'on', true);
  update public.listings set status = target, reject_code = code, reject_reason = note where id = p_listing_id;
  perform set_config('revier.moderation', previous_flag, true);
  return target;
end;
$$;

-- Ohne Flag revier.appeal verlässt keine Anzeige removed, auch nicht auf Server-Pfaden (Review A7). Mit dem Flag
-- nur removed/rejected → pending_review; die Einreichungszeit bleibt (vorne in der Warteschlange).
create function private.listings_appeal_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  appeal boolean := coalesce(current_setting('revier.appeal', true), '') = 'on';
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if appeal then
    if old.status not in ('removed', 'rejected', 'draft') or new.status <> 'pending_review' then
      raise exception 'Rücknahme nur nach pending_review' using errcode = '42501';
    end if;
    new.reject_code := null;
    new.reject_reason := null;
    return new;
  end if;
  if old.status = 'removed' then
    raise exception 'Entfernte Anzeigen verlassen removed nur nach einer Beschwerde' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function private.listings_appeal_guard() from public, anon, authenticated;
create trigger listings_appeal_guard before update of status on public.listings
  for each row execute function private.listings_appeal_guard();

create or replace function private.listings_moderation_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'pending_review' and (tg_op = 'INSERT' or old.status is distinct from 'pending_review') then
    -- Rücknahme nach einer Beschwerde: alte Einreichungszeit, damit die Anzeige vorne steht (ADR 020).
    new.submitted_at := case when coalesce(current_setting('revier.appeal', true), '') = 'on' and tg_op = 'UPDATE'
                             then coalesce(old.submitted_at, now()) else now() end;
  elsif tg_op = 'UPDATE' then
    new.submitted_at := old.submitted_at;
  else
    new.submitted_at := null;
  end if;
  if new.status not in ('draft', 'rejected', 'removed') then
    new.reject_code := null;
    new.reject_reason := null;
  end if;
  return new;
end;
$$;

-- Konto: suchen, sperren, verwarnen (ADR 020) -----------------------------------------------------------------------
create function private.check_account_action(p_user_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'Nur für Admins mit Zwei-Faktor' using errcode = '42501';
  end if;
  if p_user_id = (select auth.uid()) then
    raise exception 'Nicht das eigene Konto' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles p where p.user_id = p_user_id and p.deleted_at is null) then
    raise exception 'Konto nicht gefunden' using errcode = 'P0002';
  end if;
  if exists (select 1 from private.user_roles r where r.user_id = p_user_id) then
    raise exception 'Konto mit Rolle: erst die Rolle entziehen' using errcode = '42501', hint = '{"reason":"admin_role"}';
  end if;
end;
$$;
revoke execute on function private.check_account_action(uuid) from public, anon, authenticated;

create function private.check_action_code(p_code text, p_note text, p_required boolean)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_code is null and p_required or p_code is not null and not (p_code = any (private.account_action_codes())) then
    raise exception 'Grund fehlt' using errcode = '23514', hint = '{"fields":["code"]}';
  end if;
  if p_code = 'other' and p_note is null then
    raise exception 'Freitext fehlt' using errcode = '23514', hint = '{"fields":["note"]}';
  end if;
  if p_note is not null and char_length(p_note) > 1000 then
    raise exception 'Freitext zu lang' using errcode = '23514', hint = '{"fields":["note"]}';
  end if;
end;
$$;
revoke execute on function private.check_action_code(text, text, boolean) from public, anon, authenticated;

create function public.admin_find_account(p_query text)
returns table (user_id uuid, display_name text, account_type public.account_type, country public.country_code,
               is_blocked boolean, verification_status public.verification_status, member_since timestamptz,
               has_role boolean, listing_count integer, open_reports integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  q text := btrim(coalesce(p_query, ''));
  found_id uuid;
begin
  if not private.is_admin() then
    raise exception 'Nur für Admins mit Zwei-Faktor' using errcode = '42501';
  end if;
  -- Gemeinsames Limit mit admin_find_user (Review A9).
  perform pg_advisory_xact_lock(hashtext('admin_lookups:' || actor::text));
  if (select count(*) from private.admin_lookups l where l.actor_id = actor and l.created_at > now() - interval '1 hour')
     >= private.setting_int('admin_lookup_limit_per_hour') then
    raise exception 'Zu viele Suchen' using errcode = '54000';
  end if;
  insert into private.admin_lookups (actor_id) values (actor);

  if q ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    found_id := q::uuid;
  else
    select u.id into found_id from auth.users u where lower(u.email) = lower(q);
  end if;
  if found_id is null or found_id = actor
     or not exists (select 1 from public.profiles p where p.user_id = found_id and p.deleted_at is null) then
    return;
  end if;
  -- Nie die gesuchte Adresse im Audit (Review A9).
  perform private.write_audit('user.looked_up', 'profile', found_id);
  return query
    select p.user_id, p.display_name, p.account_type, p.country, p.is_blocked, p.verification_status, p.created_at,
           exists (select 1 from private.user_roles r where r.user_id = p.user_id),
           (select count(*)::integer from public.listings l where l.owner_id = p.user_id and l.status not in ('draft', 'removed')),
           (select count(*)::integer from public.reports r
            where r.status = 'open' and ((r.target_type = 'profile' and r.target_id = p.user_id)
               or (r.target_type = 'listing' and r.target_id in (select l.id from public.listings l where l.owner_id = p.user_id))))
    from public.profiles p where p.user_id = found_id;
end;
$$;

-- Schreibt das Audit selbst (mit Code und Begründung) und gibt dessen ID zurück; profiles_audit schweigt dann.
create function private.set_account_blocked(p_user_id uuid, p_blocked boolean, p_code text, p_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  audit_id uuid;
  previous_flag text := coalesce(current_setting('revier.account_block', true), '');
begin
  if (select p.is_blocked from public.profiles p where p.user_id = p_user_id) is not distinct from p_blocked then
    raise exception 'already_set' using errcode = 'RV003';
  end if;
  perform set_config('revier.account_block', 'on', true);
  update public.profiles set is_blocked = p_blocked where user_id = p_user_id;
  perform set_config('revier.account_block', previous_flag, true);
  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values ((select auth.uid()), case when p_blocked then 'profile.blocked' else 'profile.unblocked' end, 'profile', p_user_id,
          jsonb_build_object('user_id', p_user_id, 'code', p_code, 'reason', p_note))
  returning id into audit_id;
  insert into private.account_notifications (kind, user_id, ref_id)
  values (case when p_blocked then 'account_blocked' else 'account_unblocked' end, p_user_id, audit_id);
  return audit_id;
end;
$$;
revoke execute on function private.set_account_blocked(uuid, boolean, text, text) from public, anon, authenticated;

create or replace function private.profiles_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Über admin_set_account_blocked schreibt die RPC das Audit mit Code und Begründung.
  if coalesce(current_setting('revier.account_block', true), '') = 'on' then
    return null;
  end if;
  perform private.write_audit(case when new.is_blocked then 'profile.blocked' else 'profile.unblocked' end,
    'profile', new.user_id);
  return null;
end;
$$;

create function private.warn_account(p_user_id uuid, p_code text, p_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  audit_id uuid;
begin
  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values ((select auth.uid()), 'profile.warned', 'profile', p_user_id, jsonb_build_object('user_id', p_user_id, 'code', p_code, 'reason', p_note))
  returning id into audit_id;
  insert into private.account_notifications (kind, user_id, ref_id) values ('account_warned', p_user_id, audit_id);
  return audit_id;
end;
$$;
revoke execute on function private.warn_account(uuid, text, text) from public, anon, authenticated;

create function public.admin_set_account_blocked(p_user_id uuid, p_blocked boolean, p_code text default null, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  note text := nullif(private.trim_all(coalesce(p_note, '')), '');
begin
  perform private.check_account_action(p_user_id);
  perform private.check_action_code(p_code, note, coalesce(p_blocked, false));
  if p_blocked is null then
    raise exception 'Sperre fehlt' using errcode = '22023';
  end if;
  return private.set_account_blocked(p_user_id, p_blocked, p_code, note);
end;
$$;

create function public.admin_warn_account(p_user_id uuid, p_code text, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  note text := nullif(private.trim_all(coalesce(p_note, '')), '');
begin
  perform private.check_account_action(p_user_id);
  perform private.check_action_code(p_code, note, true);
  return private.warn_account(p_user_id, p_code, note);
end;
$$;

-- Warteschlange der Meldungen (ADR 020) -----------------------------------------------------------------------------
-- Kurzbeschreibung eines Ziels für Admins, ohne Nachrichtentext (der nur per admin_report_message).
create function private.report_target_label(p_target_type public.report_target, p_target_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case p_target_type
    when 'listing' then (select l.title from public.listings l where l.id = p_target_id)
    when 'profile' then (select p.display_name from public.profiles p where p.user_id = p_target_id and p.deleted_at is null)
    when 'message' then (select p.display_name from private.reported_message_snapshots s
                         join public.reports r on r.id = s.report_id
                         join public.profiles p on p.user_id = s.sender_id
                         where s.message_id = p_target_id limit 1)
  end;
$$;
revoke execute on function private.report_target_label(public.report_target, uuid) from public, anon, authenticated;

create function public.admin_report_queue(p_after_oldest timestamptz default null, p_after_type public.report_target default null,
                                          p_after_id uuid default null, p_limit integer default 25)
returns table (target_type public.report_target, target_id uuid, report_count integer, reasons public.report_reason[],
               oldest timestamptz, label text, target_gone boolean)
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
    with g as (
      select r.target_type, r.target_id, count(*)::integer as n, array_agg(distinct r.reason order by r.reason) as reasons,
             min(r.created_at) as oldest
      from public.reports r where r.status = 'open'
      group by r.target_type, r.target_id
    )
    select g.target_type, g.target_id, g.n, g.reasons, g.oldest, private.report_target_label(g.target_type, g.target_id),
           private.report_target_gone(g.target_type, g.target_id)
    from g
    where p_after_oldest is null or (g.oldest, g.target_type::text, g.target_id) > (p_after_oldest, p_after_type::text, p_after_id)
    order by g.oldest, g.target_type::text, g.target_id
    limit greatest(1, least(coalesce(p_limit, 25), 100));
end;
$$;

create function private.report_target_gone(p_target_type public.report_target, p_target_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not case p_target_type
    when 'listing' then exists (select 1 from public.listings l where l.id = p_target_id)
    when 'profile' then exists (select 1 from public.profiles p where p.user_id = p_target_id and p.deleted_at is null)
    when 'message' then exists (select 1 from public.messages m where m.id = p_target_id)
  end;
$$;
revoke execute on function private.report_target_gone(public.report_target, uuid) from public, anon, authenticated;

-- Betroffenes Konto eines Ziels (Besitzer, Profil, Absender laut Kopie).
create function private.report_target_account(p_target_type public.report_target, p_target_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case p_target_type
    when 'listing' then (select l.owner_id from public.listings l where l.id = p_target_id)
    when 'profile' then p_target_id
    when 'message' then (select s.sender_id from private.reported_message_snapshots s where s.message_id = p_target_id limit 1)
  end;
$$;
revoke execute on function private.report_target_account(public.report_target, uuid) from public, anon, authenticated;

create function public.admin_report_target(p_target_type public.report_target, p_target_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  account uuid;
  result jsonb;
begin
  if not private.is_admin() then
    raise exception 'Nur für Admins mit Zwei-Faktor' using errcode = '42501';
  end if;
  if not exists (select 1 from public.reports r where r.target_type = p_target_type and r.target_id = p_target_id) then
    raise exception 'Ziel nicht gefunden' using errcode = 'P0002';
  end if;
  account := private.report_target_account(p_target_type, p_target_id);
  select jsonb_build_object(
    'target_type', p_target_type,
    'target_id', p_target_id,
    'label', private.report_target_label(p_target_type, p_target_id),
    'gone', private.report_target_gone(p_target_type, p_target_id),
    'listing', (select jsonb_build_object('id', l.id, 'title', l.title, 'status', l.status, 'has_point', l.display_location is not null,
                                          'version', private.listing_moderation_version(l.id), 'is_public', private.listing_is_public(l.status, l.expires_at, l.owner_id))
                from public.listings l where p_target_type = 'listing' and l.id = p_target_id),
    'account', (select jsonb_build_object('id', p.user_id, 'display_name', p.display_name, 'account_type', p.account_type,
                                          'country', p.country, 'is_blocked', p.is_blocked, 'verification_status', p.verification_status,
                                          'member_since', p.created_at, 'is_own', p.user_id = (select auth.uid()),
                                          'has_role', exists (select 1 from private.user_roles x where x.user_id = p.user_id),
                                          'listing_count', (select count(*)::integer from public.listings l
                                                            where l.owner_id = p.user_id and l.status not in ('draft', 'removed')))
                from public.profiles p where p.user_id = account and p.deleted_at is null),
    'open', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'reason', r.reason, 'note', r.note, 'created_at', r.created_at)
                                       order by r.created_at)
                      from public.reports r where r.target_type = p_target_type and r.target_id = p_target_id and r.status = 'open'), '[]'::jsonb),
    'handled_count', (select count(*)::integer from public.reports r
                      where r.target_type = p_target_type and r.target_id = p_target_id and r.status = 'handled'))
  into result;
  return result;
end;
$$;

-- Gesicherte Kopie einer gemeldeten Nachricht, nur hinter einem Klick und mit Audit (ADR 017).
create function public.admin_report_message(p_report_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not private.is_admin() then
    raise exception 'Nur für Admins mit Zwei-Faktor' using errcode = '42501';
  end if;
  select jsonb_build_object('body', s.body, 'message_created_at', s.message_created_at, 'captured_at', s.captured_at,
                            'sender', private.export_party_name(s.sender_id))
  into result
  from private.reported_message_snapshots s where s.report_id = p_report_id;
  if result is null then
    raise exception 'Kopie nicht gefunden' using errcode = 'P0002';
  end if;
  perform private.write_audit('report.message_viewed', 'report', p_report_id);
  return result;
end;
$$;

create function public.resolve_reports(p_target_type public.report_target, p_target_id uuid, p_outcome text,
                                       p_code text default null, p_note text default null, p_expected_version text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outcome text := p_outcome;
  note text := nullif(private.trim_all(coalesce(p_note, '')), '');
  account uuid;
  open_ids uuid[];
  r record;
  previous_flag text := coalesce(current_setting('revier.report', true), '');
begin
  if not private.is_admin() then
    raise exception 'Nur für Admins mit Zwei-Faktor' using errcode = '42501';
  end if;
  if v_outcome is null or v_outcome not in ('no_action', 'content_removed', 'point_removed', 'account_warned', 'account_blocked') then
    raise exception 'Unbekanntes Ergebnis' using errcode = '22023';
  end if;
  if not exists (select 1 from public.reports x where x.target_type = p_target_type and x.target_id = p_target_id) then
    raise exception 'Ziel nicht gefunden' using errcode = 'P0002';
  end if;
  select array_agg(x.id order by x.created_at) into open_ids
  from (select x.id, x.created_at from public.reports x
        where x.target_type = p_target_type and x.target_id = p_target_id and x.status = 'open' for update) x;
  if open_ids is null then
    raise exception 'already_handled' using errcode = 'RV003';
  end if;
  if v_outcome in ('content_removed', 'point_removed') and p_target_type <> 'listing' then
    raise exception 'Maßnahme passt nicht zum Ziel' using errcode = '22023';
  end if;

  if private.report_target_gone(p_target_type, p_target_id) and v_outcome <> 'no_action' then
    v_outcome := 'target_gone';
  else
    account := private.report_target_account(p_target_type, p_target_id);
    if v_outcome in ('account_warned', 'account_blocked') then
      perform private.check_account_action(account);
      perform private.check_action_code(p_code, note, true);
    elsif account = (select auth.uid()) then
      raise exception 'Meldungen zum eigenen Konto entscheidet ein anderer Admin' using errcode = '42501';
    end if;
    case v_outcome
      when 'content_removed' then
        perform public.moderate_listing(p_target_id, 'remove', p_expected_version, p_code, note);
      when 'point_removed' then
        if not exists (select 1 from public.listings l where l.id = p_target_id and l.display_location is not null) then
          raise exception 'Kein Kartenpunkt' using errcode = 'RV003';
        end if;
        update public.listings set display_location = null where id = p_target_id;
      when 'account_warned' then
        perform private.warn_account(account, p_code, note);
      when 'account_blocked' then
        -- Schon gesperrt: Ergebnis bleibt, keine zweite Sperre und keine zweite Mail.
        if not (select p.is_blocked from public.profiles p where p.user_id = account) then
          perform private.set_account_blocked(account, true, p_code, note);
        end if;
      else
        null;
    end case;
  end if;

  perform set_config('revier.report', 'on', true);
  perform set_config('revier.report_code', coalesce(p_code, ''), true);
  perform set_config('revier.report_note', coalesce(note, ''), true);
  update public.reports set status = 'handled', outcome = v_outcome where id = any (open_ids);
  perform set_config('revier.report', previous_flag, true);
  perform set_config('revier.report_code', '', true);
  perform set_config('revier.report_note', '', true);

  -- Meldende erfahren nur das Ergebnis (Art. 16 Abs. 5).
  for r in select x.id, x.reporter_id from public.reports x where x.id = any (open_ids) and x.reporter_id is not null loop
    insert into private.account_notifications (kind, user_id, ref_id) values ('report_resolved', r.reporter_id, r.id)
    on conflict do nothing;
  end loop;
  return v_outcome;
end;
$$;

-- Entscheidungen und Beschwerden (DSA Art. 17, 20) ------------------------------------------------------------------
create table public.appeals (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  decision_audit_id uuid unique references public.audit_log (id) on delete set null,
  decision_action text not null,
  text text not null check (char_length(btrim(text)) between 10 and 2000),
  status text not null default 'open' check (status in ('open', 'upheld', 'reversed')),
  decided_at timestamptz,
  decided_by uuid references public.profiles (user_id) on delete set null,
  decision_note text check (decision_note is null or char_length(btrim(decision_note)) between 1 and 1000),
  same_reviewer boolean not null default false,
  check ((status = 'open') = (decided_at is null)),
  check (status = 'open' or decision_note is not null)
);
create index appeals_open_idx on public.appeals (created_at, id) where status = 'open';
create index appeals_user_idx on public.appeals (user_id, created_at);
alter table public.appeals enable row level security;
revoke all on public.appeals from public, anon, authenticated;
grant select (id, created_at, decision_audit_id, decision_action, text, status, decided_at, decision_note) on public.appeals to authenticated;
create policy appeals_select_own on public.appeals for select to authenticated using (user_id = (select auth.uid()));
create policy appeals_select_admin on public.appeals for select to authenticated using ((select private.is_admin()));

insert into private.app_settings (key, value, description) values
  ('appeal_keep_months', '24', 'Beschwerden so viele Monate nach der Entscheidung aufbewahren (ADR 020, Platzhalter)');

-- Entscheidungen, die ein Konto betreffen (als Betroffener oder als Meldender), ohne Admin-Identität.
create function private.decisions_for(p_user_id uuid)
returns table (id uuid, action text, created_at timestamptz, code text, reason text, target_type text, target_id uuid,
               target_label text, outcome text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.action, a.created_at, a.details ->> 'code', a.details ->> 'reason', a.target_type, a.target_id, l.title, null::text
  from public.audit_log a join public.listings l on l.id = a.target_id
  where a.target_type = 'listing' and l.owner_id = p_user_id
    and a.action in ('listing.rejected', 'listing.draft', 'listing.removed', 'listing.point_removed')
  union all
  select a.id, a.action, a.created_at, a.details ->> 'code', a.details ->> 'reason', a.target_type, a.target_id, null, null
  from public.audit_log a
  where a.target_type = 'profile' and a.target_id = p_user_id and a.action in ('profile.blocked', 'profile.warned')
  union all
  select a.id, a.action, a.created_at,
         case a.action when 'verification.rejected' then v.reject_code else v.revoke_code end,
         case a.action when 'verification.rejected' then v.reject_reason else v.revoke_reason end,
         a.target_type, a.target_id, v.document_type::text, null
  from public.audit_log a join public.verifications v on v.id = a.target_id
  where a.target_type = 'verification' and v.user_id = p_user_id and a.action in ('verification.rejected', 'verification.revoked')
  union all
  select a.id, a.action, a.created_at, null, null, r.target_type::text, r.target_id,
         private.report_target_label(r.target_type, r.target_id), a.details ->> 'outcome'
  from public.audit_log a join public.reports r on r.id = a.target_id
  where a.target_type = 'report' and a.action = 'report.handled' and r.reporter_id = p_user_id;
$$;
revoke execute on function private.decisions_for(uuid) from public, anon, authenticated;

create function public.my_decisions()
returns table (id uuid, action text, created_at timestamptz, code text, reason text, target_type text, target_id uuid,
               target_label text, outcome text, appeal_until timestamptz, appealable boolean, appeal_id uuid, appeal_status text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  window_days integer := private.setting_int('appeal_window_days');
begin
  if uid is null or not exists (select 1 from public.profiles p where p.user_id = uid and p.deleted_at is null) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return query
    select d.id, d.action, d.created_at, d.code, d.reason, d.target_type, d.target_id,
           -- Meldende sehen über ein Profil oder eine Nachricht nur den Zieltyp, keinen Namen (Art. 16 Abs. 5).
           case when d.action = 'report.handled' and d.target_type <> 'listing' then null else d.target_label end,
           d.outcome, d.created_at + make_interval(days => window_days),
           ap.id is null and d.created_at + make_interval(days => window_days) > now(), ap.id, ap.status
    from private.decisions_for(uid) d
    left join public.appeals ap on ap.decision_audit_id = d.id
    where d.created_at > now() - make_interval(days => window_days)
    order by d.created_at desc, d.id;
end;
$$;

-- Ohne Legal-Gate, auch für gesperrte Konten (Art. 20 gilt gerade dann).
create function public.submit_appeal(p_decision_id uuid, p_text text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  d record;
  body text := private.trim_all(coalesce(p_text, ''));
  new_id uuid;
begin
  if uid is null or not exists (select 1 from public.profiles p where p.user_id = uid and p.deleted_at is null) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  select x.id, x.action into d from public.my_decisions() x where x.id = p_decision_id and x.appeal_until > now();
  if not found then
    raise exception 'Entscheidung nicht gefunden' using errcode = 'P0002';
  end if;
  if char_length(body) < 10 or char_length(body) > 2000 then
    raise exception 'Text 10 bis 2000 Zeichen' using errcode = '23514', hint = '{"fields":["text"]}';
  end if;
  insert into public.appeals (user_id, decision_audit_id, decision_action, text) values (uid, d.id, d.action, body)
  returning id into new_id;
  return new_id;
end;
$$;

create function public.admin_appeal_queue(p_after_created timestamptz default null, p_after_id uuid default null, p_limit integer default 25)
returns table (id uuid, created_at timestamptz, decision_action text, display_name text, same_reviewer_only boolean)
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
    select ap.id, ap.created_at, ap.decision_action, p.display_name,
           coalesce((select a.actor_id from public.audit_log a where a.id = ap.decision_audit_id) = (select auth.uid()), false)
    from public.appeals ap join public.profiles p on p.user_id = ap.user_id
    where ap.status = 'open' and ap.user_id <> (select auth.uid())
      and (p_after_created is null or (ap.created_at, ap.id) > (p_after_created, p_after_id))
    order by ap.created_at, ap.id
    limit greatest(1, least(coalesce(p_limit, 25), 100));
end;
$$;

create function public.admin_appeal(p_id uuid)
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
      'id', ap.id, 'created_at', ap.created_at, 'status', ap.status, 'text', ap.text, 'decided_at', ap.decided_at,
      'decision_note', ap.decision_note, 'same_reviewer', ap.same_reviewer, 'is_own', ap.user_id = (select auth.uid()),
      'user', jsonb_build_object('id', p.user_id, 'display_name', p.display_name, 'is_blocked', p.is_blocked),
      'decision', (select jsonb_build_object('id', d.id, 'action', d.action, 'created_at', d.created_at, 'code', d.code,
                                             'reason', d.reason, 'target_type', d.target_type, 'target_id', d.target_id,
                                             'target_label', d.target_label, 'outcome', d.outcome,
                                             'by_me', (select a.actor_id from public.audit_log a where a.id = d.id) = (select auth.uid()))
                   from private.decisions_for(ap.user_id) d where d.id = ap.decision_audit_id),
      'decision_action', ap.decision_action)
  into result
  from public.appeals ap join public.profiles p on p.user_id = ap.user_id
  where ap.id = p_id;
  if result is null then
    raise exception 'Beschwerde nicht gefunden' using errcode = 'P0002';
  end if;
  return result;
end;
$$;

-- Gibt es außer mir einen anderen aktiven Admin mit bestätigtem TOTP-Faktor? (Ausweichregel, Review A8)
create function private.other_admin_available()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.user_roles r
    join auth.mfa_factors f on f.user_id = r.user_id and f.factor_type = 'totp' and f.status = 'verified'
    where r.role = 'admin' and r.user_id <> (select auth.uid()) and private.is_active_user(r.user_id)
  );
$$;
revoke execute on function private.other_admin_available() from public, anon, authenticated;

create function public.decide_appeal(p_appeal_id uuid, p_outcome text, p_note text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  ap record;
  d record;
  original_actor uuid;
  same boolean := false;
  note text := nullif(private.trim_all(coalesce(p_note, '')), '');
  previous_appeal text := coalesce(current_setting('revier.appeal', true), '');
  previous_report text := coalesce(current_setting('revier.report', true), '');
  credit uuid;
begin
  if not private.is_admin() then
    raise exception 'Nur für Admins mit Zwei-Faktor' using errcode = '42501';
  end if;
  if p_outcome is null or p_outcome not in ('upheld', 'reversed') then
    raise exception 'Unbekanntes Ergebnis' using errcode = '22023';
  end if;
  if note is null or char_length(note) > 1000 then
    raise exception 'Begründung fehlt' using errcode = '23514', hint = '{"fields":["note"]}';
  end if;
  select x.* into ap from public.appeals x where x.id = p_appeal_id for update;
  if not found then
    raise exception 'Beschwerde nicht gefunden' using errcode = 'P0002';
  end if;
  if ap.user_id = (select auth.uid()) then
    raise exception 'Eigene Beschwerden entscheidet ein anderer Admin' using errcode = '42501';
  end if;
  if ap.status <> 'open' then
    raise exception 'already_decided' using errcode = 'RV003';
  end if;
  select a.actor_id into original_actor from public.audit_log a where a.id = ap.decision_audit_id;
  if original_actor = (select auth.uid()) then
    if private.other_admin_available() then
      raise exception 'Nicht der Admin der ursprünglichen Entscheidung' using errcode = '42501', hint = '{"reason":"same_reviewer"}';
    end if;
    same := true;
  end if;

  if p_outcome = 'reversed' then
    select x.* into d from private.decisions_for(ap.user_id) x where x.id = ap.decision_audit_id;
    if found then
      perform set_config('revier.appeal', 'on', true);
      case
        when d.action in ('listing.rejected', 'listing.removed', 'listing.draft') then
          update public.listings set status = 'pending_review'
          where id = d.target_id and status = case d.action when 'listing.rejected' then 'rejected'::public.listing_status
                                                             when 'listing.removed' then 'removed'::public.listing_status
                                                             else 'draft'::public.listing_status end;
        when d.action = 'profile.blocked' then
          if (select p.is_blocked from public.profiles p where p.user_id = ap.user_id) then
            perform private.set_account_blocked(ap.user_id, false, null, note);
          end if;
        when d.action in ('verification.rejected', 'verification.revoked') then
          -- Neuer Antrag ohne Anrechnung auf das Limit (H11): ein Versuch im Zeitraum fällt weg.
          select v.id into credit from private.verification_attempts v
          where v.user_id = ap.user_id and v.created_at > now() - interval '30 days' order by v.created_at limit 1;
          delete from private.verification_attempts where id = credit;
        when d.action = 'report.handled' then
          perform set_config('revier.report', 'on', true);
          -- Wieder offen und vorne (älteste Meldung zuerst); nicht, wenn derselbe Meldende inzwischen neu gemeldet hat.
          update public.reports r set status = 'open'
          where r.target_type = d.target_type::public.report_target and r.target_id = d.target_id and r.status = 'handled'
            and not exists (select 1 from public.reports o where o.status = 'open' and o.reporter_id = r.reporter_id
                            and o.target_type = r.target_type and o.target_id = r.target_id);
          perform set_config('revier.report', previous_report, true);
        else
          -- listing.point_removed, profile.warned: nichts rückgängig zu machen (der Besitzer setzt den Punkt neu).
          null;
      end case;
      perform set_config('revier.appeal', previous_appeal, true);
    end if;
  end if;

  update public.appeals set status = p_outcome, decided_at = now(), decided_by = (select auth.uid()),
                            decision_note = note, same_reviewer = same
  where id = p_appeal_id;
  perform private.write_audit('appeal.' || p_outcome, 'appeal', p_appeal_id,
    jsonb_build_object('user_id', ap.user_id, 'decision_action', ap.decision_action, 'same_reviewer', same));
  insert into private.account_notifications (kind, user_id, ref_id) values ('appeal_decided', ap.user_id, p_appeal_id);
  return p_outcome;
end;
$$;

-- Dienstmails: Details je Art aus dem Fachdatensatz (Allowlist) -----------------------------------------------------
create or replace function private.account_notification_details(p_kind text, p_ref_id uuid, p_user_id uuid, p_payload jsonb)
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
        'decided_at', d.at,
        'appeal_until', case when p_kind <> 'verification_verified'
                             then d.at + make_interval(days => private.setting_int('appeal_window_days')) end)
      from public.verifications v
      cross join lateral (select case p_kind when 'verification_revoked' then v.revoked_at else v.decided_at end as at) d
      where v.id = p_ref_id and v.user_id = p_user_id
        and case p_kind
              when 'verification_verified' then v.status = 'verified'
              when 'verification_rejected' then v.status = 'rejected'
              else v.revoked_at is not null
            end)
    when p_kind in ('account_blocked', 'account_unblocked', 'account_warned') then (
      select jsonb_build_object(
        'code', a.details ->> 'code', 'reason', a.details ->> 'reason', 'decided_at', a.created_at,
        'appeal_until', case when p_kind <> 'account_unblocked'
                             then a.created_at + make_interval(days => private.setting_int('appeal_window_days')) end)
      from public.audit_log a
      where a.id = p_ref_id and a.target_type = 'profile' and a.target_id = p_user_id
        and a.action = case p_kind when 'account_blocked' then 'profile.blocked' when 'account_unblocked' then 'profile.unblocked'
                                   else 'profile.warned' end)
    when p_kind = 'report_resolved' then (
      -- Nur Zieltyp und Ergebnis, nichts über das Gegenüber (Art. 16 Abs. 5).
      select jsonb_build_object(
        'target_type', r.target_type, 'outcome', r.outcome, 'decided_at', r.handled_at,
        'listing_title', case when r.target_type = 'listing' then (select l.title from public.listings l where l.id = r.target_id) end,
        'appeal_until', r.handled_at + make_interval(days => private.setting_int('appeal_window_days')))
      from public.reports r
      where r.id = p_ref_id and r.reporter_id = p_user_id and r.status = 'handled')
    when p_kind = 'appeal_decided' then (
      select jsonb_build_object('status', ap.status, 'reason', ap.decision_note, 'decision_action', ap.decision_action,
                                'decided_at', ap.decided_at)
      from public.appeals ap where ap.id = p_ref_id and ap.user_id = p_user_id and ap.status <> 'open')
  end;
$$;

-- Fristen: Beschwerden nach appeal_keep_months ab der Entscheidung.
create or replace function private.purge_trust_records()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
  a integer;
  ap integer;
begin
  delete from private.account_notifications where coalesce(done_at, claimed_at, created_at) < now() - interval '30 days';
  get diagnostics n = row_count;
  delete from private.verification_attempts where created_at < now() - interval '30 days';
  get diagnostics a = row_count;
  delete from public.appeals where decided_at < now() - make_interval(months => private.setting_int('appeal_keep_months'));
  get diagnostics ap = row_count;
  return jsonb_build_object('notifications', n, 'attempts', a, 'appeals', ap);
end;
$$;

-- Rechte -------------------------------------------------------------------------------------------------------------
revoke execute on function public.admin_find_account(text) from public, anon;
revoke execute on function public.admin_set_account_blocked(uuid, boolean, text, text) from public, anon;
revoke execute on function public.admin_warn_account(uuid, text, text) from public, anon;
revoke execute on function public.admin_report_queue(timestamptz, public.report_target, uuid, integer) from public, anon;
revoke execute on function public.admin_report_target(public.report_target, uuid) from public, anon;
revoke execute on function public.admin_report_message(uuid) from public, anon;
revoke execute on function public.resolve_reports(public.report_target, uuid, text, text, text, text) from public, anon;
revoke execute on function public.my_decisions() from public, anon;
revoke execute on function public.submit_appeal(uuid, text) from public, anon;
revoke execute on function public.admin_appeal_queue(timestamptz, uuid, integer) from public, anon;
revoke execute on function public.admin_appeal(uuid) from public, anon;
revoke execute on function public.decide_appeal(uuid, text, text) from public, anon;
grant execute on function public.admin_find_account(text) to authenticated;
grant execute on function public.admin_set_account_blocked(uuid, boolean, text, text) to authenticated;
grant execute on function public.admin_warn_account(uuid, text, text) to authenticated;
grant execute on function public.admin_report_queue(timestamptz, public.report_target, uuid, integer) to authenticated;
grant execute on function public.admin_report_target(public.report_target, uuid) to authenticated;
grant execute on function public.admin_report_message(uuid) to authenticated;
grant execute on function public.resolve_reports(public.report_target, uuid, text, text, text, text) to authenticated;
grant execute on function public.my_decisions() to authenticated;
grant execute on function public.submit_appeal(uuid, text) to authenticated;
grant execute on function public.admin_appeal_queue(timestamptz, uuid, integer) to authenticated;
grant execute on function public.admin_appeal(uuid) to authenticated;
grant execute on function public.decide_appeal(uuid, text, text) to authenticated;

-- Export version 4: Ergebnis der eigenen Meldungen, Entscheidungen und Beschwerden ---------------------------------
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
    'version', 4,
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
                  'reason', r.reason, 'note', r.note, 'status', r.status, 'outcome', r.outcome, 'created_at', r.created_at,
                  'handled_at', r.handled_at)
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
                from public.reviews rv where uid in (rv.author_id, rv.target_id)), '[]'::jsonb),
    -- M9b: Entscheidungen wie my_decisions (ohne Frist und ohne Admin-Identität) und eigene Beschwerden.
    'decisions', coalesce((select jsonb_agg(jsonb_build_object('action', d.action, 'created_at', d.created_at, 'code', d.code,
                  'reason', d.reason, 'target_type', d.target_type,
                  'target_label', case when d.action = 'report.handled' and d.target_type <> 'listing' then null else d.target_label end,
                  'outcome', d.outcome) order by d.created_at)
                from private.decisions_for(uid) d), '[]'::jsonb),
    'appeals', coalesce((select jsonb_agg(jsonb_build_object('decision_action', ap.decision_action, 'text', ap.text, 'status', ap.status,
                  'created_at', ap.created_at, 'decided_at', ap.decided_at, 'decision_note', ap.decision_note) order by ap.created_at)
                from public.appeals ap where ap.user_id = uid), '[]'::jsonb)
  );
end;
$$;
