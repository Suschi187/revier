-- M4 Commit 2 (Plan M4, ADR 014): Grund als Vorlage, Einreichzeitpunkt, Moderation nur über die RPC,
-- Moderatoren ändern keine Inhalte, is_admin verlangt ein aktives Konto.

alter table public.listings
  add column reject_code text check (reject_code in ('incomplete', 'wrong_category', 'weapons', 'prohibited_content',
                                                     'duplicate', 'contact_in_text', 'implausible', 'other')),
  add column submitted_at timestamptz;

-- Bestand: Freitext-Gründe werden „anderer Grund“; Gründe außerhalb von Entwurf/abgelehnt/entfernt sind veraltet.
update public.listings set reject_code = 'other' where reject_reason is not null and reject_code is null;
update public.listings set reject_code = null, reject_reason = null
where status not in ('draft', 'rejected', 'removed') and (reject_code is not null or reject_reason is not null);
update public.listings set submitted_at = created_at where status = 'pending_review';

alter table public.listings drop constraint listings_reject_reason_check;
alter table public.listings
  add constraint listings_reject_reason_check
    check (reject_reason is null or char_length(private.trim_all(reject_reason)) between 1 and 1000),
  add constraint listings_reject_reason_needs_code check (reject_reason is null or reject_code is not null),
  add constraint listings_reject_code_status check (reject_code is null or status in ('draft', 'rejected', 'removed')),
  add constraint listings_reject_other_needs_reason check (reject_code is distinct from 'other' or reject_reason is not null);

create index listings_review_queue_idx on public.listings (submitted_at, id) where status = 'pending_review';

-- Die RPC moderate_listing (security invoker) schreibt den Code; der Guard verbietet ihn allen anderen.
grant update (reject_code) on public.listings to authenticated;

-- Auf allen Pfaden (auch Server und Definer, die der Guard überspringt): Einreichzeitpunkt setzen, Grund
-- außerhalb von Entwurf/abgelehnt/entfernt leeren. Läuft nach listings_guard (alphabetisch).
create function private.listings_moderation_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'pending_review' and (tg_op = 'INSERT' or old.status is distinct from 'pending_review') then
    new.submitted_at := now();
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
revoke execute on function private.listings_moderation_fields() from public, anon, authenticated;

create trigger listings_zz_moderation_fields
  before insert or update on public.listings
  for each row execute function private.listings_moderation_fields();

-- Inhalts-Hash ohne die neuen Verwaltungsspalten, sonst müssten alle pausierten Anzeigen neu geprüft werden.

create or replace function private.listing_content_hash(p_listing_id uuid)
returns bytea
language sql
stable
security definer
set search_path = ''
as $$
  select extensions.digest(jsonb_build_object(
    'listing', (select to_jsonb(l) - array['id', 'created_at', 'owner_id', 'country', 'status', 'reject_reason', 'reject_code', 'submitted_at',
                                          'expires_at', 'search_vector', 'postal_prefix']
                from public.listings l where l.id = p_listing_id),
    'species', (select coalesce(jsonb_agg(s.species_code order by s.species_code), '[]'::jsonb)
                from public.listing_species s where s.listing_id = p_listing_id),
    'photos', (select coalesce(jsonb_agg(jsonb_build_array(p.id, p.sort_order, p.alt_text, p.processed_at)
                                         order by p.sort_order, p.id), '[]'::jsonb)
               from public.listing_photos p where p.listing_id = p_listing_id),
    'place', (select jsonb_build_array(pl.postal_code, pl.place_name)
              from public.listing_places pl where pl.listing_id = p_listing_id)
  )::text, 'sha256');
$$;

create or replace function private.listings_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  region_level public.region_level;
  region_country public.country_code;
  attributes_error text;
  is_admin boolean;
  is_owner boolean;
  moderator boolean;
  moderation boolean := coalesce(current_setting('revier.moderation', true), '') = 'on';
  content_changed boolean := false;
  status_changed boolean := false;
  transition text;
begin
  -- Region muss ein Kreis sein; das Land wird immer aus der Region abgeleitet.
  select r.level, r.country into region_level, region_country from public.regions r where r.id = new.region_id;
  if region_level is distinct from 'district' then
    raise exception 'Region muss ein Landkreis/Bezirk sein' using errcode = '23514';
  end if;
  new.country := region_country;

  attributes_error := private.listing_attributes_error(new.kind, new.attributes);
  if attributes_error is not null then
    raise exception 'Ungültige Angaben zur Art' using errcode = '23514',
      hint = jsonb_build_object('fields', jsonb_build_array(attributes_error))::text;
  end if;

  if private.is_server() then
    return new;
  end if;

  is_admin := private.is_admin();
  is_owner := new.owner_id = (select auth.uid());
  -- Moderation nur an fremden Anzeigen; an der eigenen ist ein Admin Besitzer (QA M3 F1).
  moderator := is_admin and not is_owner;

  if tg_op = 'UPDATE' then
    is_owner := old.owner_id = (select auth.uid());
    moderator := is_admin and not is_owner;
    if new.owner_id is distinct from old.owner_id or new.expires_at is distinct from old.expires_at then
      raise exception 'owner_id und expires_at setzt nur der Server' using errcode = '42501';
    end if;
    -- Alle Inhaltsspalten (Meta-Test: deckt jede Spalte des UPDATE-GRANT außer status, reject_code, reject_reason).
    content_changed := row(new.kind, new.direction, new.title, new.description, new.content_language, new.region_id,
        new.display_location, new.price_minor, new.currency, new.price_unit, new.area_hectares,
        new.start_date, new.end_date, new.attributes)
      is distinct from row(old.kind, old.direction, old.title, old.description, old.content_language, old.region_id,
        old.display_location, old.price_minor, old.currency, old.price_unit, old.area_hectares,
        old.start_date, old.end_date, old.attributes);
    status_changed := new.status is distinct from old.status;
  end if;

  -- Legal-Gate (RV001): Anlegen, Inhalte ändern, Absenden und Fortsetzen; nicht Pausieren und Zurückziehen.
  if (tg_op = 'INSERT' or (is_owner and (content_changed or (status_changed and new.status not in ('paused', 'draft')))))
     and not private.has_accepted_current_legal() then
    raise exception 'legal_consent_required'
      using errcode = 'RV001', hint = 'Zustimmung zur aktuellen Version per legal_status() und accept_legal() einholen';
  end if;

  if tg_op = 'INSERT' then
    if not is_owner then
      raise exception 'Anzeigen nur für das eigene Konto' using errcode = '42501';
    end if;
    if new.status not in ('draft', 'pending_review') then
      raise exception 'Neue Anzeigen sind Entwurf oder zur Prüfung' using errcode = '42501';
    end if;
    new.reject_reason := null;
    new.reject_code := null;
    new.expires_at := null;
    perform private.claim_listing_creation();
    return new;
  end if;

  if status_changed then
    transition := old.status || '>' || new.status;

    -- Keine Freigabe der eigenen Anzeigen (Vier-Augen-Prinzip, Review M1). Moderation nur über die RPC
    -- moderate_listing, die das Flag revier.moderation setzt (ADR 014, A4); Moderatoren ändern dabei keine Inhalte.
    if moderator
       and (transition in ('pending_review>active', 'pending_review>rejected', 'pending_review>draft')
            or (new.status = 'removed' and old.status <> 'removed')) then
      if not moderation then
        raise exception 'Moderation nur über moderate_listing' using errcode = '42501';
      end if;
      if content_changed then
        raise exception 'Moderatoren ändern keine Inhalte' using errcode = '42501';
      end if;
      if new.status = 'active' then
        new.expires_at := now() + make_interval(days => private.setting_int('listing_active_days'));
        new.reject_reason := null;
        new.reject_code := null;
      elsif new.reject_code is null then
        raise exception 'Ablehnen, Zurückgeben und Entfernen brauchen einen Grund' using errcode = '23514';
      end if;
      return new;
    end if;

    if is_owner and transition in ('draft>pending_review', 'pending_review>draft', 'active>paused',
                                   'paused>active', 'rejected>draft', 'rejected>pending_review',
                                   'expired>pending_review') then
      if transition = 'paused>active' and (old.expires_at is null or old.expires_at <= now()) then
        raise exception 'Abgelaufene Anzeigen müssen neu geprüft werden' using errcode = '42501';
      end if;
      if (new.reject_reason, new.reject_code) is distinct from (old.reject_reason, old.reject_code) then
        raise exception 'reject_reason setzt nur die Moderation' using errcode = '42501';
      end if;
      -- Fortsetzen nur mit dem freigegebenen Inhalt (Entscheidung 4); sonst zurück in die Prüfung.
      if transition = 'paused>active' and not content_changed and not private.listing_resume_allowed(old.id) then
        new.status := 'pending_review';
      end if;
      if new.status = 'pending_review' then
        new.reject_reason := null;
      end if;
    else
      raise exception 'Statuswechsel % nicht erlaubt', transition using errcode = '42501';
    end if;
  elsif (new.reject_reason, new.reject_code) is distinct from (old.reject_reason, old.reject_code) then
    raise exception 'reject_reason setzt nur die Moderation zusammen mit einem Statuswechsel' using errcode = '42501';
  end if;

  -- Moderatoren ändern keine fremden Inhalte, auch ohne Statuswechsel (ADR 014, A5). Einzige Ausnahme:
  -- den Kartenpunkt entfernen (ADR 006, schützt die Lage).
  if content_changed and moderator
     and not (new.display_location is null and old.display_location is not null
              and row(new.kind, new.direction, new.title, new.description, new.content_language, new.region_id,
                      new.price_minor, new.currency, new.price_unit, new.area_hectares,
                      new.start_date, new.end_date, new.attributes)
                  is not distinct from row(old.kind, old.direction, old.title, old.description, old.content_language,
                      old.region_id, old.price_minor, old.currency, old.price_unit, old.area_hectares,
                      old.start_date, old.end_date, old.attributes)) then
    raise exception 'Moderatoren ändern keine Inhalte' using errcode = '42501';
  end if;

  if content_changed then
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

create or replace function private.listing_children_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid := coalesce(new.listing_id, old.listing_id);
  current_status public.listing_status;
  owner uuid;
  privileged boolean;
begin
  select l.owner_id into owner from public.listings l where l.id = target;
  -- Nur Server-Pfade sind privilegiert; Moderatoren ändern keine fremden Fotos, Wildarten oder Orte (ADR 014, A5).
  privileged := private.is_server_caller();
  if not privileged and not private.owns_editable_listing(target) then
    raise exception 'Keine Berechtigung für diese Anzeige' using errcode = '42501';
  end if;
  if not privileged and tg_op <> 'DELETE' then
    perform private.require_current_legal();
  end if;
  -- Sperre auf der Anzeige verhindert, dass parallele Uploads das Limit umgehen.
  select status into current_status from public.listings where id = target for update;
  if tg_op = 'INSERT' and tg_table_name = 'listing_photos' then
    if (select count(*) from public.listing_photos where listing_id = target) >= 8 then
      raise exception 'Höchstens 8 Fotos pro Anzeige' using errcode = '23514';
    end if;
    if not privileged then
      perform pg_advisory_xact_lock(hashtext('photo_creations:' || owner::text));
      if (select count(*) from private.photo_creations c
          where c.owner_id = owner and c.created_at > now() - interval '24 hours')
         >= private.setting_int('photo_create_daily_limit') then
        raise exception 'Tageslimit für Fotos erreicht' using errcode = 'RV002';
      end if;
      insert into private.photo_creations (owner_id) values (owner);
    end if;
  end if;
  -- Verschachtelt, weil PL/pgSQL die Felder von NEW auch in einem kurzgeschlossenen Ausdruck auflöst.
  if tg_table_name = 'listing_places' then
    if (tg_op = 'UPDATE' and (new.postal_code, new.place_name) is not distinct from (old.postal_code, old.place_name))
       or (tg_op = 'INSERT' and new.postal_code is null and new.place_name is null) then
      return new;
    end if;
  end if;
  -- Nur Änderungen durch den Besitzer führen zurück in die Prüfung; Sortierung und Alt-Text zählen mit.
  if current_status in ('active', 'paused') and not privileged then
    update public.listings set status = 'pending_review', reject_reason = null where id = target;
  end if;
  return coalesce(new, old);
end;
$$;

-- Audit: „Bearbeitung anfordern“ erkennt der Trigger am Code, der Freitext ist optional (A6).
create or replace function private.listings_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('active', 'rejected', 'removed') and new.status is distinct from old.status
     or (old.status = 'pending_review' and new.status = 'draft' and new.reject_code is not null) then
    if private.is_admin() then
      perform private.write_audit('listing.' || new.status::text, 'listing', new.id,
        jsonb_build_object('from', old.status, 'code', new.reject_code, 'reason', new.reject_reason));
    end if;
  end if;
  return null;
end;
$$;

-- Gesperrte oder gelöschte Konten haben keine Admin-Rechte (A11).
create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select auth.jwt() ->> 'aal') = 'aal2', false)
     and exists (
       select 1 from private.user_roles r
       where r.user_id = (select auth.uid()) and r.role = 'admin'
     )
     and private.is_active_user((select auth.uid()));
$$;
