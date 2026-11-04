-- QA M6 Funde F4–F7 (docs/QA-REPORT.md, „M6 – Abnahme“).

-- ---------------------------------------------------------------------------
-- F4: Kartenpunkte in allen RPC-Ausgaben genau wie gespeichert. Supabase setzt extra_float_digits = 0, dann rundet
-- float8 in jsonb auf 15 Stellen (wie QA M5 F1). Gesetzt an den Aufrufern von private.listing_card (search_listings
-- hat es schon) und an map_listings; nicht an listing_card selbst, sonst sicherte Postgres die Einstellung je Zeile.
-- ---------------------------------------------------------------------------
alter function public.map_listings(jsonb) set extra_float_digits = 3;
alter function public.my_favorites() set extra_float_digits = 3;
alter function public.provider_listings(uuid, text, integer) set extra_float_digits = 3;

-- ---------------------------------------------------------------------------
-- F5: 'set' braucht beide Koordinaten, sonst 22023 point.
-- ---------------------------------------------------------------------------
create or replace function public.set_listing_location(
  p_listing_id uuid,
  p_region_id uuid,
  p_postal_code text default null,
  p_place_name text default null,
  p_point text default 'keep',
  p_lat double precision default null,
  p_lng double precision default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_point is null or p_point not in ('keep', 'set', 'clear') then
    raise exception 'Ungültige Angabe zum Punkt' using errcode = '22023', hint = 'point';
  end if;
  -- NaN und Unendlich fallen durch between (NaN ist in Postgres größer als jede Zahl). null ergäbe unknown und
  -- liefe durch; st_makepoint(null) entfernte dann still den Punkt (QA M6 F5).
  if p_point = 'set' and (p_lat is null or p_lng is null or not (p_lat between -90 and 90 and p_lng between -180 and 180)) then
    raise exception 'Ungültiger Punkt' using errcode = '22023', hint = 'point';
  end if;
  -- Gleicher Fehler wie private.require_current_legal(), das für Nutzer nicht ausführbar bleibt.
  if not private.has_accepted_current_legal() then
    raise exception 'legal_consent_required'
      using errcode = 'RV001', hint = 'Zustimmung zur aktuellen Version per legal_status() und accept_legal() einholen';
  end if;
  if not private.owns_editable_listing(p_listing_id) then
    raise exception 'Anzeige nicht gefunden' using errcode = '42501';
  end if;

  -- Kreis und Punkt in einem UPDATE: Ein Kreiswechsel löscht sonst einen eben gesetzten Punkt (ADR 006, B3).
  if p_point = 'set' then
    update public.listings
    set region_id = p_region_id,
        display_location = extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography
    where id = p_listing_id;
  elsif p_point = 'clear' then
    update public.listings set region_id = p_region_id, display_location = null
    where id = p_listing_id and (region_id is distinct from p_region_id or display_location is not null);
  else
    -- Nur bei echter Änderung schreiben: UPDATE OF region_id löst sonst die Verfremdung aus.
    update public.listings set region_id = p_region_id
    where id = p_listing_id and region_id is distinct from p_region_id;
  end if;

  -- Erst UPDATE, dann INSERT statt ON CONFLICT: Bei ON CONFLICT liefe der Insert-Guard auch für einen
  -- unveränderten Ort und nähme eine freigegebene Anzeige aus der Öffentlichkeit.
  update public.listing_places set postal_code = p_postal_code, place_name = p_place_name
  where listing_id = p_listing_id
    and (postal_code is distinct from p_postal_code or place_name is distinct from p_place_name);
  if not found and not exists (select 1 from public.listing_places where listing_id = p_listing_id) then
    insert into public.listing_places (listing_id, postal_code, place_name)
    values (p_listing_id, p_postal_code, p_place_name);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- F6: Unterlauf in bbox ist ein ungültiger Filter (22023 bbox), kein 22003.
-- ---------------------------------------------------------------------------
create or replace function private.search_filters_error(p_filters jsonb)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  key text;
  allowed constant text[] := array['v', 'q', 'country', 'region', 'kind', 'direction', 'species', 'currency',
    'price_min', 'price_max', 'price_unit', 'area_min', 'area_max', 'date_from', 'date_to', 'verified_only', 'sort', 'bbox'];
  v jsonb;
  region_country public.country_code;
  q text;
begin
  if p_filters is null or jsonb_typeof(p_filters) <> 'object' or pg_column_size(p_filters) > 4096 then
    return 'filters';
  end if;
  for key in select jsonb_object_keys(p_filters) order by 1 loop
    if not key = any (allowed) then
      return key;
    end if;
  end loop;
  if p_filters -> 'v' is distinct from '1'::jsonb then
    return 'v';
  end if;

  v := p_filters -> 'q';
  if v is not null then
    if jsonb_typeof(v) <> 'string' then return 'q'; end if;
    q := private.trim_all(v #>> '{}');
    if q is null or char_length(q) not between 1 and 200 then return 'q'; end if;
  end if;

  foreach key in array array['country', 'kind', 'direction', 'currency', 'price_unit', 'sort'] loop
    v := p_filters -> key;
    if v is not null and (jsonb_typeof(v) <> 'string' or not (v #>> '{}') = any (case key
        when 'country' then enum_range(null::public.country_code)::text[]
        when 'kind' then enum_range(null::public.listing_kind)::text[]
        when 'direction' then enum_range(null::public.listing_direction)::text[]
        when 'currency' then enum_range(null::public.currency_code)::text[]
        when 'price_unit' then array_remove(enum_range(null::public.price_unit)::text[], 'on_request')
        else array['newest', 'price_asc', 'price_desc', 'relevance'] end)) then
      return key;
    end if;
  end loop;

  v := p_filters -> 'region';
  if v is not null then
    if jsonb_typeof(v) <> 'string' then return 'region'; end if;
    select r.country into region_country from public.regions r where r.code = v #>> '{}';
    if not found or (p_filters ? 'country' and region_country::text <> p_filters ->> 'country') then
      return 'region';
    end if;
  end if;

  v := p_filters -> 'species';
  if v is not null then
    if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) not between 1 and 20
       or exists (select 1 from jsonb_array_elements(v) e where jsonb_typeof(e) <> 'string')
       or (select count(distinct e) from jsonb_array_elements_text(v) e) <> jsonb_array_length(v)
       or exists (select 1 from jsonb_array_elements_text(v) e
                  where not exists (select 1 from public.game_species s where s.code = e)) then
      return 'species';
    end if;
  end if;

  foreach key in array array['price_min', 'price_max'] loop
    v := p_filters -> key;
    if v is not null and (jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric <> trunc((v #>> '{}')::numeric)
        or (v #>> '{}')::numeric not between 0 and 1000000000000) then
      return key;
    end if;
  end loop;
  foreach key in array array['area_min', 'area_max'] loop
    v := p_filters -> key;
    if v is not null and (jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric not between 0 and 10000000) then
      return key;
    end if;
  end loop;
  foreach key in array array['date_from', 'date_to'] loop
    v := p_filters -> key;
    if v is not null then
      if jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then return key; end if;
      begin
        perform (v #>> '{}')::date;
      exception when others then
        return key;
      end;
      if to_char((v #>> '{}')::date, 'YYYY-MM-DD') <> (v #>> '{}') then return key; end if;
    end if;
  end loop;
  v := p_filters -> 'verified_only';
  if v is not null and jsonb_typeof(v) <> 'boolean' then
    return 'verified_only';
  end if;

  -- Bereich (ADR 016): vier Zahlen west, süd, ost, nord; höchstens 30° je Achse, keine Datumsgrenze.
  v := p_filters -> 'bbox';
  if v is not null then
    if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) <> 4
       or exists (select 1 from jsonb_array_elements(v) e where jsonb_typeof(e) <> 'number') then
      return 'bbox';
    end if;
    if not ((v ->> 0)::numeric between -180 and 180 and (v ->> 2)::numeric between -180 and 180
            and (v ->> 1)::numeric between -90 and 90 and (v ->> 3)::numeric between -90 and 90
            and (v ->> 0)::numeric < (v ->> 2)::numeric and (v ->> 1)::numeric < (v ->> 3)::numeric
            and (v ->> 2)::numeric - (v ->> 0)::numeric <= 30 and (v ->> 3)::numeric - (v ->> 1)::numeric <= 30) then
      return 'bbox';
    end if;
    -- Beträge, die float8 nicht darstellt (1e-400), scheitern sonst erst in search_conditions mit 22003 (QA M6 F6).
    -- Als Bereichsgrenze bedeutungslos klein; ohne Ausnahmeblock, damit jede Suche ohne Subtransaktion auskommt.
    if exists (select 1 from jsonb_array_elements(v) e where e::text::numeric <> 0 and abs(e::text::numeric) < 1e-300) then
      return 'bbox';
    end if;
  end if;

  -- Abhängigkeiten
  if (p_filters ? 'price_min' or p_filters ? 'price_max') and not p_filters ? 'currency' then
    return 'currency';
  end if;
  if (p_filters ->> 'price_min')::numeric > (p_filters ->> 'price_max')::numeric then
    return 'price_max';
  end if;
  if (p_filters ->> 'area_min')::numeric > (p_filters ->> 'area_max')::numeric then
    return 'area_max';
  end if;
  if (p_filters ->> 'date_from')::date > (p_filters ->> 'date_to')::date then
    return 'date_to';
  end if;
  if p_filters ->> 'sort' in ('price_asc', 'price_desc') and not (p_filters ? 'currency' and p_filters ? 'price_unit') then
    return 'sort';
  end if;
  if p_filters ->> 'sort' = 'relevance' and not p_filters ? 'q' then
    return 'sort';
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- F7: Entfernt ein Moderator den Kartenpunkt, bleibt der Status (aktive Anzeige bleibt öffentlich, mit
-- Kreismittelpunkt), und die Aktion steht im Audit-Log. Eine Aktion im Admin folgt mit M9 (Meldungen).
-- ---------------------------------------------------------------------------
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
  point_removal boolean := false;
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
  point_removal := content_changed and moderator
     and new.display_location is null and old.display_location is not null
     and row(new.kind, new.direction, new.title, new.description, new.content_language, new.region_id,
                      new.price_minor, new.currency, new.price_unit, new.area_hectares,
                      new.start_date, new.end_date, new.attributes)
                  is not distinct from row(old.kind, old.direction, old.title, old.description, old.content_language,
                      old.region_id, old.price_minor, old.currency, old.price_unit, old.area_hectares,
                      old.start_date, old.end_date, old.attributes);
  if content_changed and moderator and not point_removal then
    raise exception 'Moderatoren ändern keine Inhalte' using errcode = '42501';
  end if;

  if content_changed then
    if old.status = 'removed' then
      raise exception 'Entfernte Anzeigen sind gesperrt' using errcode = '42501';
    end if;
    -- Freigegebene Inhalte dürfen nicht unbemerkt umgeschrieben werden. Entfernt die Moderation nur den Punkt,
    -- bleibt der Status: Die Anzeige zeigt dann den Kreismittelpunkt, Inhalt ist unverändert (QA M6 F7).
    if new.status in ('active', 'paused') and not point_removal then
      new.status := 'pending_review';
      new.reject_reason := null;
    end if;
  end if;

  return new;
end;
$$;

create function private.listings_point_removed_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Nur die Moderation an fremden Anzeigen; Besitzer und Server (Kreiswechsel, Verfremdung) nicht.
  if private.is_admin() and new.owner_id is distinct from (select auth.uid()) then
    perform private.write_audit('listing.point_removed', 'listing', new.id, jsonb_build_object('status', new.status));
  end if;
  return null;
end;
$$;
revoke execute on function private.listings_point_removed_audit() from public, anon, authenticated;

create trigger listings_point_removed_audit
  after update of display_location on public.listings
  for each row when (new.display_location is null and old.display_location is not null)
  execute function private.listings_point_removed_audit();
