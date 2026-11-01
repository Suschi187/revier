-- M6 Commit 2 (Plan M6, ADR 016): Kartenpunkt (Review B2), Bereich im Filterformat v1 (A3), gemeinsame
-- Bedingungen für Suche und Karte (A4).

alter table public.regions alter column area_km2 set not null;

-- ---------------------------------------------------------------------------
-- map_point: display_location oder Kreismittelpunkt, nur vom Trigger gesetzt. Läuft als letzter BEFORE-Trigger
-- (nach listings_zz_blur_location, alphabetisch) und ohne Spaltenliste, sieht also nie den Eingabepunkt und
-- überschreibt jeden direkten Schreibversuch (B2). Lesbar wie display_location (Tabellen-SELECT).
-- ---------------------------------------------------------------------------
alter table public.listings add column map_point extensions.geometry(Point, 4326);

create function private.listings_map_point()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.map_point := coalesce(
    new.display_location::extensions.geometry,
    (select r.centroid::extensions.geometry from public.regions r where r.id = new.region_id));
  return new;
end;
$$;
revoke execute on function private.listings_map_point() from public, anon, authenticated;

create trigger listings_zzz_map_point
  before insert or update on public.listings
  for each row execute function private.listings_map_point();

-- Inhalts-Hash ohne map_point (abgeleitet, wie published_at), sonst wären pausierte Anzeigen nicht fortsetzbar.
create or replace function private.listing_content_hash(p_listing_id uuid)
returns bytea
language sql
stable
security definer
set search_path = ''
as $$
  select extensions.digest(jsonb_build_object(
    'listing', (select to_jsonb(l) - array['id', 'created_at', 'owner_id', 'country', 'status', 'reject_reason', 'reject_code', 'submitted_at',
                                          'published_at', 'approved_at', 'map_point', 'expires_at', 'search_vector', 'postal_prefix']
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

-- Bestand: ein UPDATE löst den Trigger aus (Server-Pfad, ändert keine Inhalte).
update public.listings set map_point = null;
alter table public.listings alter column map_point set not null;

create index listings_map_point_idx on public.listings using gist (map_point) where status = 'active';

-- ---------------------------------------------------------------------------
-- bbox im Filterformat v1 (additiv) und gemeinsame Bedingungen
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

create type private.search_parts as (conds text, query tsquery, region_ids uuid[], species text[]);

create function private.search_conditions(f jsonb)
returns private.search_parts
language plpgsql
stable
set search_path = ''
as $$
declare
  conds text := 'l.status = ''active'' and l.expires_at > now() and private.listing_is_public(l.status, l.expires_at, l.owner_id)';
  query tsquery;
  q text;
  region_ids uuid[];
  species text[];
begin
  if f ? 'q' then
    q := normalize(private.trim_all(f ->> 'q'), nfc);
    -- Grenze je Sprachfassung (QA M5 F2): Der verknüpfte tsquery zählt jedes Wort bis zu dreimal.
    if greatest(numnode(websearch_to_tsquery('german', q)), numnode(websearch_to_tsquery('english', q)),
                numnode(websearch_to_tsquery('simple', q))) > 32 then
      raise exception 'Suchtext zu lang' using errcode = '22023', hint = 'q';
    end if;
    query := websearch_to_tsquery('german', q) || websearch_to_tsquery('english', q) || websearch_to_tsquery('simple', q);
    conds := conds || ' and l.search_vector @@ $1';
  end if;
  if f ? 'country' then conds := conds || ' and l.country = ($2 ->> ''country'')::public.country_code'; end if;
  if f ? 'region' then
    select coalesce(array_agg(r.id), '{}') into region_ids
    from public.regions r
    where r.code = f ->> 'region' and r.level = 'district'
       or r.parent_id = (select x.id from public.regions x where x.code = f ->> 'region' and x.level = 'state');
    conds := conds || ' and l.region_id = any ($3)';
  end if;
  if f ? 'kind' then conds := conds || ' and l.kind = ($2 ->> ''kind'')::public.listing_kind'; end if;
  if f ? 'direction' then conds := conds || ' and l.direction = ($2 ->> ''direction'')::public.listing_direction'; end if;
  if f ? 'species' then
    species := array(select jsonb_array_elements_text(f -> 'species'));
    conds := conds || ' and exists (select 1 from public.listing_species ls where ls.listing_id = l.id and ls.species_code = any ($4))';
  end if;
  -- Keine Umrechnung: Mit Währung zählen nur Anzeigen in dieser Währung („auf Anfrage“ hat keine).
  if f ? 'currency' then conds := conds || ' and l.currency = ($2 ->> ''currency'')::public.currency_code'; end if;
  if f ? 'price_min' then conds := conds || ' and l.price_minor >= ($2 ->> ''price_min'')::bigint'; end if;
  if f ? 'price_max' then conds := conds || ' and l.price_minor <= ($2 ->> ''price_max'')::bigint'; end if;
  if f ? 'price_unit' then conds := conds || ' and l.price_unit = ($2 ->> ''price_unit'')::public.price_unit'; end if;
  if f ? 'area_min' then conds := conds || ' and l.area_hectares >= ($2 ->> ''area_min'')::numeric'; end if;
  if f ? 'area_max' then conds := conds || ' and l.area_hectares <= ($2 ->> ''area_max'')::numeric'; end if;
  if f ? 'date_from' or f ? 'date_to' then
    -- Zeitraum der Anzeige; bei Gesellschaftsjagden zählt event_date, aber nur mit kind = driven_hunt (A2).
    if f ->> 'kind' = 'driven_hunt' then
      conds := conds || ' and (l.attributes ->> ''event_date'') is not null'
        || ' and ($2 ->> ''date_from'' is null or (l.attributes ->> ''event_date'')::date >= ($2 ->> ''date_from'')::date)'
        || ' and ($2 ->> ''date_to'' is null or (l.attributes ->> ''event_date'')::date <= ($2 ->> ''date_to'')::date)';
    else
      conds := conds || ' and (l.start_date is not null or l.end_date is not null)'
        || ' and ($2 ->> ''date_to'' is null or l.start_date is null or l.start_date <= ($2 ->> ''date_to'')::date)'
        || ' and ($2 ->> ''date_from'' is null or l.end_date is null or l.end_date >= ($2 ->> ''date_from'')::date)';
    end if;
  end if;
  if (f ->> 'verified_only')::boolean then
    conds := conds || ' and exists (select 1 from public.public_profiles pp where pp.user_id = l.owner_id and pp.verification_status = ''verified'')';
  end if;

  -- Bereich (ADR 016): map_point im Rechteck; ohne Punkt zählt der Kreismittelpunkt.
  if f ? 'bbox' then
    conds := conds || ' and l.map_point operator(extensions.&&) extensions.st_makeenvelope('
      || '($2 -> ''bbox'' ->> 0)::float8, ($2 -> ''bbox'' ->> 1)::float8, ($2 -> ''bbox'' ->> 2)::float8, ($2 -> ''bbox'' ->> 3)::float8, 4326)';
  end if;
  return row(conds, query, region_ids, species)::private.search_parts;
end;
$$;

revoke execute on function private.search_conditions(jsonb) from public;
grant execute on function private.search_conditions(jsonb) to anon, authenticated, service_role;

create or replace function public.search_listings(p_filters jsonb, p_cursor text default null, p_limit integer default 20)
returns jsonb
language plpgsql
stable
set search_path = ''
-- Rang im Cursor verlustfrei (QA M5 F1): Supabase setzt extra_float_digits = 0, dann rundet float8::text.
set extra_float_digits = 3
as $$
declare
  bad text;
  f jsonb := coalesce(p_filters, '{}'::jsonb);
  sort text := coalesce(p_filters ->> 'sort', 'newest');
  query tsquery;
  region_ids uuid[];
  species text[];
  cursor_data jsonb;
  filter_hash text;
  conds text;
  parts private.search_parts;
  order_by text;
  key_expr text;
  cursor_cond text := '';
  rows jsonb;
  last_key text;
  last_id uuid;
  total integer;
  more boolean;
begin
  bad := private.search_filters_error(p_filters);
  if bad is not null then
    raise exception 'Ungültiger Filter' using errcode = '22023', hint = bad;
  end if;
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception 'Ungültiges Limit' using errcode = '22023', hint = 'limit';
  end if;

  -- Bedingungen gemeinsam mit map_listings (ADR 016, Review A4): eine Stelle, keine Kopie.
  parts := private.search_conditions(f);
  conds := parts.conds;
  query := parts.query;
  region_ids := parts.region_ids;
  species := parts.species;

  key_expr := case sort
    when 'newest' then 'l.published_at::text'
    when 'relevance' then 'ts_rank(l.search_vector, $1)::float8::text'
    else 'l.price_minor::text' end;
  order_by := case sort
    when 'newest' then 'l.published_at desc, l.id desc'
    when 'relevance' then 'ts_rank(l.search_vector, $1) desc, l.id desc'
    when 'price_asc' then 'l.price_minor asc, l.id asc'
    else 'l.price_minor desc, l.id desc' end;

  -- Cursor: an Sortierung und Filter gebunden (A1).
  filter_hash := md5(f::text);
  if p_cursor is not null then
    begin
      if char_length(p_cursor) > 200 then raise exception 'zu lang'; end if;
      cursor_data := convert_from(decode(rpad(translate(p_cursor, '-_', '+/'), (char_length(p_cursor) + 3) / 4 * 4, '='), 'base64'), 'utf8')::jsonb;
      if cursor_data ->> 'h' is distinct from filter_hash or jsonb_typeof(cursor_data -> 'k') <> 'string' then
        raise exception 'unpassend';
      end if;
      perform (cursor_data ->> 'i')::uuid;
      case sort
        when 'newest' then perform (cursor_data ->> 'k')::timestamptz;
        when 'relevance' then perform (cursor_data ->> 'k')::float8;
        else perform (cursor_data ->> 'k')::bigint;
      end case;
    exception when others then
      raise exception 'Ungültiger Cursor' using errcode = '22023', hint = 'cursor';
    end;
    cursor_cond := case sort
      when 'newest' then ' and (l.published_at, l.id) < (($5 ->> ''k'')::timestamptz, ($5 ->> ''i'')::uuid)'
      when 'relevance' then ' and (ts_rank(l.search_vector, $1)::float8, l.id) < (($5 ->> ''k'')::float8, ($5 ->> ''i'')::uuid)'
      when 'price_asc' then ' and (l.price_minor, l.id) > (($5 ->> ''k'')::bigint, ($5 ->> ''i'')::uuid)'
      else ' and (l.price_minor, l.id) < (($5 ->> ''k'')::bigint, ($5 ->> ''i'')::uuid)' end;
  end if;

  execute format(
    'with page as (
       select l.id, %s as k, row_number() over (order by %s) as n
       from public.listings l where %s%s order by %s limit $6 + 1)
     select coalesce(jsonb_agg(jsonb_build_object(''card'', private.listing_card(l), ''k'', p.k, ''i'', p.id) order by p.n), ''[]'')
     from page p join public.listings l on l.id = p.id',
    key_expr, order_by, conds, cursor_cond, order_by)
  into rows
  using query, f, region_ids, species, cursor_data, p_limit;

  -- Die Zeile über dem Limit zeigt nur, ob es weitergeht; der Cursor zeigt auf die letzte gelieferte.
  more := jsonb_array_length(rows) > p_limit;
  if more then
    last_key := rows -> (p_limit - 1) ->> 'k';
    last_id := (rows -> (p_limit - 1) ->> 'i')::uuid;
  end if;
  rows := (select coalesce(jsonb_agg(e -> 'card' order by n), '[]') from jsonb_array_elements(rows) with ordinality as t(e, n)
           where n <= p_limit);

  execute format('select count(*) from (select 1 from public.listings l where %s limit 1001) c', conds)
  into total
  using query, f, region_ids, species, cursor_data, p_limit;

  return jsonb_build_object(
    'items', rows,
    'next_cursor', case when more then
      translate(rtrim(encode(convert_to(jsonb_build_object('h', filter_hash, 'k', last_key, 'i', last_id)::text, 'utf8'), 'base64'), '='), E'+/\n', '-_')
    end,
    'total', least(total, 1000),
    'total_capped', total > 1000
  );
end;
$$;
