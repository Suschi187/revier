-- QA M9b (docs/QA-REPORT.md, „M9b – Abnahme“):
-- - F1: decide_appeal öffnet bei einer Beschwerde von Meldenden nur die Meldungen der angefochtenen Bearbeitung
--   (neue Spalte resolution_id), nicht frühere Zyklen; vorher verletzte das reports_one_open_idx.
-- - F2: Die Ausweichregel schließt neben dem entscheidenden Admin auch den Beschwerdeführer aus.
-- - F3: Kartenpunkt entfernen verlangt Code (Anzeigen-Grund) und Begründung, schreibt beides ins Audit
--   listing.point_removed und legt eine Moderations-Mail (decision point_removed) an.
-- - F4: report_resolved verweist auf das Audit der Bearbeitung (decision_audit_id): Jede neue Entscheidung nach einer
--   Wiedereröffnung ergibt eine eigene Mail.
-- - F6: Admins lesen Verifizierungsdokumente nicht mehr über die Storage-API (Policy entfernt). Jeder Abruf läuft über
--   die Edge Function verification-document (Audit über admin_open_verification_document, Download mit service_role,
--   Prüfung der ersten Bytes, no-store); eine signierte URL mit langer Laufzeit gibt es damit nicht mehr.
-- - F5: resolve_reports prüft den Code je Maßnahme (Anzeigen-Grund für Entfernen und Kartenpunkt, Konto-Grund für
--   Verwarnen und Sperren) mit 23514 und hint fields code.

-- F1: Kennung einer Bearbeitung (nur Server, nicht lesbar für Nutzer).
alter table public.reports add column resolution_id uuid;
create index reports_resolution_idx on public.reports (resolution_id) where resolution_id is not null;

create or replace function private.reports_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
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
    -- Eine Bearbeitung von resolve_reports (F1): Beschwerden öffnen nur deren Meldungen wieder.
    new.resolution_id := nullif(current_setting('revier.report_resolution', true), '')::uuid;
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
    new.resolution_id := null;
    perform private.write_audit('report.reopened', 'report', new.id, jsonb_build_object('target_type', new.target_type));
  else
    raise exception 'Statuswechsel nicht erlaubt' using errcode = '42501';
  end if;
  return new;
end;
$$;

alter table private.moderation_notifications drop constraint moderation_notifications_decision_check;
alter table private.moderation_notifications add constraint moderation_notifications_decision_check
  check (decision = any (array['approved', 'changes_requested', 'rejected', 'removed', 'point_removed']));

create or replace function private.other_admin_available(p_exclude uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.user_roles r
    join auth.mfa_factors f on f.user_id = r.user_id and f.factor_type = 'totp' and f.status = 'verified'
    where r.role = 'admin' and r.user_id <> (select auth.uid()) and r.user_id is distinct from p_exclude
      and private.is_active_user(r.user_id)
  );
$$;
revoke execute on function private.other_admin_available(uuid) from public, anon, authenticated;
drop function private.other_admin_available();

create or replace function public.decide_appeal(p_appeal_id uuid, p_outcome text, p_note text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
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
    if private.other_admin_available(ap.user_id) then
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
          -- Nur die Meldungen der angefochtenen Bearbeitung (resolution_id), nicht frühere Zyklen.
          update public.reports r set status = 'open'
          where r.target_type = d.target_type::public.report_target and r.target_id = d.target_id and r.status = 'handled'
            and r.resolution_id = (select x.resolution_id from public.audit_log a join public.reports x on x.id = a.target_id where a.id = d.id)
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

create or replace function public.resolve_reports(p_target_type report_target, p_target_id uuid, p_outcome text, p_code text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_expected_version text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
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
  -- F5: Code passend zur Maßnahme; F3: Kartenpunkt mit Code und Begründung wie Entfernen.
  if v_outcome in ('content_removed', 'point_removed') then
    if p_code is null or p_code not in ('incomplete', 'wrong_category', 'weapons', 'prohibited_content', 'duplicate',
                                        'contact_in_text', 'implausible', 'other') then
      raise exception 'Grund fehlt' using errcode = '23514', hint = '{"fields":["code"]}';
    end if;
    if note is null then
      raise exception 'Begründung fehlt' using errcode = '23514', hint = '{"fields":["note"]}';
    end if;
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
        perform set_config('revier.point_code', p_code, true);
        perform set_config('revier.point_note', note, true);
        update public.listings set display_location = null where id = p_target_id;
        perform set_config('revier.point_code', '', true);
        perform set_config('revier.point_note', '', true);
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
  perform set_config('revier.report_resolution', gen_random_uuid()::text, true);
  perform set_config('revier.report_code', coalesce(p_code, ''), true);
  perform set_config('revier.report_note', coalesce(note, ''), true);
  update public.reports set status = 'handled', outcome = v_outcome where id = any (open_ids);
  perform set_config('revier.report', previous_flag, true);
  perform set_config('revier.report_code', '', true);
  perform set_config('revier.report_note', '', true);
  perform set_config('revier.report_resolution', '', true);

  -- Meldende erfahren nur das Ergebnis (Art. 16 Abs. 5).
  -- F4: je Bearbeitung eine Mail (ref_id = Audit der Bearbeitung).
  for r in select x.decision_audit_id, x.reporter_id from public.reports x
           where x.id = any (open_ids) and x.reporter_id is not null and x.decision_audit_id is not null loop
    insert into private.account_notifications (kind, user_id, ref_id) values ('report_resolved', r.reporter_id, r.decision_audit_id)
    on conflict do nothing;
  end loop;
  return v_outcome;
end;
$$;

create or replace function private.listings_point_removed_audit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
as $$
begin
  -- Nur die Moderation an fremden Anzeigen; Besitzer und Server (Kreiswechsel, Verfremdung) nicht.
  if private.is_admin() and new.owner_id is distinct from (select auth.uid()) then
    perform private.write_audit('listing.point_removed', 'listing', new.id,
      jsonb_build_object('status', new.status, 'code', nullif(current_setting('revier.point_code', true), ''),
                         'reason', nullif(current_setting('revier.point_note', true), '')));
    -- F3: Mail an den Besitzer mit Grund und Begründung (Moderations-Mail, ADR 018/020).
    insert into private.moderation_notifications (listing_id, owner_id, decision, reject_code, reason)
    values (new.id, new.owner_id, 'point_removed', nullif(current_setting('revier.point_code', true), ''),
            nullif(current_setting('revier.point_note', true), ''));
    if new.status in ('active', 'paused') then
      update private.listing_approvals set content_hash = private.listing_content_hash(new.id)
      where listing_id = new.id;
    end if;
  end if;
  return null;
end;
$$;

create or replace function private.account_notification_details(p_kind text, p_ref_id uuid, p_user_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
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
      -- ref_id = Audit report.handled der Bearbeitung (F4); nur Zieltyp und Ergebnis (Art. 16 Abs. 5).
      select jsonb_build_object(
        'target_type', r.target_type, 'outcome', a.details ->> 'outcome', 'decided_at', a.created_at,
        'listing_title', case when r.target_type = 'listing' then (select l.title from public.listings l where l.id = r.target_id) end,
        'appeal_until', a.created_at + make_interval(days => private.setting_int('appeal_window_days')))
      from public.audit_log a join public.reports r on r.id = a.target_id
      where a.id = p_ref_id and a.action = 'report.handled' and r.reporter_id = p_user_id)
    when p_kind = 'appeal_decided' then (
      select jsonb_build_object('status', ap.status, 'reason', ap.decision_note, 'decision_action', ap.decision_action,
                                'decided_at', ap.decided_at)
      from public.appeals ap where ap.id = p_ref_id and ap.user_id = p_user_id and ap.status <> 'open')
    -- Nur solange der Entwurf noch ein unbearbeiteter Entwurf ist; sonst keine Mail.
    when p_kind = 'draft_expiry_notice' then (
      select jsonb_build_object('listing_id', l.id, 'listing_title', l.title, 'deletes_at', p_payload ->> 'deletes_at')
      from public.listings l
      where l.id = p_ref_id and l.owner_id = p_user_id and l.status = 'draft' and l.edited_at <= l.draft_notice_at)
  end;
$$;

-- F6 -----------------------------------------------------------------------------------------------------------------
drop policy verification_docs_select_admin on storage.objects;
drop function private.verification_document_viewed(text);

create or replace function public.admin_verification(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
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
      'document_present', v.document_path is not null,
      -- Angegebener Typ nur zur Darstellung (Bild oder PDF-Link); den Inhalt prüft verification-document.
      'document_mime', (select o.metadata ->> 'mimetype' from storage.objects o where o.bucket_id = 'verification-docs' and o.name = v.document_path), 'is_own', v.user_id = (select auth.uid()),
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
