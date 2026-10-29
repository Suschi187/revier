-- M3 (ADR 006 v2, Plan M3 Abschnitt 4, Review M1 Punkt 10, Review Plan M3 B1–B9):
-- Die Verfremdung ist stabil je Besitzer und Kreis. Der Eingabepunkt rastet auf eine 1-km-Zelle
-- (EPSG:3035) ein, der Versatz kommt aus HMAC(secret, owner_id:region_id). Viele Anzeigen desselben
-- Reviers liefern so denselben Versatzvektor; ihr Mittel bleibt 3–5 km neben der wahren Lage.
-- Der Eingabepunkt wird nie gespeichert. Das Secret liegt im Vault, je Umgebung verschieden.

-- ---------------------------------------------------------------------------
-- Secret und Fingerprint. Fehlt das Secret, obwohl ein Fingerprint existiert (Restore in ein
-- anderes Projekt), bricht die Migration ab, statt still ein neues anzulegen (Runbook ADR 006).
-- ---------------------------------------------------------------------------
do $$
declare
  key_hex text;
  fp_expected text;
  fp_actual text;
begin
  select s.decrypted_secret into key_hex from vault.decrypted_secrets s where s.name = 'listing_location_key';
  select a.value #>> '{}' into fp_expected from private.app_settings a where a.key = 'listing_location_key_fp';

  if key_hex is null then
    if fp_expected is not null then
      raise exception 'listing_location_key fehlt, aber ein Fingerprint existiert: Secret aus dem Escrow importieren (ADR 006)';
    end if;
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'listing_location_key',
      'HMAC-Schlüssel der Standortverfremdung (ADR 006). Nie rotieren, nie ausgeben.'
    );
    select s.decrypted_secret into key_hex from vault.decrypted_secrets s where s.name = 'listing_location_key';
  end if;

  fp_actual := encode(extensions.hmac(convert_to('fingerprint', 'UTF8'), decode(key_hex, 'hex'), 'sha256'), 'hex');
  if fp_expected is null then
    insert into private.app_settings (key, value, description)
    values ('listing_location_key_fp', to_jsonb(fp_actual), 'Fingerprint des Standort-Secrets (ADR 006), kein Geheimnis');
  elsif fp_expected <> fp_actual then
    raise exception 'listing_location_key passt nicht zum Fingerprint: falsches Secret (ADR 006)';
  end if;
end;
$$;

insert into private.app_settings (key, value, description) values
  ('listing_location_max_km', '80', 'Höchster Abstand des Eingabepunkts vom Centroid des Kreises in km (ADR 006)');

-- ---------------------------------------------------------------------------
-- Verfremdung. Die Ableitung steht nur hier und ist nicht aufrufbar (Review B2).
-- ---------------------------------------------------------------------------
drop trigger listings_zz_blur_location on public.listings;
drop function private.listings_blur_location();
drop table private.listing_location_offsets;

create function private.listings_blur_location()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  key_hex text;
  centroid extensions.geography;
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

  -- Plausibilität ohne Polygone (ADR 006). Die Meldung enthält keine Koordinaten.
  select r.centroid into centroid from public.regions r where r.id = new.region_id;
  if not extensions.st_dwithin(new.display_location, centroid, private.setting_int('listing_location_max_km') * 1000) then
    raise exception 'Der Punkt liegt nicht im gewählten Landkreis' using errcode = '23514';
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

revoke execute on function private.listings_blur_location() from public, anon, authenticated, service_role;

-- Nach dem Guard (alphabetische Reihenfolge der Trigger), jetzt auch bei Kreiswechsel (B3).
create trigger listings_zz_blur_location
  before insert or update of display_location, region_id on public.listings
  for each row execute function private.listings_blur_location();
