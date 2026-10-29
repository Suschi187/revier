-- Review M1, mittlere und niedrige Befunde (Architekt 5/8/12/13, QA F6). Entscheidung 2026-10-29:
-- Chats bleiben erhalten, wenn eine Anzeige gelöscht wird.

-- (8) Beweise: Gesperrte Nutzer löschen keine Anzeigen; Admins entfernen per Status 'removed'
-- (auditiert) statt per DELETE; Chats überdauern die Anzeige (listing_id wird NULL).
drop policy listings_delete_own on public.listings;
create policy listings_delete_own on public.listings
  for delete to authenticated
  using (owner_id = (select auth.uid()) and status <> 'removed' and (select private.is_active_user((select auth.uid()))));
drop policy listings_delete_admin on public.listings;

alter table public.conversations alter column listing_id drop not null;
alter table public.conversations drop constraint conversations_listing_id_fkey;
alter table public.conversations add constraint conversations_listing_id_fkey
  foreign key (listing_id) references public.listings (id) on delete set null;

-- (5, QA F6) Meldende und Antragsteller sehen nicht, welcher Admin entschieden hat.
-- Admin-Ansichten mit diesen Spalten entstehen in M4 serverseitig.
revoke select on public.reports from authenticated;
grant select (id, created_at, reporter_id, target_type, target_id, reason, note, status, handled_at)
  on public.reports to authenticated;
revoke select on public.verifications from authenticated;
grant select (id, created_at, user_id, document_path, document_type, status, reviewed_at, decided_at,
  document_deleted_at, reject_reason) on public.verifications to authenticated;

-- (13) Server-Erkennung über die aktive Rolle statt über JWT-Claims. current_setting('role')
-- bleibt auch in Definer-Funktionen die aufrufende Rolle ('none' bei direkten postgres-Sitzungen).
create or replace function private.is_server_caller()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('role', true), 'none') in ('none', 'postgres', 'service_role', 'supabase_admin');
$$;

-- (12) Admins geben eigene Anzeigen nicht frei.
create or replace function private.listings_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  region_level public.region_level;
  region_country public.country_code;
  is_admin boolean;
  is_owner boolean;
  content_changed boolean;
  transition text;
begin
  -- Region muss ein Kreis sein; das Land wird immer aus der Region abgeleitet.
  select r.level, r.country into region_level, region_country from public.regions r where r.id = new.region_id;
  if region_level is distinct from 'district' then
    raise exception 'Region muss ein Landkreis/Bezirk sein' using errcode = '23514';
  end if;
  new.country := region_country;

  if private.is_server() then
    return new;
  end if;

  is_admin := private.is_admin();

  if tg_op = 'INSERT' then
    if new.owner_id is distinct from (select auth.uid()) then
      raise exception 'Anzeigen nur für das eigene Konto' using errcode = '42501';
    end if;
    if new.status not in ('draft', 'pending_review') then
      raise exception 'Neue Anzeigen sind Entwurf oder zur Prüfung' using errcode = '42501';
    end if;
    new.reject_reason := null;
    new.expires_at := null;
    return new;
  end if;

  is_owner := old.owner_id = (select auth.uid());

  if new.owner_id is distinct from old.owner_id or new.expires_at is distinct from old.expires_at then
    raise exception 'owner_id und expires_at setzt nur der Server' using errcode = '42501';
  end if;

  content_changed := row(new.kind, new.direction, new.title, new.description, new.content_language, new.region_id,
      new.display_location, new.price_minor, new.currency, new.price_unit, new.area_hectares,
      new.start_date, new.end_date, new.attributes)
    is distinct from row(old.kind, old.direction, old.title, old.description, old.content_language, old.region_id,
      old.display_location, old.price_minor, old.currency, old.price_unit, old.area_hectares,
      old.start_date, old.end_date, old.attributes);

  if new.status is distinct from old.status then
    transition := old.status || '>' || new.status;

    -- Keine Freigabe der eigenen Anzeigen (Vier-Augen-Prinzip, Review M1).
    if is_admin and not is_owner
       and (transition in ('pending_review>active', 'pending_review>rejected', 'pending_review>draft')
            or (new.status = 'removed' and old.status <> 'removed')) then
      if new.status = 'active' then
        new.expires_at := now() + make_interval(days => private.setting_int('listing_active_days'));
        new.reject_reason := null;
      elsif new.reject_reason is null or new.reject_reason is not distinct from old.reject_reason then
        raise exception 'Ablehnen, Zurückgeben und Entfernen brauchen einen neuen Grund' using errcode = '23514';
      end if;
      return new;
    end if;

    if is_owner and transition in ('draft>pending_review', 'pending_review>draft', 'active>paused',
                                   'paused>active', 'rejected>draft', 'rejected>pending_review',
                                   'expired>pending_review') then
      if transition = 'paused>active' and (old.expires_at is null or old.expires_at <= now()) then
        raise exception 'Abgelaufene Anzeigen müssen neu geprüft werden' using errcode = '42501';
      end if;
      if new.reject_reason is distinct from old.reject_reason then
        raise exception 'reject_reason setzt nur die Moderation' using errcode = '42501';
      end if;
      if new.status = 'pending_review' then
        new.reject_reason := null;
      end if;
    else
      raise exception 'Statuswechsel % nicht erlaubt', transition using errcode = '42501';
    end if;
  elsif new.reject_reason is distinct from old.reject_reason then
    raise exception 'reject_reason setzt nur die Moderation zusammen mit einem Statuswechsel' using errcode = '42501';
  end if;

  if content_changed and not is_admin then
    if old.status = 'removed' then
      raise exception 'Entfernte Anzeigen sind gesperrt' using errcode = '42501';
    end if;
    -- Freigegebene Inhalte dürfen nicht unbemerkt umgeschrieben werden.
    if new.status in ('active', 'paused') then
      new.status := 'pending_review';
      new.reject_reason := null;
    end if;
  end if;

  return new;
end;
$$;

-- (12) Grund einer entschiedenen Verifizierung ist unveränderlich.
create or replace function private.verifications_guard()
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

  -- Entschiedene Anträge sind abgeschlossen, auch der Grund lässt sich nicht nachträglich ändern.
  if old.status <> 'pending'
     and (new.status is distinct from old.status or new.reject_reason is distinct from old.reject_reason) then
    raise exception 'Entschiedene Verifizierungen sind abgeschlossen' using errcode = '42501';
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
