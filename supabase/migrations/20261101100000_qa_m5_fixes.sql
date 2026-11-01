-- QA M5 F1, F2, F3, F4, F7 (ADR 015): exakter Relevanz-Cursor, Grenze für Suchtexte je Sprachfassung,
-- Favoriten per RPC (ohne lange URL), keine eigenen Anzeigen merken, „auf Anfrage“ ohne Währung.

-- ---------------------------------------------------------------------------
-- F1 und F2: search_listings
-- ---------------------------------------------------------------------------
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
  q text;
  region_ids uuid[];
  species text[];
  cursor_data jsonb;
  filter_hash text;
  conds text := 'l.status = ''active'' and l.expires_at > now() and private.listing_is_public(l.status, l.expires_at, l.owner_id)';
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

-- ---------------------------------------------------------------------------
-- F7: „auf Anfrage“ hat keine Währung, sonst erschiene die Anzeige im Währungsfilter.
-- ---------------------------------------------------------------------------
update public.listings set currency = null where price_unit = 'on_request' and currency is not null;
alter table public.listings drop constraint price_consistent;
alter table public.listings add constraint price_consistent check (
  (price_unit = 'on_request' and price_minor is null and currency is null)
  or (price_minor is null and currency is null and price_unit is null)
  or (price_minor is not null and currency is not null and price_unit is not null and price_unit <> 'on_request')
);

-- ---------------------------------------------------------------------------
-- F4: Merken nur öffentlicher, fremder Anzeigen (die Oberfläche blendet den Button für eigene aus).
-- ---------------------------------------------------------------------------
delete from public.favorites f using public.listings l where l.id = f.listing_id and l.owner_id = f.user_id;
drop policy favorites_insert_own on public.favorites;
create policy favorites_insert_own on public.favorites
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.listings l
      where l.id = listing_id and l.owner_id <> (select auth.uid())
        and private.listing_is_public(l.status, l.expires_at, l.owner_id)
    )
  );

-- ---------------------------------------------------------------------------
-- F3: Favoriten in einer Abfrage statt einer langen ID-Liste in der URL (414 ab ~220 IDs). Liefert die Karten
-- verfügbarer Anzeigen (neueste Favoriten zuerst) und die Zahl der nicht mehr verfügbaren, ohne deren Titel.
-- ---------------------------------------------------------------------------
create function public.my_favorites()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(private.listing_card(l) order by f.created_at desc, f.id desc)
      from public.favorites f join public.listings l on l.id = f.listing_id
      where f.user_id = (select auth.uid()) and l.status = 'active' and l.expires_at > now()
        and private.listing_is_public(l.status, l.expires_at, l.owner_id)
    ), '[]'::jsonb),
    'unavailable', (
      select count(*)::integer from public.favorites f
      where f.user_id = (select auth.uid())
        and not exists (
          select 1 from public.listings l
          where l.id = f.listing_id and private.listing_is_public(l.status, l.expires_at, l.owner_id)
        )
    )
  );
$$;
revoke execute on function public.my_favorites() from public, anon;
grant execute on function public.my_favorites() to authenticated;

-- Entfernt nur, was jetzt nicht öffentlich ist, in einer Anweisung (nie auf Grundlage einer fehlgeschlagenen Abfrage).
create function public.remove_unavailable_favorites()
returns integer
language sql
volatile
set search_path = ''
as $$
  with removed as (
    delete from public.favorites f
    where f.user_id = (select auth.uid())
      and not exists (
        select 1 from public.listings l
        where l.id = f.listing_id and private.listing_is_public(l.status, l.expires_at, l.owner_id)
      )
    returning 1
  )
  select count(*)::integer from removed;
$$;
revoke execute on function public.remove_unavailable_favorites() from public, anon;
grant execute on function public.remove_unavailable_favorites() to authenticated;
