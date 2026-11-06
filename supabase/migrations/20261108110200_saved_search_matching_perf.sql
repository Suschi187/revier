-- M8 Commit 3, Nachtrag zu 20261108110000/20261108110100 (Lastmessung A4): Der Abgleich führt die gemeinsamen
-- Bedingungen einmal je verschiedenem Filter statt je Auftrag aus (gleiche Filter vieler Nutzer, z. B. „Jagdpacht
-- in DE“), und die Sperre in beide Richtungen wird als Anti-Join geprüft (gleiche Bedingung wie
-- private.is_blocked_pair, aber ohne Funktionsaufruf je Treffer). Ergebnis und Antwortform unverändert, dazu der
-- Zähler filters.
create or replace function private.process_search_match_queue(p_budget integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  delay interval := make_interval(mins => private.setting_int('saved_search_instant_delay_minutes'));
  ready uuid[];
  dropped integer;
  g record;
  parts private.search_parts;
  hits uuid[];
  n integer;
  groups integer := 0;
  searches integer := 0;
  failed integer := 0;
  matched integer := 0;
begin
  delete from private.search_match_queue q
  where q.queued_at < now() - interval '24 hours'
    and not exists (select 1 from public.listings l
                    where l.id = q.listing_id and private.listing_is_public(l.status, l.expires_at, l.owner_id));
  get diagnostics dropped = row_count;

  select coalesce(array_agg(x.listing_id), '{}') into ready
  from (
    select q.listing_id
    from private.search_match_queue q
    join public.listings l on l.id = q.listing_id
    where private.listing_is_public(l.status, l.expires_at, l.owner_id)
    order by q.queued_at, q.listing_id
    limit greatest(coalesce(p_budget, 0), 0)
    for update of q skip locked
  ) x;

  if cardinality(ready) = 0 then
    return jsonb_build_object('listings', 0, 'searches', 0, 'filters', 0, 'matches', 0, 'failed_searches', 0,
                              'dropped', dropped);
  end if;

  -- In Frage kommende Aufträge (Vorfilter in plain SQL), gruppiert nach gleichen Filtern.
  for g in
    select ss.filters, array_agg(ss.id) as ids
    from public.saved_searches ss
    where ss.paused_at is null and ss.expires_at > now() and ss.notify_email
      and private.is_active_user(ss.user_id)
      and exists (
        select 1 from public.listings l
        where l.id = any (ready) and l.owner_id <> ss.user_id and l.published_at > ss.created_at
          and (ss.filters ->> 'kind' is null or ss.filters ->> 'kind' = l.kind::text)
          and (ss.filters ->> 'direction' is null or ss.filters ->> 'direction' = l.direction::text)
          and (ss.filters ->> 'country' is null or ss.filters ->> 'country' = l.country::text))
    group by ss.filters
  loop
    groups := groups + 1;
    searches := searches + cardinality(g.ids);
    -- Eigener Ausnahmeblock (B3); er liest nur, geschrieben wird danach (keine Subtransaktions-XID je Filter).
    begin
      parts := private.search_conditions(g.filters);
      -- $1–$4 wie in search_listings, $5 die Anzeigen des Laufs; Werte nur per USING.
      execute format(
        'select coalesce(array_agg(l.id), ''{}'') from public.listings l where %s and l.id = any ($5)', parts.conds)
      into hits
      using parts.query, g.filters, parts.region_ids, parts.species, ready;
    exception when others then
      failed := failed + cardinality(g.ids);
      continue;
    end;
    if cardinality(hits) = 0 then
      continue;
    end if;
    -- Je Auftrag: fremde Anzeige, vor der Freigabe angelegt, keine Sperre in eine der beiden Richtungen.
    insert into private.saved_search_matches (saved_search_id, listing_id, user_id, cadence, due_at)
    select ss.id, l.id, ss.user_id, ss.cadence, l.published_at + delay
    from public.saved_searches ss
    join public.listings l on l.id = any (hits)
    where ss.id = any (g.ids) and l.owner_id <> ss.user_id and l.published_at > ss.created_at
      and not exists (
        select 1 from public.blocks b
        where (b.blocker_id = ss.user_id and b.blocked_id = l.owner_id)
           or (b.blocker_id = l.owner_id and b.blocked_id = ss.user_id))
    on conflict do nothing;
    get diagnostics n = row_count;
    matched := matched + n;
  end loop;

  delete from private.search_match_queue where listing_id = any (ready);

  return jsonb_build_object('listings', cardinality(ready), 'searches', searches, 'filters', groups,
                            'matches', matched, 'failed_searches', failed, 'dropped', dropped);
end;
$$;
