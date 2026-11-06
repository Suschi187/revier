-- M8 Commit 3, Nachtrag zu 20261108110000 (Lint und Claim-Grenze):
-- - process_search_match_queue: typisierte Array-Initialisierung, Variable hits statt found (verdeckte FOUND).
-- - claim_search_notifications: p_limit zählt Mails statt Kandidaten. Kandidaten, deren Treffer beim Claim
--   ungültig oder doppelt sind, werden erledigt und belegen keinen Platz (höchstens 4 x Limit Kandidaten je Lauf);
--   Reihenfolge nach der ältesten Fälligkeit. Antwortform unverändert.

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
  s record;
  parts private.search_parts;
  hits uuid[];
  m_search uuid[] := '{}'::uuid[];
  m_listing uuid[] := '{}'::uuid[];
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
    return jsonb_build_object('listings', 0, 'searches', 0, 'matches', 0, 'failed_searches', 0, 'dropped', dropped);
  end if;

  for s in
    select ss.id, ss.user_id, ss.filters, ss.created_at
    from public.saved_searches ss
    where ss.paused_at is null and ss.expires_at > now() and ss.notify_email
      and private.is_active_user(ss.user_id)
      and exists (
        select 1 from public.listings l
        where l.id = any (ready) and l.owner_id <> ss.user_id and l.published_at > ss.created_at
          and (ss.filters ->> 'kind' is null or ss.filters ->> 'kind' = l.kind::text)
          and (ss.filters ->> 'direction' is null or ss.filters ->> 'direction' = l.direction::text)
          and (ss.filters ->> 'country' is null or ss.filters ->> 'country' = l.country::text))
  loop
    searches := searches + 1;
    begin
      parts := private.search_conditions(s.filters);
      -- $1–$4 wie in search_listings, $5 die Anzeigen des Laufs; Werte nur per USING.
      execute format(
        'select coalesce(array_agg(l.id), ''{}'') from public.listings l
         where %s and l.id = any ($5) and l.owner_id <> $6 and l.published_at > $7', parts.conds)
      into hits
      using parts.query, s.filters, parts.region_ids, parts.species, ready, s.user_id, s.created_at;
    exception when others then
      failed := failed + 1;
      continue;
    end;
    if cardinality(hits) > 0 then
      m_search := m_search || array_fill(s.id, array[cardinality(hits)]);
      m_listing := m_listing || hits;
    end if;
  end loop;

  -- Sperre in beide Richtungen erst hier (teuer, nur für echte Treffer).
  insert into private.saved_search_matches (saved_search_id, listing_id, user_id, cadence, due_at)
  select ss.id, l.id, ss.user_id, ss.cadence, l.published_at + delay
  from unnest(m_search, m_listing) as x (search_id, listing_id)
  join public.saved_searches ss on ss.id = x.search_id
  join public.listings l on l.id = x.listing_id
  where not private.is_blocked_pair(ss.user_id, l.owner_id)
  on conflict do nothing;
  get diagnostics matched = row_count;

  delete from private.search_match_queue where listing_id = any (ready);

  return jsonb_build_object('listings', cardinality(ready), 'searches', searches, 'matches', matched,
                            'failed_searches', failed, 'dropped', dropped);
end;
$$;

create or replace function public.claim_search_notifications(p_secret text, p_limit integer default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  gap interval := make_interval(mins => private.setting_int('saved_search_instant_min_gap_minutes'));
  window_days interval := make_interval(days => private.setting_int('saved_search_extend_window_days'));
  tz text := private.setting_text('saved_search_timezone');
  lim integer := least(coalesce(p_limit, private.setting_int('search_email_batch')), private.setting_int('search_email_batch'));
  local_now timestamp;
  today date;
  hour_ok boolean;
  queue_stats jsonb;
  candidates uuid[];
  r record;
  cid uuid;
  inst_due boolean;
  daily_ok boolean;
  daily_due boolean;
  recipient_ok boolean;
  has_daily boolean;
  remaining integer;
  prior_attempts integer;
  recipients jsonb := '[]'::jsonb;
  sent integer := 0;
begin
  if not private.search_notifications_secret_valid(p_secret) then
    raise exception 'Nicht erlaubt' using errcode = '42501';
  end if;

  queue_stats := private.process_search_match_queue(private.setting_int('search_match_batch'));

  local_now := now() at time zone tz;
  today := local_now::date;
  hour_ok := extract(hour from local_now) >= private.setting_int('saved_search_daily_hour');

  insert into private.search_notification_state (user_id)
  select distinct m.user_id from private.saved_search_matches m
  where m.done_at is null and m.claim_id is null and m.due_at <= now()
    and not exists (select 1 from private.search_notification_state x where x.user_id = m.user_id)
  on conflict do nothing;

  -- Kandidaten aus den offenen Treffern (älteste fällige zuerst); die Prüfung wiederholt sich unten auf der
  -- gesperrten Zeile.
  select coalesce(array_agg(x.user_id order by x.first_due, x.user_id), '{}') into candidates
  from (
    select o.user_id, o.first_due
    from (
      select m.user_id, min(m.due_at) as first_due,
             bool_or(m.cadence = 'instant') as has_instant, bool_or(m.cadence = 'daily') as has_daily
      from private.saved_search_matches m
      where m.done_at is null and m.claim_id is null and m.due_at <= now()
      group by m.user_id
    ) o
    join private.search_notification_state st on st.user_id = o.user_id
    where (o.has_instant and (st.last_sent_at is null or st.last_sent_at <= now() - gap))
       or (o.has_daily and hour_ok and (st.last_daily_on is null or st.last_daily_on < today))
    order by o.first_due, o.user_id
    -- Kandidaten ohne gültigen Treffer werden unten erledigt und belegen keinen Platz; die Liste ist begrenzt.
    limit greatest(lim, 0) * 4
  ) x;

  for r in
    select st.user_id, st.last_sent_at, st.last_daily_on
    from private.search_notification_state st
    where st.user_id = any (candidates)
    order by array_position(candidates, st.user_id)
    for update skip locked
  loop
    exit when sent >= lim;
    daily_ok := hour_ok and (r.last_daily_on is null or r.last_daily_on < today);
    inst_due := (r.last_sent_at is null or r.last_sent_at <= now() - gap) and exists (
      select 1 from private.saved_search_matches m
      where m.user_id = r.user_id and m.done_at is null and m.claim_id is null and m.due_at <= now() and m.cadence = 'instant');
    daily_due := daily_ok and exists (
      select 1 from private.saved_search_matches m
      where m.user_id = r.user_id and m.done_at is null and m.claim_id is null and m.due_at <= now() and m.cadence = 'daily');
    if not (inst_due or daily_due) then
      continue;
    end if;

    cid := gen_random_uuid();
    -- „Sofort“ gewinnt vor „täglich“ (B1): Ein täglicher Treffer wartet, solange ein Sofort-Treffer zur selben
    -- Anzeige noch nicht fällig ist. Ist der Sofort-Treffer schon in einem anderen Claim, erledigt die
    -- Entdopplung unten den täglichen als doppelt (kein Warten auf einen hängenden Claim).
    update private.saved_search_matches m
    set claim_id = cid
    where m.user_id = r.user_id and m.done_at is null and m.claim_id is null and m.due_at <= now()
      and (m.cadence = 'instant' or daily_ok)
      and not (m.cadence = 'daily' and exists (
        select 1 from private.saved_search_matches i
        where i.user_id = m.user_id and i.listing_id = m.listing_id and i.cadence = 'instant' and i.done_at is null
          and i.claim_id is null and i.due_at > now()));

    -- A3: alle Bedingungen erneut; ungültige ohne Mail erledigen.
    recipient_ok := private.is_active_user(r.user_id)
      and exists (select 1 from auth.users u where u.id = r.user_id and u.email is not null and u.email_confirmed_at is not null);
    update private.saved_search_matches m
    set done_at = now(), outcome = 'invalid', claim_id = null
    where m.claim_id = cid and (
      not recipient_ok
      or not exists (
        select 1 from public.saved_searches ss
        where ss.id = m.saved_search_id and ss.user_id = m.user_id
          and ss.paused_at is null and ss.expires_at > now() and ss.notify_email)
      or not exists (
        select 1 from public.listings l
        where l.id = m.listing_id and l.owner_id <> m.user_id
          and private.listing_is_public(l.status, l.expires_at, l.owner_id)
          and not private.is_blocked_pair(m.user_id, l.owner_id)));

    has_daily := exists (select 1 from private.saved_search_matches m where m.claim_id = cid and m.cadence = 'daily');

    -- Entdopplung je (Empfänger, Anzeige): nur neu eingetragene Anzeigen gehen in diese Mail.
    insert into private.saved_search_deliveries (user_id, listing_id, claim_id)
    select distinct r.user_id, m.listing_id, cid from private.saved_search_matches m where m.claim_id = cid
    on conflict do nothing;
    update private.saved_search_matches m
    set done_at = now(), outcome = 'duplicate', claim_id = null
    where m.claim_id = cid and not exists (
      select 1 from private.saved_search_deliveries d
      where d.user_id = r.user_id and d.listing_id = m.listing_id and d.claim_id = cid);

    select count(*), coalesce(max(m.attempts), 0) into remaining, prior_attempts
    from private.saved_search_matches m where m.claim_id = cid;
    if remaining = 0 then
      continue;
    end if;

    insert into private.search_notification_claims (claim_id, user_id, attempts, previous_sent_at, previous_daily_on, set_daily)
    values (cid, r.user_id, prior_attempts + 1, r.last_sent_at, r.last_daily_on, has_daily);
    update private.search_notification_state
    set last_sent_at = now(), last_daily_on = case when has_daily then today else last_daily_on end
    where user_id = r.user_id;

    -- Allowlist (A5): nie listing_card, map_point, Koordinaten, PLZ, Ort, Kontakt oder Anbieter.
    sent := sent + 1;
    select recipients || jsonb_build_array(jsonb_build_object(
      'claim_id', cid,
      'email', (select u.email from auth.users u where u.id = r.user_id),
      'language', p.preferred_language,
      'items', (
        select jsonb_agg(jsonb_build_object(
          'listing_id', l.id,
          'title', l.title,
          'kind', l.kind,
          'direction', l.direction,
          'district_code', d.code,
          'district_name', case p.preferred_language when 'de' then d.name_de when 'cs' then d.name_cs
                                                     when 'pl' then d.name_pl else d.name_en end,
          'state_code', st.code,
          'state_name', case p.preferred_language when 'de' then st.name_de when 'cs' then st.name_cs
                                                  when 'pl' then st.name_pl else st.name_en end,
          'price_minor', l.price_minor,
          'currency', l.currency,
          'price_unit', l.price_unit
        ) order by l.published_at desc, l.id)
        from public.listings l
        join public.regions d on d.id = l.region_id
        join public.regions st on st.id = d.parent_id
        where l.id in (select m.listing_id from private.saved_search_matches m where m.claim_id = cid)),
      'searches', (
        select jsonb_agg(jsonb_build_object(
          'id', ss.id,
          'name', ss.name,
          'expires_at', ss.expires_at,
          'extendable', now() >= ss.expires_at - window_days
        ) order by ss.created_at, ss.id)
        from public.saved_searches ss
        where ss.id in (select m.saved_search_id from private.saved_search_matches m where m.claim_id = cid))
    ))
    into recipients
    from public.profiles p where p.user_id = r.user_id;
  end loop;

  return jsonb_build_object('queue', queue_stats, 'recipients', recipients);
end;
$$;
