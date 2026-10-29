-- M3 Commit 6 (Plan M3 Abschnitte 2.4–2.6, 5, 6, Auflagen 1 und 8, Review PLZ 3–4, QA M3 F1):
-- Regeln für Anzeigen an einer Stelle, mit benannten Hilfsfunktionen.
-- - Attribute je Art: nur bekannte Schlüssel mit gültigen Werten, bei jedem Schreiben (auch Entwürfe).
-- - Preisgrenzen je Währung, Betrag 0 nicht erlaubt (dann „auf Anfrage“).
-- - Legal-Gate RV001 beim Anlegen und Ändern, nicht beim Pausieren, Zurückziehen und Löschen.
-- - Rate-Limit RV002: 3 neue Anzeigen in 24 h für Konten jünger als 7 Tage, sonst 10; Löschen hilft nicht.
-- - Bereitschaftsprüfung (Pflichtfelder, PLZ passt zum Kreis, Fotos verarbeitet) am Ende der Transaktion,
--   auf dem endgültigen Zustand: beim Absenden, für jede Änderung in der Prüfung und bei der Freigabe (A1).
-- - Freigabe-Hash: Fortsetzen (paused → active) nur ohne Änderung seit der Freigabe, sonst pending_review.
-- - Ein Admin an der eigenen Anzeige gilt als Besitzer (Vier-Augen-Prinzip, QA M3 F1).

insert into private.app_settings (key, value, description) values
  ('listing_new_account_days', '7', 'Konten jünger als so viele Tage gelten als neu (Rate-Limit Anzeigen)'),
  ('listing_create_daily_limit_new', '3', 'Höchstzahl neuer Anzeigen in 24 h für neue Konten, auch nach Löschen'),
  ('listing_create_daily_limit', '10', 'Höchstzahl neuer Anzeigen in 24 h, auch nach Löschen');

-- ---------------------------------------------------------------------------
-- Preisgrenzen (Review Plan M3 D3), in Minor-Einheiten
-- ---------------------------------------------------------------------------
alter table public.listings add constraint price_bounds check (
  price_minor is null or (price_minor > 0 and price_minor <= case currency
    when 'EUR' then 1000000000 when 'CHF' then 1000000000 when 'CZK' then 25000000000 when 'PLN' then 5000000000 end)
);

-- ---------------------------------------------------------------------------
-- Attribute je Art (SPEC 3.2, Plan M3 6). Ergebnis: Feldcode des ersten Fehlers oder null.
-- ---------------------------------------------------------------------------
create function private.is_iso_date(value jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  if jsonb_typeof(value) <> 'string' or (value #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    return false;
  end if;
  -- make_date ist immutable (ein Cast nach date hängt von DateStyle ab) und lehnt z. B. den 30.02. ab.
  perform make_date(substr(value #>> '{}', 1, 4)::integer, substr(value #>> '{}', 6, 2)::integer,
                    substr(value #>> '{}', 9, 2)::integer);
  return true;
exception when others then
  return false;
end;
$$;

create function private.is_text(value jsonb, max_length integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(value) = 'string' and char_length(btrim(value #>> '{}')) between 1 and max_length;
$$;

create function private.is_int(value jsonb, low integer, high integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(value) = 'number' and (value #>> '{}') ~ '^[0-9]+$'
    and (value #>> '{}')::numeric between low and high;
$$;

create function private.is_choice(value jsonb, choices text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(value) = 'string' and (value #>> '{}') = any (choices);
$$;

-- Liste mit 1..max_items Einträgen, ohne Doppelte; entweder aus `choices` oder Text bis max_length.
create function private.is_list(value jsonb, choices text[], max_items integer, max_length integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(value) = 'array'
    and jsonb_array_length(value) between 1 and max_items
    and (select count(distinct e) = count(*) from jsonb_array_elements(value) e)
    and not exists (
      select 1 from jsonb_array_elements(value) e
      where not (case when choices is null then private.is_text(e, max_length) else private.is_choice(e, choices) end)
    );
$$;

-- Security definer, weil der Guard als Aufrufer läuft; nur diese Funktion ist für Nutzer ausführbar,
-- die Hilfsfunktionen nicht.
create function private.listing_attributes_error(p_kind public.listing_kind, p_attributes jsonb)
returns text
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  key text;
  value jsonb;
  allowed text[] := case p_kind
    when 'lease' then array['lease_type', 'revier_type', 'submission_deadline', 'lease_duration_years', 'shooting_plan',
                            'hunting_hut', 'co_lessee_slots']
    when 'permit' then array['paid', 'permit_scope', 'season', 'species_limits']
    when 'driven_hunt' then array['event_date', 'spots_available', 'meeting_point_description', 'dogs_required']
    when 'trophy_hunt' then array['legal_ack', 'trophy_details', 'season', 'includes_accommodation', 'import_export_note']
    when 'helper' then array['experience_level', 'tasks']
  end;
begin
  for key, value in select * from jsonb_each(p_attributes) loop
    if not key = any (allowed) then
      return 'attributes.unknown';
    end if;
    if not (case key
      when 'lease_type' then private.is_choice(value, array['eigenjagd', 'genossenschaft', 'pachtnachfolge', 'anteil'])
      when 'revier_type' then private.is_list(value, array['hochwild', 'niederwild', 'feld', 'wald', 'berg', 'wasser'], 6, 0)
      when 'submission_deadline' then private.is_iso_date(value)
      when 'lease_duration_years' then private.is_int(value, 1, 99)
      when 'shooting_plan' then private.is_text(value, 2000)
      when 'co_lessee_slots' then private.is_int(value, 0, 50)
      when 'permit_scope' then private.is_choice(value, array['selbststaendig', 'begleitet'])
      when 'season' then private.is_text(value, 200)
      when 'species_limits' then private.is_text(value, 1000)
      when 'event_date' then private.is_iso_date(value)
      when 'spots_available' then private.is_int(value, 1, 500)
      when 'meeting_point_description' then private.is_text(value, 500)
      when 'trophy_details' then private.is_text(value, 1000)
      when 'import_export_note' then private.is_text(value, 1000)
      when 'experience_level' then private.is_text(value, 200)
      when 'tasks' then private.is_list(value, null, 20, 100)
      -- legal_ack, paid, hunting_hut, dogs_required, includes_accommodation
      else jsonb_typeof(value) = 'boolean'
    end) then
      return 'attributes.' || key;
    end if;
  end loop;
  return null;
end;
$$;
revoke execute on function private.listing_attributes_error(public.listing_kind, jsonb) from public, anon;
grant execute on function private.listing_attributes_error(public.listing_kind, jsonb) to authenticated, service_role;
revoke execute on function private.is_iso_date(jsonb), private.is_text(jsonb, integer), private.is_int(jsonb, integer, integer),
  private.is_choice(jsonb, text[]), private.is_list(jsonb, text[], integer, integer) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Rate-Limit (Plan M3 2.5): Zähler übersteht Löschungen, Sperre je Besitzer gegen parallele Inserts.
-- ---------------------------------------------------------------------------
create table private.listing_creations (
  owner_id uuid not null references public.profiles (user_id) on delete cascade,
  created_at timestamptz not null default now()
);
create index listing_creations_owner_idx on private.listing_creations (owner_id, created_at);
alter table private.listing_creations enable row level security;

-- Aufgerufen vom listings_guard (security invoker) beim Anlegen. Zählt nur für den aktuellen Nutzer;
-- ein direkter Aufruf verbraucht nur das eigene Kontingent.
create function private.claim_listing_creation()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  account_age interval;
  daily_limit integer;
  recent integer;
  oldest timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext('listing_creations:' || uid::text));
  select now() - u.created_at into account_age from auth.users u where u.id = uid;
  daily_limit := case
    when account_age is null or account_age < make_interval(days => private.setting_int('listing_new_account_days'))
      then private.setting_int('listing_create_daily_limit_new')
    else private.setting_int('listing_create_daily_limit')
  end;
  select count(*), min(c.created_at) into recent, oldest
  from private.listing_creations c where c.owner_id = uid and c.created_at > now() - interval '24 hours';
  if recent >= daily_limit then
    raise exception 'listing_rate_limited' using errcode = 'RV002',
      hint = jsonb_build_object('retry_after', to_char((oldest + interval '24 hours') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))::text;
  end if;
  insert into private.listing_creations (owner_id) values (uid);
end;
$$;
revoke execute on function private.claim_listing_creation() from public, anon, service_role;
grant execute on function private.claim_listing_creation() to authenticated;

-- ---------------------------------------------------------------------------
-- Bereitschaft (Plan M3 6, 6.1): Feldcodes aller fehlenden oder falschen Angaben.
-- ---------------------------------------------------------------------------
-- `with_photos`: auch „alle Fotos verarbeitet“ prüfen. Gilt beim Absenden und bei der Freigabe, nicht für
-- Änderungen in der Prüfung: Ein neues Foto ist bis zur Verarbeitung (Sekunden) unverarbeitet.
create function private.listing_readiness(p_listing_id uuid, with_photos boolean)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  l public.listings;
  place public.listing_places;
  attrs jsonb;
  offer boolean;
  species integer;
  codes text[] := '{}'::text[];
begin
  select * into l from public.listings where id = p_listing_id;
  if not found then
    return array['listing'];
  end if;
  attrs := l.attributes;
  offer := l.direction = 'offer';
  select * into place from public.listing_places where listing_id = p_listing_id;
  select count(*) into species from public.listing_species where listing_id = p_listing_id;

  if char_length(btrim(l.description)) < 30 then
    codes := array_append(codes, 'description.length');
  end if;

  -- Ort: bei Angeboten Pflicht; eine angegebene PLZ muss existieren und zum Kreis passen.
  if offer and place.postal_code is null then
    codes := array_append(codes, 'place.postal_code.required');
  end if;
  if offer and place.place_name is null then
    codes := array_append(codes, 'place.place_name.required');
  end if;
  if place.postal_code is not null then
    if not exists (select 1 from public.postal_codes c where c.country = l.country and c.code = place.postal_code) then
      codes := array_append(codes, 'place.postal_code.unknown');
    elsif not exists (select 1 from public.postal_code_regions r
                      where r.country = l.country and r.code = place.postal_code and r.region_id = l.region_id) then
      codes := array_append(codes, 'place.postal_code.region_mismatch');
    end if;
  end if;

  -- Rechtshinweis bei Trophäenjagden, für Angebot und Gesuch.
  if l.kind = 'trophy_hunt' and attrs -> 'legal_ack' is distinct from 'true'::jsonb then
    codes := array_append(codes, 'attributes.legal_ack');
  end if;
  if attrs ? 'event_date' and (attrs ->> 'event_date')::date < current_date then
    codes := array_append(codes, 'attributes.event_date.past');
  end if;

  -- Angebote: Pflichtfelder je Art (Gesuche: alle optional).
  if offer then
    if l.kind = 'lease' then
      if not attrs ? 'lease_type' then codes := array_append(codes, 'attributes.lease_type'); end if;
      if not attrs ? 'revier_type' then codes := array_append(codes, 'attributes.revier_type'); end if;
      if l.area_hectares is null then codes := array_append(codes, 'area_hectares'); end if;
    elsif l.kind = 'permit' then
      if not attrs ? 'permit_scope' then codes := array_append(codes, 'attributes.permit_scope'); end if;
      if not attrs ? 'paid' then codes := array_append(codes, 'attributes.paid'); end if;
    elsif l.kind = 'driven_hunt' then
      if not attrs ? 'event_date' then codes := array_append(codes, 'attributes.event_date'); end if;
      if not attrs ? 'spots_available' then codes := array_append(codes, 'attributes.spots_available'); end if;
    elsif l.kind = 'helper' then
      if not attrs ? 'tasks' then codes := array_append(codes, 'attributes.tasks'); end if;
    end if;
    if l.kind in ('lease', 'permit', 'trophy_hunt') and species = 0 then
      codes := array_append(codes, 'species');
    end if;
  end if;

  if with_photos and exists (select 1 from public.listing_photos p where p.listing_id = p_listing_id and p.processed_at is null) then
    codes := array_append(codes, 'photos.unprocessed');
  end if;
  return codes;
end;
$$;
revoke execute on function private.listing_readiness(uuid, boolean) from public, anon, authenticated, service_role;

-- Am Ende der Transaktion (deferred), damit die Reihenfolge der Statements keine Rolle spielt
-- (Review Plan M3 PLZ 3, Auflage 8): Geprüft wird, wenn die Anzeige danach in der Prüfung liegt oder
-- gerade freigegeben wird; die Fotos beim Absenden und bei der Freigabe (A1).
-- Server-Pfade (Ablauf-Job, Edge Functions) bleiben unberührt.
create function private.listings_check_ready()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid;
  current_status public.listing_status;
  approving boolean := false;
  submitting boolean := false;
  codes text[];
begin
  if private.is_server_caller() then
    return null;
  end if;
  if tg_table_name = 'listings' then
    target := new.id;
    if tg_op = 'INSERT' then
      submitting := new.status = 'pending_review';
    else
      approving := new.status = 'active' and old.status is distinct from 'active';
      submitting := new.status = 'pending_review' and old.status in ('draft', 'rejected', 'expired');
    end if;
  elsif tg_op = 'DELETE' then
    target := old.listing_id;
  else
    target := new.listing_id;
  end if;
  select status into current_status from public.listings where id = target;
  if current_status = 'pending_review' or (current_status = 'active' and approving) then
    codes := private.listing_readiness(target, approving or submitting);
    if cardinality(codes) > 0 then
      raise exception 'listing_not_ready' using errcode = '23514', hint = jsonb_build_object('fields', to_jsonb(codes))::text;
    end if;
  end if;
  return null;
end;
$$;
revoke execute on function private.listings_check_ready() from public, anon, authenticated, service_role;

create constraint trigger listings_ready
  after insert or update on public.listings
  deferrable initially deferred
  for each row execute function private.listings_check_ready();
create constraint trigger listing_places_ready
  after insert or update on public.listing_places
  deferrable initially deferred
  for each row execute function private.listings_check_ready();
create constraint trigger listing_photos_ready
  after insert or update or delete on public.listing_photos
  deferrable initially deferred
  for each row execute function private.listings_check_ready();
create constraint trigger listing_species_ready
  after insert or update or delete on public.listing_species
  deferrable initially deferred
  for each row execute function private.listings_check_ready();

-- ---------------------------------------------------------------------------
-- Freigabe-Hash (Plan M3 5.1, Auflage 8): privat, ohne API-Rechte, nur von Triggern geschrieben.
-- Kanonische Form: alle Spalten der Anzeige außer Verwaltungsspalten (neue Spalten zählen automatisch
-- als Inhalt), Wildarten, Fotos mit Reihenfolge, Alt-Text und Verarbeitung, Ort.
-- ---------------------------------------------------------------------------
create table private.listing_approvals (
  listing_id uuid primary key references public.listings (id) on delete cascade,
  content_hash bytea not null,
  approved_at timestamptz not null default now()
);
alter table private.listing_approvals enable row level security;

create function private.listing_content_hash(p_listing_id uuid)
returns bytea
language sql
stable
security definer
set search_path = ''
as $$
  select extensions.digest(jsonb_build_object(
    'listing', (select to_jsonb(l) - array['id', 'created_at', 'owner_id', 'country', 'status', 'reject_reason',
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
revoke execute on function private.listing_content_hash(uuid) from public, anon, authenticated, service_role;

-- Trigger-Funktion: nicht direkt aufrufbar. Hält bei jeder Freigabe (Admin oder Server) den Inhalt fest.
create function private.listings_record_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.listing_approvals (listing_id, content_hash)
  values (new.id, private.listing_content_hash(new.id))
  on conflict (listing_id) do update set content_hash = excluded.content_hash, approved_at = now();
  return null;
end;
$$;
revoke execute on function private.listings_record_approval() from public, anon, authenticated, service_role;

create trigger listings_record_approval
  after update of status on public.listings
  for each row when (old.status = 'pending_review' and new.status = 'active')
  execute function private.listings_record_approval();

-- Für den Guard (security invoker): Ist der Inhalt seit der Freigabe unverändert? Nur für eigene Anzeigen,
-- liefert nur ja/nein, nie den Hash (der enthält die PLZ und wäre ein Orakel). Ohne Hash: nein (fail closed).
create function private.listing_resume_allowed(p_listing_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.listing_approvals a join public.listings l on l.id = a.listing_id
    where a.listing_id = p_listing_id and l.owner_id = (select auth.uid())
      and a.content_hash = private.listing_content_hash(p_listing_id)
  );
$$;
revoke execute on function private.listing_resume_allowed(uuid) from public, anon, service_role;
grant execute on function private.listing_resume_allowed(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- listings_guard neu (security invoker; is_server() erkennt Definer-Pfade und Server)
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
    -- Alle Inhaltsspalten (Meta-Test: deckt jede Spalte des UPDATE-GRANT außer status und reject_reason).
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
    new.expires_at := null;
    perform private.claim_listing_creation();
    return new;
  end if;

  if status_changed then
    transition := old.status || '>' || new.status;

    -- Keine Freigabe der eigenen Anzeigen (Vier-Augen-Prinzip, Review M1).
    if moderator
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
  elsif new.reject_reason is distinct from old.reject_reason then
    raise exception 'reject_reason setzt nur die Moderation zusammen mit einem Statuswechsel' using errcode = '42501';
  end if;

  if content_changed and not moderator then
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

-- ---------------------------------------------------------------------------
-- Kinder-Tabellen (Fotos, Wildarten, Ort): Admin an der eigenen Anzeige = Besitzer (QA M3 F1),
-- Legal-Gate beim Anlegen und Ändern.
-- ---------------------------------------------------------------------------
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
  privileged := private.is_server_caller() or (private.is_admin() and owner is distinct from (select auth.uid()));
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

-- Anlegen nur mit Zustimmung zu den aktuellen Rechtstexten, auch als Policy (Plan M3 2.5). Der Guard
-- meldet vorher RV001, damit Clients den Fall erkennen.
drop policy listings_insert_own on public.listings;
create policy listings_insert_own on public.listings
  for insert to authenticated
  with check (owner_id = (select auth.uid()) and (select private.is_active_user((select auth.uid())))
              and (select private.has_accepted_current_legal()));
