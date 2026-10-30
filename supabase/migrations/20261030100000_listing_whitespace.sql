-- QA M3 F2: Leerraum zählt nie als Inhalt. btrim() entfernt nur U+0020; Zeilenumbrüche, Tabs oder geschützte
-- Leerzeichen bestanden so Titel-Check und Pflichtlänge der Beschreibung. private.trim_all entfernt genau die
-- Zeichen, die String.prototype.trim in JavaScript entfernt (WhiteSpace und LineTerminator nach ECMAScript),
-- damit DB und Zod gleich urteilen (ADR 013). Längen zählen beide in Codepoints.
-- Profile, gespeicherte Suchen, Chat und Moderationsgründe folgen mit ihren Schritten (CHANGELOG).

create function private.trim_all(value text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select regexp_replace(value, '^[\t\n\v\f\r    -     　﻿]+|[\t\n\v\f\r    -     　﻿]+$', '', 'g');
$$;

-- Check-Constraints werten die Funktion mit den Rechten des schreibenden Nutzers aus. Sie ist rein und
-- gibt nichts preis (Allowlist in 00_meta).
revoke execute on function private.trim_all(text) from public, anon;
grant execute on function private.trim_all(text) to authenticated, service_role;

alter table public.listings drop constraint listings_title_check;
alter table public.listings add constraint listings_title_check
  check (char_length(private.trim_all(title)) between 3 and 100);

alter table public.listing_photos drop constraint listing_photos_alt_text_check;
alter table public.listing_photos add constraint listing_photos_alt_text_check
  check (alt_text is null or char_length(private.trim_all(alt_text)) between 1 and 200);

create or replace function private.is_text(value jsonb, max_length integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(value) = 'string' and char_length(private.trim_all(value #>> '{}')) between 1 and max_length;
$$;

create or replace function private.listing_places_prepare()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  listing_country public.country_code;
begin
  if tg_op = 'UPDATE' and new.listing_id is distinct from old.listing_id then
    raise exception 'listing_id ist unveränderlich' using errcode = '42501';
  end if;
  select l.country into listing_country from public.listings l where l.id = new.listing_id;
  new.postal_code := nullif(private.trim_all(new.postal_code), '');
  new.place_name := nullif(private.trim_all(new.place_name), '');
  new.updated_at := now();
  -- Fehlermeldungen nennen nur Feldcodes, nie den Wert (Review Plan M3 PLZ 5).
  if new.postal_code is not null and not (case listing_country
      when 'DE' then new.postal_code ~ '^[0-9]{5}$'
      when 'AT' then new.postal_code ~ '^[1-9][0-9]{3}$'
      when 'CH' then new.postal_code ~ '^[1-9][0-9]{3}$'
      when 'CZ' then new.postal_code ~ '^[1-7][0-9]{2} ?[0-9]{2}$'
      when 'PL' then new.postal_code ~ '^[0-9]{2}-[0-9]{3}$'
      else false end) then
    raise exception 'PLZ hat nicht das Format des Landes' using errcode = '23514', hint = 'place.postal_code.format';
  end if;
  return new;
end;
$$;

create or replace function private.listing_readiness(p_listing_id uuid, with_photos boolean)
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

  if char_length(private.trim_all(l.description)) < 30 then
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
