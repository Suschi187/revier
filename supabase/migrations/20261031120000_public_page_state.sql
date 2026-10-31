-- M5 Commit 4 (Plan M5, ADR 015): Zustand öffentlicher Seiten (A3, A4), Anzeigen eines Anbieters, Cache-Zähler
-- für sofortige Wirkung von Entfernen, Sperren und Löschen (Nutzer-Entscheidung 2026-10-31).

-- ---------------------------------------------------------------------------
-- Zustand: 'public', 'gone' (einmal öffentlich, jetzt nicht; Grund wird nie unterschieden) oder null.
-- Definer, weil anon nicht öffentliche Zeilen nicht sieht; verrät nur, dass eine ID einmal öffentlich war.
-- ---------------------------------------------------------------------------
create function public.public_page_state(p_kind text, p_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_kind = 'listing' then
    return (
      select case when private.listing_is_public(l.status, l.expires_at, l.owner_id) then 'public'
                  when l.published_at is not null then 'gone' end
      from public.listings l where l.id = p_id);
  elsif p_kind = 'provider' then
    if exists (select 1 from public.listings l
               where l.owner_id = p_id and private.listing_is_public(l.status, l.expires_at, l.owner_id)) then
      return 'public';
    elsif exists (select 1 from public.listings l where l.owner_id = p_id and l.published_at is not null) then
      return 'gone';
    end if;
    return null;
  end if;
  raise exception 'Unbekannte Seitenart' using errcode = '22023', hint = 'kind';
end;
$$;
revoke execute on function public.public_page_state(text, uuid) from public;
grant execute on function public.public_page_state(text, uuid) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Anzeigen eines Anbieters (Profilseite): gleiche Treffer wie die Suche, neueste zuerst. Bewusst kein
-- Schlüssel im Filterformat, damit Suchaufträge (M8) nicht auf Personen zielen.
-- ---------------------------------------------------------------------------
create function public.provider_listings(p_owner uuid, p_cursor text default null, p_limit integer default 20)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  cursor_at timestamptz;
  cursor_id uuid;
  cursor_data jsonb;
  rows jsonb;
  more boolean;
begin
  if p_owner is null then
    raise exception 'Anbieter fehlt' using errcode = '22023', hint = 'owner';
  end if;
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception 'Ungültiges Limit' using errcode = '22023', hint = 'limit';
  end if;
  if p_cursor is not null then
    begin
      if char_length(p_cursor) > 200 then raise exception 'zu lang'; end if;
      cursor_data := convert_from(decode(rpad(translate(p_cursor, '-_', '+/'), (char_length(p_cursor) + 3) / 4 * 4, '='), 'base64'), 'utf8')::jsonb;
      if cursor_data ->> 'h' is distinct from md5(p_owner::text) then raise exception 'unpassend'; end if;
      cursor_at := (cursor_data ->> 'k')::timestamptz;
      cursor_id := (cursor_data ->> 'i')::uuid;
    exception when others then
      raise exception 'Ungültiger Cursor' using errcode = '22023', hint = 'cursor';
    end;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('card', private.listing_card(x.rec), 'k', x.published_at::text, 'i', x.id)
                            order by x.published_at desc, x.id desc), '[]')
  into rows
  from (
    select l as rec, l.published_at, l.id from public.listings l
    where l.owner_id = p_owner and l.status = 'active' and l.expires_at > now()
      and private.listing_is_public(l.status, l.expires_at, l.owner_id)
      and (cursor_at is null or (l.published_at, l.id) < (cursor_at, cursor_id))
    order by l.published_at desc, l.id desc
    limit p_limit + 1
  ) x;

  more := jsonb_array_length(rows) > p_limit;
  return jsonb_build_object(
    'items', (select coalesce(jsonb_agg(e -> 'card' order by n), '[]') from jsonb_array_elements(rows) with ordinality t(e, n) where n <= p_limit),
    'next_cursor', case when more then
      translate(rtrim(encode(convert_to(jsonb_build_object('h', md5(p_owner::text), 'k', rows -> (p_limit - 1) ->> 'k',
                                                            'i', rows -> (p_limit - 1) ->> 'i')::text, 'utf8'), 'base64'), '='), E'+/\n', '-_')
    end
  );
end;
$$;
revoke execute on function public.provider_listings(uuid, text, integer) from public;
grant execute on function public.provider_listings(uuid, text, integer) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Cache-Zähler (ADR 015 „Cache“): steigt bei Entfernen, Sperren und Konto-Löschung, auf allen Pfaden. Die
-- Web-App liest ihn je Anfrage und gibt ihn in jeden Cache-Schlüssel, so verfehlt jede Instanz sofort ihren Cache.
-- ---------------------------------------------------------------------------
create table private.public_cache_epoch (
  id boolean primary key default true check (id),
  epoch bigint not null default 0,
  changed_at timestamptz not null default now()
);
alter table private.public_cache_epoch enable row level security;
insert into private.public_cache_epoch default values;

create function private.bump_public_cache_epoch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.public_cache_epoch set epoch = epoch + 1, changed_at = now() where id;
  return null;
end;
$$;
revoke execute on function private.bump_public_cache_epoch() from public, anon, authenticated;

create trigger listings_removed_bump_cache
  after update of status on public.listings
  for each row when (new.status = 'removed' and old.status is distinct from 'removed')
  execute function private.bump_public_cache_epoch();

create trigger profiles_blocked_bump_cache
  after update of is_blocked, deleted_at on public.profiles
  for each row when ((new.is_blocked and not old.is_blocked) or (new.deleted_at is not null and old.deleted_at is null))
  execute function private.bump_public_cache_epoch();

-- Konto-Löschung: auth.users → profiles (Kaskade) → listings. Eine Erhöhung je Anweisung genügt.
create trigger profiles_deleted_bump_cache
  after delete on public.profiles
  for each statement execute function private.bump_public_cache_epoch();

create function public.public_cache_epoch()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select epoch from private.public_cache_epoch where id;
$$;
revoke execute on function public.public_cache_epoch() from public;
grant execute on function public.public_cache_epoch() to anon, authenticated, service_role;
