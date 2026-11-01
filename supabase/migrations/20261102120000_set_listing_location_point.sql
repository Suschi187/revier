-- M6 Commit 4 (Plan M6, ADR 016, Review B1 a und B3): Punkt nur über set_listing_location (keep | set | clear),
-- kein Punkt in Kreisen unter 400 km², Feldcodes statt Koordinaten in Fehlern.

insert into private.app_settings (key, value, description) values
  ('listing_location_min_district_km2', '400', 'Kein Kartenpunkt in Kreisen unter dieser Fläche in km² (ADR 016)');

create or replace function private.listings_blur_location()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  key_hex text;
  centroid extensions.geography;
  area numeric;
  projected extensions.geometry;
  cell extensions.geometry;
  mac bytea;
  bearing_deg double precision;
  distance_m double precision;
begin
  if tg_op = 'UPDATE' and new.display_location is not distinct from old.display_location then
    -- Kreiswechsel ohne neuen Punkt: alter Punkt mit altem Schlüssel wäre eine zweite Stichprobe (B3).
    if new.region_id is distinct from old.region_id then
      new.display_location := null;
    end if;
    return new;
  end if;

  if new.display_location is null then
    return new;
  end if;

  -- Nur der Besitzer setzt den Punkt, auch kein Admin: Wer einen bekannten Punkt setzt, lernt den
  -- Versatz und damit die Zellen aller Anzeigen des Besitzers im Kreis (B1). Entfernen (null) bleibt erlaubt.
  if (select auth.uid()) is distinct from new.owner_id then
    raise exception 'Den Punkt setzt nur der Besitzer der Anzeige' using errcode = '42501';
  end if;

  select s.decrypted_secret into key_hex from vault.decrypted_secrets s where s.name = 'listing_location_key';
  if key_hex is null or encode(extensions.hmac(convert_to('fingerprint', 'UTF8'), decode(key_hex, 'hex'), 'sha256'), 'hex')
      is distinct from (select a.value #>> '{}' from private.app_settings a where a.key = 'listing_location_key_fp') then
    raise exception 'Standortverfremdung nicht verfügbar' using errcode = 'RV003';
  end if;

  -- Kleine Kreise (ADR 016, Review B1 a): Mit der öffentlichen Kreisgrenze grenzt der Punkt die Lage zu stark ein.
  select r.centroid, r.area_km2 into centroid, area from public.regions r where r.id = new.region_id;
  if area < private.setting_int('listing_location_min_district_km2') then
    raise exception 'In diesem Kreis ist kein Punkt möglich' using errcode = '23514',
      hint = '{"fields":["place.point.small_district"]}';
  end if;
  -- Plausibilität ohne Polygone (ADR 006). Die Meldung enthält keine Koordinaten.
  if not extensions.st_dwithin(new.display_location, centroid, private.setting_int('listing_location_max_km') * 1000) then
    raise exception 'Der Punkt liegt nicht im gewählten Landkreis' using errcode = '23514',
      hint = '{"fields":["place.point.too_far"]}';
  end if;

  projected := extensions.st_transform(new.display_location::extensions.geometry, 3035);
  cell := extensions.st_setsrid(extensions.st_makepoint(
    floor(extensions.st_x(projected) / 1000) * 1000 + 500,
    floor(extensions.st_y(projected) / 1000) * 1000 + 500), 3035);

  mac := extensions.hmac(convert_to(new.owner_id::text || ':' || new.region_id::text, 'UTF8'), decode(key_hex, 'hex'), 'sha256');
  bearing_deg := ((get_byte(mac, 0)::bigint << 24) | (get_byte(mac, 1)::bigint << 16)
                  | (get_byte(mac, 2)::bigint << 8) | get_byte(mac, 3)::bigint) / 4294967296.0 * 360;
  distance_m := 3000 + ((get_byte(mac, 4)::bigint << 24) | (get_byte(mac, 5)::bigint << 16)
                  | (get_byte(mac, 6)::bigint << 8) | get_byte(mac, 7)::bigint) / 4294967296.0 * 2000;

  new.display_location := extensions.st_project(
    extensions.st_transform(cell, 4326)::extensions.geography, distance_m, radians(bearing_deg));
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- set_listing_location mit Punkt (B3). Alte Signatur entfernen statt überladen (PostgREST löst Überladungen mit
-- benannten Argumenten nicht eindeutig auf). Vorgabe keep: alte Aufrufe bleiben gültig.
-- ---------------------------------------------------------------------------
drop function public.set_listing_location(uuid, uuid, text, text);

create function public.set_listing_location(
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
  -- NaN und Unendlich fallen durch between (NaN ist in Postgres größer als jede Zahl).
  if p_point = 'set' and not (p_lat between -90 and 90 and p_lng between -180 and 180) then
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
revoke execute on function public.set_listing_location(uuid, uuid, text, text, text, double precision, double precision) from public, anon;
grant execute on function public.set_listing_location(uuid, uuid, text, text, text, double precision, double precision) to authenticated;
