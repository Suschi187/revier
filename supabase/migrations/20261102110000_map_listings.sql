-- M6 Commit 3 (Plan M6, ADR 016): Kartenpunkte per RPC (Review A4), Punkt in den Trefferkarten, Cache-Zähler
-- beim Entfernen eines Punkts (A6).

-- ---------------------------------------------------------------------------
-- Trefferkarte mit Punkt und Genauigkeit (Suche, Favoriten, Anbieter)
-- ---------------------------------------------------------------------------
create or replace function private.listing_card(l public.listings)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', l.id,
    'kind', l.kind,
    'direction', l.direction,
    'title', l.title,
    'content_language', l.content_language,
    'country', l.country,
    'district_code', d.code,
    'state_code', s.code,
    'postal_prefix', l.postal_prefix,
    'price_minor', l.price_minor,
    'currency', l.currency,
    'price_unit', l.price_unit,
    'area_hectares', l.area_hectares,
    'start_date', l.start_date,
    'end_date', l.end_date,
    'event_date', case when l.kind = 'driven_hunt' then l.attributes ->> 'event_date' end,
    'published_at', l.published_at,
    -- Kartenpunkt (ADR 016): verfremdeter Punkt oder Kreismittelpunkt, genau wie gespeichert.
    'point', jsonb_build_object('lng', extensions.st_x(l.map_point), 'lat', extensions.st_y(l.map_point)),
    'approx', case when l.display_location is null then 'district' else 'point' end,
    'photo', (select jsonb_build_object('id', p.id, 'thumb_path', p.thumb_path, 'width', p.width, 'height', p.height,
                                        'alt_text', p.alt_text)
              from public.listing_photos p
              where p.listing_id = l.id and p.processed_at is not null and p.thumb_path is not null
              order by p.sort_order limit 1),
    'provider', (select jsonb_build_object('id', pp.user_id, 'display_name', pp.display_name, 'account_type', pp.account_type,
                                           'business_name', pp.business_name, 'verified', pp.verification_status = 'verified')
                 from public.public_profiles pp where pp.user_id = l.owner_id)
  )
  from public.regions d
  join public.regions s on s.id = d.parent_id
  where d.id = l.region_id;
$$;

-- ---------------------------------------------------------------------------
-- map_listings: dieselben Bedingungen und dieselbe Sichtbarkeit wie die Suche (private.search_conditions),
-- bbox Pflicht, höchstens 2000 Punkte. Ohne owner_id, PLZ und Präfix (B1: kein bequemer Weg zum Angriff).
-- ---------------------------------------------------------------------------
create function public.map_listings(p_filters jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  bad text;
  f jsonb := coalesce(p_filters, '{}'::jsonb);
  parts private.search_parts;
  points jsonb;
begin
  bad := private.search_filters_error(p_filters);
  if bad is not null then
    raise exception 'Ungültiger Filter' using errcode = '22023', hint = bad;
  end if;
  if not f ? 'bbox' then
    raise exception 'Bereich fehlt' using errcode = '22023', hint = 'bbox';
  end if;
  parts := private.search_conditions(f);

  execute format(
    'select coalesce(jsonb_agg(jsonb_build_object(
        ''id'', l.id, ''lng'', extensions.st_x(l.map_point), ''lat'', extensions.st_y(l.map_point),
        ''kind'', l.kind, ''direction'', l.direction, ''title'', l.title,
        ''price_minor'', l.price_minor, ''currency'', l.currency, ''price_unit'', l.price_unit,
        ''district_code'', d.code, ''approx'', case when l.display_location is null then ''district'' else ''point'' end)
        order by l.published_at desc, l.id desc), ''[]'')
     from (select l.* from public.listings l where %s order by l.published_at desc, l.id desc limit 2001) l
     join public.regions d on d.id = l.region_id',
    parts.conds)
  into points
  using parts.query, f, parts.region_ids, parts.species;

  return jsonb_build_object(
    'points', (select coalesce(jsonb_agg(e order by n), '[]') from jsonb_array_elements(points) with ordinality t(e, n) where n <= 2000),
    'truncated', jsonb_array_length(points) > 2000
  );
end;
$$;
revoke execute on function public.map_listings(jsonb) from public;
grant execute on function public.map_listings(jsonb) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Entfernt ein Moderator (oder der Besitzer) den Punkt, wirkt das sofort in allen Caches (ADR 015 „Zähler“).
-- ---------------------------------------------------------------------------
create trigger listings_point_removed_bump_cache
  after update of display_location on public.listings
  for each row when (new.display_location is null and old.display_location is not null)
  execute function private.bump_public_cache_epoch();
