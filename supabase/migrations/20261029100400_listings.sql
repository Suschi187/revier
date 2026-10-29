-- M1 Anzeigen, Fotos, Wildarten je Anzeige (SPEC 3.1, 3.3, 3.4 v0.3; docs/adr/006).
-- Rechte zweistufig: Spalten-GRANTs als grober Filter, Trigger für Statuslogik und abgeleitete Felder.

create table public.listings (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  owner_id uuid not null default auth.uid() references public.profiles (user_id) on delete cascade,
  kind public.listing_kind not null,
  direction public.listing_direction not null,
  title text not null check (char_length(btrim(title)) between 3 and 100),
  description text not null default '' check (char_length(description) <= 5000),
  content_language public.language_code not null,
  country public.country_code not null,
  region_id uuid not null references public.regions (id) on delete restrict,
  display_location extensions.geography(point, 4326),
  price_minor bigint check (price_minor >= 0),
  currency public.currency_code,
  price_unit public.price_unit,
  area_hectares numeric(12, 2) check (area_hectares > 0),
  start_date date,
  end_date date,
  status public.listing_status not null default 'draft',
  reject_reason text check (reject_reason is null or char_length(btrim(reject_reason)) between 1 and 1000),
  expires_at timestamptz,
  attributes jsonb not null default '{}'::jsonb,
  search_vector tsvector generated always as (
    case content_language
      when 'de' then setweight(to_tsvector('german'::regconfig, title), 'A') || setweight(to_tsvector('german'::regconfig, description), 'B')
      when 'en' then setweight(to_tsvector('english'::regconfig, title), 'A') || setweight(to_tsvector('english'::regconfig, description), 'B')
      -- Für cs/pl gibt es keinen Snowball-Stemmer in Postgres: einfache Wortsuche.
      else setweight(to_tsvector('simple'::regconfig, title), 'A') || setweight(to_tsvector('simple'::regconfig, description), 'B')
    end
  ) stored,
  constraint dates_ordered check (end_date is null or start_date is null or end_date >= start_date),
  -- Preis: entweder "auf Anfrage" ohne Betrag oder Betrag mit Währung und Einheit. Nie Gleitkomma.
  constraint price_consistent check (
    (price_unit = 'on_request' and price_minor is null)
    or (price_minor is null and currency is null and price_unit is null)
    or (price_minor is not null and currency is not null and price_unit is not null and price_unit <> 'on_request')
  ),
  constraint attributes_object check (jsonb_typeof(attributes) = 'object' and pg_column_size(attributes) <= 16384),
  -- Keine Koordinaten über einen Umweg (ADR 006).
  constraint attributes_no_coordinates check (
    not (attributes ?| array['lat', 'lng', 'lon', 'latitude', 'longitude', 'location', 'coordinates', 'geo', 'position'])
  )
);

create index listings_public_idx on public.listings (status, country, kind, direction, expires_at);
create index listings_region_idx on public.listings (region_id);
create index listings_owner_idx on public.listings (owner_id);
create index listings_price_idx on public.listings (currency, price_minor) where price_minor is not null;
create index listings_search_idx on public.listings using gin (search_vector);
create index listings_location_idx on public.listings using gist (display_location);

-- Fester Versatz je Anzeige (ADR 006). FK deferred, weil der Versatz im BEFORE-INSERT-Trigger
-- entsteht, bevor die Anzeigenzeile existiert.
create table private.listing_location_offsets (
  listing_id uuid primary key references public.listings (id) on delete cascade deferrable initially deferred,
  bearing_deg double precision not null check (bearing_deg >= 0 and bearing_deg < 360),
  distance_m double precision not null check (distance_m between 3000 and 5000)
);
alter table private.listing_location_offsets enable row level security;

create table public.listing_photos (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  storage_path text not null unique check (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,100}$'),
  sort_order smallint not null check (sort_order between 0 and 7),
  unique (listing_id, sort_order) deferrable initially immediate
);
create index listing_photos_listing_idx on public.listing_photos (listing_id);

create table public.listing_species (
  listing_id uuid not null references public.listings (id) on delete cascade,
  species_code text not null references public.game_species (code) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (listing_id, species_code)
);

-- ---------------------------------------------------------------------------
-- Hilfsfunktionen
-- ---------------------------------------------------------------------------

-- Server-Kontext (Jobs, Edge Functions, Definer-Funktionen): unterliegt nicht der Besitzer-Logik.
create function private.is_server()
returns boolean
language sql
stable
set search_path = ''
as $$
  select current_user in ('postgres', 'service_role', 'supabase_admin');
$$;

-- Konto existiert und ist weder gesperrt noch gelöscht. Definer, weil anon profiles nicht liest.
create function private.is_active_user(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = uid and not p.is_blocked and p.deleted_at is null
  );
$$;

grant execute on function private.is_server() to anon, authenticated, service_role;
grant execute on function private.is_active_user(uuid) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Trigger: Region, Land, Statuslogik
-- ---------------------------------------------------------------------------
create function private.listings_guard()
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

    if is_admin and (transition in ('pending_review>active', 'pending_review>rejected', 'pending_review>draft')
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

create trigger listings_guard
  before insert or update on public.listings
  for each row execute function private.listings_guard();

-- ---------------------------------------------------------------------------
-- Trigger: Standortverfremdung mit festem Versatz je Anzeige (ADR 006)
-- ---------------------------------------------------------------------------
create function private.listings_blur_location()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  offset_row private.listing_location_offsets;
begin
  if new.display_location is null
     or (tg_op = 'UPDATE' and new.display_location is not distinct from old.display_location) then
    return new;
  end if;

  select * into offset_row from private.listing_location_offsets where listing_id = new.id;
  if not found then
    insert into private.listing_location_offsets (listing_id, bearing_deg, distance_m)
    values (new.id, random() * 360, 3000 + random() * 2000)
    returning * into offset_row;
  end if;

  new.display_location := extensions.st_project(new.display_location, offset_row.distance_m, radians(offset_row.bearing_deg));
  return new;
end;
$$;

revoke execute on function private.listings_blur_location() from public, anon, authenticated;

-- Nach dem Guard (alphabetische Reihenfolge der Trigger): zuletzt den Punkt verfremden.
create trigger listings_zz_blur_location
  before insert or update of display_location on public.listings
  for each row execute function private.listings_blur_location();

-- ---------------------------------------------------------------------------
-- Fotos und Wildarten: max. 8 Fotos, Änderungen an freigegebenen Anzeigen → erneute Prüfung
-- ---------------------------------------------------------------------------
create function private.listing_children_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid := coalesce(new.listing_id, old.listing_id);
  current_status public.listing_status;
begin
  -- Sperre auf der Anzeige verhindert, dass parallele Uploads das Limit umgehen.
  select status into current_status from public.listings where id = target for update;

  if tg_op = 'INSERT' and tg_table_name = 'listing_photos'
     and (select count(*) from public.listing_photos where listing_id = target) >= 8 then
    raise exception 'Höchstens 8 Fotos pro Anzeige' using errcode = '23514';
  end if;

  if current_status in ('active', 'paused') and not private.is_admin() and not private.is_server_caller() then
    update public.listings set status = 'pending_review', reject_reason = null where id = target;
  end if;

  return coalesce(new, old);
end;
$$;

revoke execute on function private.listing_children_guard() from public, anon, authenticated;

-- In Definer-Funktionen ist current_user immer der Besitzer; die aufrufende Rolle steht in
-- session_user bzw. im JWT. Server-Aufrufer erkennt man an der Rolle im Request.
create function private.is_server_caller()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'postgres')
         in ('service_role', 'postgres', 'supabase_admin');
$$;

grant execute on function private.is_server_caller() to anon, authenticated, service_role;

create trigger listing_photos_guard
  before insert or update or delete on public.listing_photos
  for each row execute function private.listing_children_guard();

create trigger listing_species_guard
  before insert or update or delete on public.listing_species
  for each row execute function private.listing_children_guard();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.listings enable row level security;
alter table public.listing_photos enable row level security;
alter table public.listing_species enable row level security;

create policy listings_select_public on public.listings
  for select to anon, authenticated
  using (status = 'active' and expires_at > now() and (select private.is_active_user(owner_id)));

create policy listings_select_own on public.listings
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy listings_select_admin on public.listings
  for select to authenticated
  using ((select private.is_admin()));

create policy listings_insert_own on public.listings
  for insert to authenticated
  with check (owner_id = (select auth.uid()) and (select private.is_active_user((select auth.uid()))));

create policy listings_update_own on public.listings
  for update to authenticated
  using (owner_id = (select auth.uid()) and (select private.is_active_user((select auth.uid()))))
  with check (owner_id = (select auth.uid()));

create policy listings_update_admin on public.listings
  for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

-- Entfernte Anzeigen bleiben für die Moderation erhalten (DSA), bis das Konto gelöscht wird.
create policy listings_delete_own on public.listings
  for delete to authenticated
  using (owner_id = (select auth.uid()) and status <> 'removed');

create policy listings_delete_admin on public.listings
  for delete to authenticated
  using ((select private.is_admin()));

grant select on public.listings to anon, authenticated;
grant insert (kind, direction, title, description, content_language, region_id, display_location,
  price_minor, currency, price_unit, area_hectares, start_date, end_date, status, attributes)
  on public.listings to authenticated;
grant update (kind, direction, title, description, content_language, region_id, display_location,
  price_minor, currency, price_unit, area_hectares, start_date, end_date, status, attributes, reject_reason)
  on public.listings to authenticated;
grant delete on public.listings to authenticated;

-- Fotos und Wildarten: sichtbar, wenn die Anzeige sichtbar ist (RLS der listings greift im Subselect);
-- ändern darf nur der Besitzer einer nicht entfernten Anzeige.
create function private.owns_editable_listing(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.listings l
    where l.id = target and l.owner_id = (select auth.uid()) and l.status <> 'removed'
      and private.is_active_user(l.owner_id)
  );
$$;
grant execute on function private.owns_editable_listing(uuid) to authenticated;

create policy listing_photos_select on public.listing_photos
  for select to anon, authenticated
  using (exists (select 1 from public.listings l where l.id = listing_id));
create policy listing_photos_write_own on public.listing_photos
  for all to authenticated
  using ((select private.owns_editable_listing(listing_id)))
  with check ((select private.owns_editable_listing(listing_id)));

create policy listing_species_select on public.listing_species
  for select to anon, authenticated
  using (exists (select 1 from public.listings l where l.id = listing_id));
create policy listing_species_write_own on public.listing_species
  for all to authenticated
  using ((select private.owns_editable_listing(listing_id)))
  with check ((select private.owns_editable_listing(listing_id)));

grant select on public.listing_photos, public.listing_species to anon, authenticated;
grant insert, update (sort_order), delete on public.listing_photos to authenticated;
grant insert, delete on public.listing_species to authenticated;
