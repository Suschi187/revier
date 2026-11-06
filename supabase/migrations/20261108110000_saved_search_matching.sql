-- M8 Commit 3 (ADR 018, Plan M8 4.3, 4.4, Review B1–B3, A1–A5, A9–A11, H2, H7, H8): Abgleich der Suchaufträge
-- bei der ersten Freigabe, Entdopplung je (Empfänger, Anzeige), Claim/Confirm/Release mit claim_id, Cron.
--
-- Ablauf:
-- 1. AFTER-Trigger auf listings: published_at wechselt von null auf einen Wert (erste Freigabe) -> Warteschlange.
-- 2. private.process_search_match_queue (am Anfang jedes Claims): je in Frage kommendem Auftrag eine Ausführung
--    über private.search_conditions plus l.id = any($5) -> private.saved_search_matches.
-- 3. claim_search_notifications: fällige Empfänger sperren (skip locked), alle Bedingungen erneut prüfen (A3),
--    entdoppeln (B1), Zustand je Empfänger setzen (B2), Mailinhalt per Allowlist liefern (A5).
-- 4. confirm/release nur über claim_id (überlappende Läufe), höchstens 3 Versuche.
-- Technische Akzeptanz: höchstens eine Mail je (Empfänger, Anzeige), im Normalfall genau eine.

insert into private.app_settings (key, value, description) values
  ('saved_search_timezone', '"Europe/Berlin"', 'Zeitzone für Stunde und Kalendertag der täglichen Sammelmail (ADR 018)'),
  ('search_match_batch', '50', 'Höchstzahl Anzeigen je Lauf des Abgleichs der Suchaufträge (ADR 018, A4)');

-- ---------------------------------------------------------------------------
-- Tabellen (alle in private: RLS an, keine Grants; nur Definer-Funktionen greifen zu)
-- ---------------------------------------------------------------------------
-- Neu freigegebene Anzeigen, die noch abzugleichen sind.
create table private.search_match_queue (
  listing_id uuid primary key references public.listings (id) on delete cascade,
  queued_at timestamptz not null default now()
);
create index search_match_queue_queued_idx on private.search_match_queue (queued_at);

-- Versand je Claim. previous_* stellt release wieder her, aber nur, wenn kein späterer Claim den Zustand überschrieb.
create table private.search_notification_claims (
  claim_id uuid primary key,
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  claimed_at timestamptz not null default now(),
  confirmed_at timestamptz,
  released_at timestamptz,
  attempts integer not null default 1,
  previous_sent_at timestamptz,
  previous_daily_on date,
  set_daily boolean not null default false,
  check (confirmed_at is null or released_at is null)
);
create index search_notification_claims_user_idx on private.search_notification_claims (user_id);
create index search_notification_claims_claimed_idx on private.search_notification_claims (claimed_at);

-- Treffer je (Auftrag, Anzeige). claim_id ohne FK: ungültige und doppelte Treffer werden ohne Claim erledigt.
-- outcome: sent (bestätigt), duplicate (Anzeige ging schon mit einer anderen Mail), invalid (Bedingung beim Claim
-- nicht mehr erfüllt), failed (3 Versuche).
create table private.saved_search_matches (
  saved_search_id uuid not null references public.saved_searches (id) on delete cascade,
  listing_id uuid not null references public.listings (id) on delete cascade,
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  cadence public.saved_search_cadence not null,
  matched_at timestamptz not null default now(),
  due_at timestamptz not null,
  claim_id uuid,
  attempts integer not null default 0,
  done_at timestamptz,
  outcome text check (outcome in ('sent', 'duplicate', 'invalid', 'failed')),
  primary key (saved_search_id, listing_id),
  check ((done_at is null) = (outcome is null))
);
create index saved_search_matches_open_idx on private.saved_search_matches (user_id, due_at)
  where done_at is null and claim_id is null;
create index saved_search_matches_claim_idx on private.saved_search_matches (claim_id) where claim_id is not null;
create index saved_search_matches_listing_idx on private.saved_search_matches (user_id, listing_id);
create index saved_search_matches_listing_fk_idx on private.saved_search_matches (listing_id);
create index saved_search_matches_retention_idx on private.saved_search_matches ((coalesce(done_at, matched_at)));

-- Entdopplung je (Empfänger, Anzeige) (B1): beim Claim geschrieben, nur neu eingefügte gehen in die Mail.
create table private.saved_search_deliveries (
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  listing_id uuid not null references public.listings (id) on delete cascade,
  claim_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);
create index saved_search_deliveries_listing_idx on private.saved_search_deliveries (listing_id);
create index saved_search_deliveries_claim_idx on private.saved_search_deliveries (claim_id);
create index saved_search_deliveries_created_idx on private.saved_search_deliveries (created_at);

-- Zustand je Empfänger (B2), beim Claim gesetzt: letzte Mail (Mindestabstand für „sofort“) und Kalendertag der
-- letzten Mail mit täglichen Treffern (in saved_search_timezone).
create table private.search_notification_state (
  user_id uuid primary key references public.profiles (user_id) on delete cascade,
  last_sent_at timestamptz,
  last_daily_on date
);

alter table private.search_match_queue enable row level security;
alter table private.search_notification_claims enable row level security;
alter table private.saved_search_matches enable row level security;
alter table private.saved_search_deliveries enable row level security;
alter table private.search_notification_state enable row level security;
revoke all on private.search_match_queue, private.search_notification_claims, private.saved_search_matches,
  private.saved_search_deliveries, private.search_notification_state from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Auslöser (A2): nur die erste Freigabe. Nicht `after update of published_at`: published_at setzt der
-- BEFORE-Trigger listings_zz_publication_fields, die Spaltenliste bezieht sich auf die SET-Liste des Statements.
-- ---------------------------------------------------------------------------
create function private.listings_search_match_enqueue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.search_match_queue (listing_id) values (new.id) on conflict do nothing;
  return null;
end;
$$;
revoke execute on function private.listings_search_match_enqueue() from public, anon, authenticated, service_role;

create trigger listings_search_match_insert
  after insert on public.listings
  for each row when (new.published_at is not null)
  execute function private.listings_search_match_enqueue();

create trigger listings_search_match_update
  after update on public.listings
  for each row when (old.published_at is null and new.published_at is not null)
  execute function private.listings_search_match_enqueue();

-- ---------------------------------------------------------------------------
-- Abgleich (A1, A4, B3)
-- ---------------------------------------------------------------------------
-- Verarbeitet höchstens p_budget öffentliche Anzeigen aus der Warteschlange (älteste zuerst). Nicht (noch)
-- öffentliche bleiben bis 24 h liegen und belegen kein Budget, danach werden sie verworfen.
-- Je in Frage kommendem Auftrag eine Ausführung der gemeinsamen Bedingungen (search_conditions) über alle
-- Anzeigen des Laufs; Vorfilter in plain SQL über kind, direction, country. Ein fehlerhafter Auftrag wird im
-- eigenen Ausnahmeblock gezählt und übersprungen. Der Block liest nur (keine Subtransaktions-XID je Auftrag),
-- geschrieben wird einmal am Ende.
create function private.process_search_match_queue(p_budget integer)
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
  found uuid[];
  m_search uuid[] := '{}';
  m_listing uuid[] := '{}';
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
      into found
      using parts.query, s.filters, parts.region_ids, parts.species, ready, s.user_id, s.created_at;
    exception when others then
      failed := failed + 1;
      continue;
    end;
    if cardinality(found) > 0 then
      m_search := m_search || array_fill(s.id, array[cardinality(found)]);
      m_listing := m_listing || found;
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
revoke execute on function private.process_search_match_queue(integer) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Geheimnis (A10): zufällig erzeugt, nie im Repo. Die URL (search_notifications_url) setzt erst die Checkliste.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'search_notifications_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'search_notifications_secret',
      'Aufruf der Edge Function send-search-notifications durch pg_cron (ADR 018).');
  end if;
end;
$$;

create function private.search_notifications_secret_valid(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- Vergleich über Hashes gleicher Länge: keine Zeitunterschiede je übereinstimmendem Präfix.
  select p_secret is not null and exists (
    select 1 from vault.decrypted_secrets s
    where s.name = 'search_notifications_secret'
      and extensions.digest(s.decrypted_secret, 'sha256') = extensions.digest(p_secret, 'sha256')
  );
$$;
revoke execute on function private.search_notifications_secret_valid(text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Claim (B1, B2, A3, A5): je Empfänger eine Mail; nur service_role, kein p_now (A11)
-- ---------------------------------------------------------------------------
-- Antwort: {"queue": {Zähler des Abgleichs}, "recipients": [{"claim_id", "email", "language",
--   "items": [{"listing_id", "title", "kind", "direction", "district_code", "district_name", "state_code",
--              "state_name", "price_minor", "currency", "price_unit"}],
--   "searches": [{"id", "name", "expires_at", "extendable"}]}]}
-- Fällig: „sofort“ ab due_at (Freigabe + saved_search_instant_delay_minutes), letzte Mail mindestens
-- saved_search_instant_min_gap_minutes her; „täglich“ ab saved_search_daily_hour (saved_search_timezone), höchstens
-- einmal je Kalendertag. Eine Mail enthält alle fälligen Treffer des Empfängers; eine Anzeige nur einmal.
create function public.claim_search_notifications(p_secret text, p_limit integer default null)
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
  recipients jsonb := '[]';
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
  select coalesce(array_agg(x.user_id), '{}') into candidates
  from (
    select o.user_id
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
    limit greatest(lim, 0)
  ) x;

  for r in
    select st.user_id, st.last_sent_at, st.last_daily_on
    from private.search_notification_state st
    where st.user_id = any (candidates)
    order by st.user_id
    for update skip locked
  loop
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
    recipients := recipients || jsonb_build_array(jsonb_build_object(
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
    from public.profiles p where p.user_id = r.user_id;
  end loop;

  return jsonb_build_object('queue', queue_stats, 'recipients', recipients);
end;
$$;

-- Erfolg: Treffer erledigt, last_notified_at als reine Anzeige (Server-Pfad, Schutz-Trigger lässt ihn zu).
create function public.confirm_search_notifications(p_secret text, p_claim_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  confirmed uuid[];
begin
  if not private.search_notifications_secret_valid(p_secret) then
    raise exception 'Nicht erlaubt' using errcode = '42501';
  end if;
  with c as (
    update private.search_notification_claims c
    set confirmed_at = now()
    where c.claim_id = any (p_claim_ids) and c.confirmed_at is null and c.released_at is null
    returning c.claim_id
  )
  select coalesce(array_agg(claim_id), '{}') into confirmed from c;

  with m as (
    update private.saved_search_matches m
    set done_at = now(), outcome = 'sent'
    where m.claim_id = any (confirmed) and m.done_at is null
    returning m.saved_search_id
  )
  update public.saved_searches s set last_notified_at = now()
  where s.id in (select saved_search_id from m);

  return cardinality(confirmed);
end;
$$;

-- Fehler: Treffer wieder frei und Zustand zurück (nur, wenn kein späterer Claim ihn überschrieb). Höchstens 3
-- Versuche je Treffer, danach ist die Mail verloren (at-most-once) und die Anzeige bleibt als zugestellt markiert.
create function public.release_search_notifications(p_secret text, p_claim_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
  reopened integer;
  released integer := 0;
begin
  if not private.search_notifications_secret_valid(p_secret) then
    raise exception 'Nicht erlaubt' using errcode = '42501';
  end if;
  for c in
    update private.search_notification_claims x
    set released_at = now()
    where x.claim_id = any (p_claim_ids) and x.confirmed_at is null and x.released_at is null
    returning x.claim_id, x.user_id, x.claimed_at, x.previous_sent_at, x.previous_daily_on, x.set_daily
  loop
    released := released + 1;
    update private.saved_search_matches m
    set attempts = m.attempts + 1, done_at = now(), outcome = 'failed'
    where m.claim_id = c.claim_id and m.done_at is null and m.attempts + 1 >= 3;

    with m as (
      update private.saved_search_matches m
      set attempts = m.attempts + 1, claim_id = null
      where m.claim_id = c.claim_id and m.done_at is null
      returning m.listing_id
    )
    delete from private.saved_search_deliveries d
    where d.user_id = c.user_id and d.claim_id = c.claim_id and d.listing_id in (select listing_id from m);
    get diagnostics reopened = row_count;

    if reopened > 0 then
      update private.search_notification_state st
      set last_sent_at = c.previous_sent_at,
          last_daily_on = case when c.set_daily then c.previous_daily_on else st.last_daily_on end
      where st.user_id = c.user_id and st.last_sent_at = c.claimed_at;
    end if;
  end loop;
  return released;
end;
$$;

revoke execute on function public.claim_search_notifications(text, integer) from public, anon, authenticated;
revoke execute on function public.confirm_search_notifications(text, uuid[]) from public, anon, authenticated;
revoke execute on function public.release_search_notifications(text, uuid[]) from public, anon, authenticated;
grant execute on function public.claim_search_notifications(text, integer) to service_role;
grant execute on function public.confirm_search_notifications(text, uuid[]) to service_role;
grant execute on function public.release_search_notifications(text, uuid[]) to service_role;

-- ---------------------------------------------------------------------------
-- Auslöser: pg_cron jede Minute (wie ADR 017). Ohne URL im Vault (lokal, CI) macht der Job nichts.
-- ---------------------------------------------------------------------------
create function private.trigger_search_notifications()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  url text;
  secret text;
begin
  select s.decrypted_secret into url from vault.decrypted_secrets s where s.name = 'search_notifications_url';
  select s.decrypted_secret into secret from vault.decrypted_secrets s where s.name = 'search_notifications_secret';
  if url is null or secret is null then
    return;
  end if;
  perform net.http_post(
    url := url,
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-search-notify-secret', secret),
    timeout_milliseconds := 20000
  );
end;
$$;
revoke execute on function private.trigger_search_notifications() from public, anon, authenticated, service_role;

select cron.schedule('search-notifications', '* * * * *', 'select private.trigger_search_notifications()');

-- ---------------------------------------------------------------------------
-- Retention (ADR 008, A9)
-- ---------------------------------------------------------------------------
-- Warteschlange nach 24 h; Treffer, Entdopplung, Claims 30 Tage nach Erledigung (auch geclaimt-unbestätigte,
-- gerechnet ab dem Treffer bzw. Claim); Zustand ohne offene Treffer und ohne Mail seit 30 Tagen.
create function private.purge_search_notifications()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cutoff timestamptz := now() - interval '30 days';
  q integer;
  m integer;
  d integer;
  c integer;
  s integer;
begin
  delete from private.search_match_queue where queued_at < now() - interval '24 hours';
  get diagnostics q = row_count;
  delete from private.saved_search_matches where coalesce(done_at, matched_at) < cutoff;
  get diagnostics m = row_count;
  delete from private.saved_search_deliveries where created_at < cutoff;
  get diagnostics d = row_count;
  delete from private.search_notification_claims where claimed_at < cutoff;
  get diagnostics c = row_count;
  delete from private.search_notification_state st
  where coalesce(st.last_sent_at, '-infinity') < cutoff
    and not exists (select 1 from private.saved_search_matches x where x.user_id = st.user_id and x.done_at is null);
  get diagnostics s = row_count;
  return jsonb_build_object('queue', q, 'matches', m, 'deliveries', d, 'claims', c, 'state', s);
end;
$$;
revoke execute on function private.purge_search_notifications() from public, anon, authenticated, service_role;

select cron.schedule('search-notifications-retention', '27 3 * * *', 'select private.purge_search_notifications()');
