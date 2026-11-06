-- M8 Commit 4 (ADR 018, Plan M8 4.5, 4.6, Review B4, A2, A5, A6, A8–A11): Moderations-Mails und Abbestell-Token.
--
-- 1. Moderations-Mails (A2, A8): Ein Definer-Trigger auf listings.status (Bedingung wie listings_audit, aber nur
--    die Moderation an fremden Anzeigen, also wie `moderator` in listings_guard) schreibt
--    private.moderation_notifications bei Freigabe, Änderungswunsch, Ablehnung und Entfernung. Begründung aus der
--    Zeile (reject_code, reject_reason), nie die Identität des Admins. Server-Pfade (postgres, service_role) und
--    Besitzer-Wechsel (Pausieren, Fortsetzen, Zurückziehen) erzeugen nichts. Dienstmails ohne Abbestellen, auch an
--    gesperrte Besitzer, nicht an gelöschte. Versand über send-search-notifications mit demselben Geheimnis
--    (search_notifications_secret), claim/confirm/release nur über claim_id, höchstens 3 Versuche.
-- 2. Abbestell-Token (B4, A6): 32 zufällige Bytes, an die Function als Hex (64 Zeichen [0-9a-f]), gespeichert nur
--    der SHA-256. Der Such-Claim erzeugt je Mail einen Token (Scope saved_search_mail, Ziele = Aufträge der Mail),
--    der Chat-Claim je Mail einen Token (Scope chat). unsubscribe(p_token) ist für anon und authenticated
--    ausführbar, macht für gültige und ungültige Token dieselbe Arbeit und gibt immer void zurück.
-- 3. Retention (A9): Moderations-Mails 30 Tage nach Erledigung, Token 90 Tage.

insert into private.app_settings (key, value, description) values
  ('moderation_email_batch', '50', 'Höchstzahl Moderations-Mails je Lauf (ADR 018)'),
  ('unsubscribe_token_days', '90', 'Gültigkeit und Aufbewahrung der Abbestell-Token in Tagen (ADR 018, ADR 008)');

-- ---------------------------------------------------------------------------
-- Tabellen (private: RLS an, keine Grants; nur Definer-Funktionen greifen zu)
-- ---------------------------------------------------------------------------
-- Eine Zeile je Moderationsentscheidung. Kein Akteur: Die Mail nennt nie den Admin (das Audit hält ihn fest).
-- done_at: bestätigt (sent_at gesetzt), nach 3 Versuchen aufgegeben oder beim Claim nicht zustellbar.
create table private.moderation_notifications (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  owner_id uuid not null references public.profiles (user_id) on delete cascade,
  decision text not null check (decision in ('approved', 'changes_requested', 'rejected', 'removed')),
  reject_code text,
  reason text,
  created_at timestamptz not null default now(),
  claim_id uuid,
  claimed_at timestamptz,
  sent_at timestamptz,
  attempts integer not null default 0,
  done_at timestamptz,
  check ((claim_id is null) = (claimed_at is null)),
  check (sent_at is null or done_at is not null),
  check (decision <> 'approved' or (reject_code is null and reason is null))
);
create index moderation_notifications_open_idx on private.moderation_notifications (created_at, id)
  where done_at is null and claim_id is null;
create index moderation_notifications_claim_idx on private.moderation_notifications (claim_id) where claim_id is not null;
create index moderation_notifications_listing_idx on private.moderation_notifications (listing_id);
create index moderation_notifications_owner_idx on private.moderation_notifications (owner_id);
create index moderation_notifications_retention_idx on private.moderation_notifications
  ((coalesce(done_at, claimed_at, created_at)));

-- Nur der Hash des Tokens. Scope chat ohne Ziele, saved_search_mail mit den Aufträgen der Mail.
create table private.unsubscribe_tokens (
  token_hash bytea primary key check (octet_length(token_hash) = 32),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  scope text not null check (scope in ('saved_search_mail', 'chat')),
  target_ids uuid[] not null default '{}'::uuid[],
  created_at timestamptz not null default now(),
  check ((scope = 'chat') = (cardinality(target_ids) = 0))
);
create index unsubscribe_tokens_user_idx on private.unsubscribe_tokens (user_id);
create index unsubscribe_tokens_created_idx on private.unsubscribe_tokens (created_at);

alter table private.moderation_notifications enable row level security;
alter table private.unsubscribe_tokens enable row level security;
revoke all on private.moderation_notifications, private.unsubscribe_tokens
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Moderations-Mails: Auslöser (A2)
-- ---------------------------------------------------------------------------
-- Nur Moderation an fremden Anzeigen (is_admin und nicht Besitzer, wie `moderator` in listings_guard; der Guard
-- erlaubt Moderatoren nur diese Wechsel). Ein Admin, der seine eigene Anzeige pausiert oder fortsetzt, und
-- Server-Pfade erzeugen nichts.
create function private.listings_moderation_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  decision text;
begin
  if new.status is not distinct from old.status
     or not private.is_admin() or new.owner_id is not distinct from (select auth.uid()) then
    return null;
  end if;
  decision := case
    when old.status = 'pending_review' and new.status = 'active' then 'approved'
    when old.status = 'pending_review' and new.status = 'draft' and new.reject_code is not null then 'changes_requested'
    when new.status = 'rejected' then 'rejected'
    when new.status = 'removed' then 'removed'
  end;
  if decision is null then
    return null;
  end if;
  insert into private.moderation_notifications (listing_id, owner_id, decision, reject_code, reason)
  values (new.id, new.owner_id, decision,
          case when decision <> 'approved' then new.reject_code end,
          case when decision <> 'approved' then new.reject_reason end);
  return null;
end;
$$;
revoke execute on function private.listings_moderation_notify() from public, anon, authenticated, service_role;

create trigger listings_moderation_notify
  after update of status on public.listings
  for each row execute function private.listings_moderation_notify();

-- ---------------------------------------------------------------------------
-- Moderations-Mails: Claim, Confirm, Release (nur service_role, Geheimnis wie die Suchauftrags-Mails)
-- ---------------------------------------------------------------------------
-- Antwort: [{"claim_id", "email", "language", "decision", "reject_code", "reason", "listing_id", "title"}], je
-- Entscheidung eine Mail. Gelöschte Besitzer und Konten ohne bestätigte E-Mail: ohne Mail erledigt. Gesperrte
-- Besitzer bekommen die Mail (DSA Art. 17). Ein geclaimter Eintrag wird nur nach einem Release erneut geclaimt.
create function public.claim_moderation_notifications(p_secret text, p_limit integer default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  lim integer := least(coalesce(p_limit, private.setting_int('moderation_email_batch')),
                       private.setting_int('moderation_email_batch'));
  result jsonb;
begin
  if not private.search_notifications_secret_valid(p_secret) then
    raise exception 'Nicht erlaubt' using errcode = '42501';
  end if;

  update private.moderation_notifications n
  set done_at = now()
  where n.id in (
    select x.id from private.moderation_notifications x
    where x.done_at is null and x.claim_id is null
      and not exists (
        select 1 from public.profiles p join auth.users u on u.id = p.user_id
        where p.user_id = x.owner_id and p.deleted_at is null and u.email is not null and u.email_confirmed_at is not null)
    for update of x skip locked);

  with picked as (
    select x.id from private.moderation_notifications x
    where x.done_at is null and x.claim_id is null
    order by x.created_at, x.id
    limit greatest(lim, 0)
    for update of x skip locked
  ),
  claimed as (
    update private.moderation_notifications n
    set claim_id = gen_random_uuid(), claimed_at = now()
    from picked
    where n.id = picked.id
    returning n.claim_id, n.owner_id, n.decision, n.reject_code, n.reason, n.listing_id, n.created_at
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'claim_id', c.claim_id,
      'email', u.email,
      'language', p.preferred_language,
      'decision', c.decision,
      'reject_code', c.reject_code,
      'reason', c.reason,
      'listing_id', c.listing_id,
      'title', l.title
    ) order by c.created_at, c.claim_id), '[]'::jsonb)
  into result
  from claimed c
  join public.profiles p on p.user_id = c.owner_id
  join auth.users u on u.id = c.owner_id
  join public.listings l on l.id = c.listing_id;

  return result;
end;
$$;

create function public.confirm_moderation_notifications(p_secret text, p_claim_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  confirmed integer;
begin
  if not private.search_notifications_secret_valid(p_secret) then
    raise exception 'Nicht erlaubt' using errcode = '42501';
  end if;
  update private.moderation_notifications n
  set sent_at = now(), done_at = now()
  where n.claim_id = any (p_claim_ids) and n.done_at is null;
  get diagnostics confirmed = row_count;
  return confirmed;
end;
$$;

-- Fehler: wieder frei (neue claim_id beim nächsten Claim), nach dem 3. Versuch aufgegeben (at-most-once).
create function public.release_moderation_notifications(p_secret text, p_claim_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  released integer;
begin
  if not private.search_notifications_secret_valid(p_secret) then
    raise exception 'Nicht erlaubt' using errcode = '42501';
  end if;
  update private.moderation_notifications n
  set attempts = n.attempts + 1,
      done_at = case when n.attempts + 1 >= 3 then now() end,
      claim_id = case when n.attempts + 1 >= 3 then n.claim_id end,
      claimed_at = case when n.attempts + 1 >= 3 then n.claimed_at end
  where n.claim_id = any (p_claim_ids) and n.done_at is null;
  get diagnostics released = row_count;
  return released;
end;
$$;

revoke execute on function public.claim_moderation_notifications(text, integer) from public, anon, authenticated;
revoke execute on function public.confirm_moderation_notifications(text, uuid[]) from public, anon, authenticated;
revoke execute on function public.release_moderation_notifications(text, uuid[]) from public, anon, authenticated;
grant execute on function public.claim_moderation_notifications(text, integer) to service_role;
grant execute on function public.confirm_moderation_notifications(text, uuid[]) to service_role;
grant execute on function public.release_moderation_notifications(text, uuid[]) to service_role;

-- ---------------------------------------------------------------------------
-- Abbestell-Token (B4, A6)
-- ---------------------------------------------------------------------------
-- Erzeugt einen Token und speichert nur seinen SHA-256. Der Klartext (Hex) geht einmal an die Function.
create function private.issue_unsubscribe_token(p_user_id uuid, p_scope text, p_target_ids uuid[])
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  raw bytea := extensions.gen_random_bytes(32);
begin
  insert into private.unsubscribe_tokens (token_hash, user_id, scope, target_ids)
  values (extensions.digest(raw, 'sha256'), p_user_id, p_scope, coalesce(p_target_ids, '{}'::uuid[]));
  return encode(raw, 'hex');
end;
$$;
revoke execute on function private.issue_unsubscribe_token(uuid, text, uuid[]) from public, anon, authenticated, service_role;

-- Abbestellen per Klick (RFC 8058). Immer void, nie ein Fehler, gleiche Arbeit für gültige und ungültige Token:
-- Format prüfen, Hash berechnen (bei ungültigem Format der eines Dummys), nachschlagen, beide Updates ausführen
-- (ohne Treffer ändern sie nichts). Bereits abbestellt ist kein Fehler; der Token bleibt bis zum Ablauf gültig.
-- E-Mail aus geht immer (auch gesperrt, ohne Zustimmung): Der Schutz-Trigger der Suchaufträge lässt
-- notify_email = false ohne auth.uid zu. Der Token steht nie in einer Meldung.
create function public.unsubscribe(p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  token text := coalesce(p_token, '');
  valid boolean;
  hash bytea;
  t_user uuid;
  t_scope text;
  t_targets uuid[];
begin
  valid := length(token) = 64 and token ~ '^[0-9a-f]{64}$';
  if not valid then
    token := repeat('0', 64);
  end if;
  hash := extensions.digest(decode(token, 'hex'), 'sha256');

  select t.user_id, t.scope, t.target_ids into t_user, t_scope, t_targets
  from private.unsubscribe_tokens t
  where t.token_hash = hash
    and t.created_at > now() - make_interval(days => private.setting_int('unsubscribe_token_days'));

  update public.saved_searches s
  set notify_email = false
  where t_scope = 'saved_search_mail' and s.user_id = t_user and s.id = any (t_targets) and s.notify_email;

  update public.profiles p
  set notify_chat_email = false
  where t_scope = 'chat' and p.user_id = t_user and p.notify_chat_email;
end;
$$;
revoke execute on function public.unsubscribe(text) from public;
grant execute on function public.unsubscribe(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Suchauftrags-Claim mit Token (Stand 20261108110100, nur unsubscribe_token ergänzt)
-- ---------------------------------------------------------------------------
-- Antwort: {"queue": {Zähler des Abgleichs}, "recipients": [{"claim_id", "email", "language", "unsubscribe_token",
--   "items": [{"listing_id", "title", "kind", "direction", "district_code", "district_name", "state_code",
--              "state_name", "price_minor", "currency", "price_unit"}],
--   "searches": [{"id", "name", "expires_at", "extendable"}]}]}
-- unsubscribe_token: Scope saved_search_mail, Ziele = genau die Aufträge in "searches".
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
  token text;
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

    -- Abbestellen (B4): genau die Aufträge dieser Mail.
    token := private.issue_unsubscribe_token(r.user_id, 'saved_search_mail',
      array(select distinct m.saved_search_id from private.saved_search_matches m where m.claim_id = cid));

    -- Allowlist (A5): nie listing_card, map_point, Koordinaten, PLZ, Ort, Kontakt oder Anbieter.
    sent := sent + 1;
    select recipients || jsonb_build_array(jsonb_build_object(
      'claim_id', cid,
      'email', (select u.email from auth.users u where u.id = r.user_id),
      'language', p.preferred_language,
      'unsubscribe_token', token,
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

-- ---------------------------------------------------------------------------
-- Chat-Claim mit Token (Stand 20261106140000, nur unsubscribe_token ergänzt; ADR 017-Nachtrag)
-- ---------------------------------------------------------------------------
-- Antwort: [{"recipient_id", "email", "language", "unsubscribe_token",
--            "conversations": [{"conversation_id", "sender_name", "listing_title"}]}]
create or replace function public.claim_chat_notifications(p_secret text, p_limit integer default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  delay interval := make_interval(mins => private.setting_int('chat_email_delay_minutes'));
  gap interval := make_interval(mins => private.setting_int('chat_email_min_interval_minutes'));
  lim integer := least(coalesce(p_limit, private.setting_int('chat_email_batch')), private.setting_int('chat_email_batch'));
  result jsonb;
begin
  if not private.chat_notifications_secret_valid(p_secret) then
    raise exception 'Nicht erlaubt' using errcode = '42501';
  end if;

  -- Fällige Paare: ungelesene Nachricht, älter als delay, neuer als die letzte Mail zu dieser Unterhaltung; beide Konten
  -- aktiv, keine Sperre, Empfänger nicht abgemeldet. Empfänger mit einer Mail im Intervall fallen ganz weg.
  insert into private.chat_notifications (conversation_id, recipient_id, channel)
  select distinct m.conversation_id, m.recipient_id, 'email'
  from public.messages m
  where m.read_at is null and m.created_at < now() - delay
  on conflict do nothing;

  with due as (
    select n.conversation_id, n.recipient_id
    from private.chat_notifications n
    join public.profiles r on r.user_id = n.recipient_id
    where n.channel = 'email'
      and r.notify_chat_email and private.is_active_user(n.recipient_id)
      and exists (
        select 1 from public.messages m
        where m.conversation_id = n.conversation_id and m.recipient_id = n.recipient_id and m.read_at is null
          and m.created_at < now() - delay and m.created_at > coalesce(n.last_sent_at, '-infinity')
          and private.is_active_user(m.sender_id) and not private.is_blocked_pair(m.sender_id, m.recipient_id))
      and not exists (
        select 1 from private.chat_notifications o
        where o.recipient_id = n.recipient_id and o.channel = 'email' and o.last_sent_at > now() - gap)
  ),
  recipients as (
    select distinct recipient_id from due order by recipient_id limit lim
  ),
  locked as (
    select n.conversation_id, n.recipient_id
    from private.chat_notifications n
    where n.channel = 'email' and (n.conversation_id, n.recipient_id) in (select d.conversation_id, d.recipient_id from due d
                                                                         where d.recipient_id in (select recipient_id from recipients))
    for update skip locked
  ),
  claimed as (
    update private.chat_notifications n
    set previous_sent_at = n.last_sent_at, last_sent_at = now()
    from locked l
    where n.channel = 'email' and n.conversation_id = l.conversation_id and n.recipient_id = l.recipient_id
    returning n.conversation_id, n.recipient_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'recipient_id', r.recipient_id,
      'email', u.email,
      'language', p.preferred_language,
      -- Abbestellen (B4, A6): Scope chat, setzt notify_chat_email = false.
      'unsubscribe_token', private.issue_unsubscribe_token(r.recipient_id, 'chat', '{}'::uuid[]),
      'conversations', (
        select jsonb_agg(jsonb_build_object(
          'conversation_id', c.id,
          'sender_name', case when sp.deleted_at is null and not sp.is_blocked then
                           case when sp.account_type = 'business' and sp.business_name is not null then sp.business_name else sp.display_name end end,
          -- Titel nur, wenn öffentlich oder der Empfänger Besitzer ist.
          'listing_title', case when l.id is not null and (l.owner_id = r.recipient_id or private.listing_is_public(l.status, l.expires_at, l.owner_id))
                                then l.title end
        ) order by c.last_message_at desc)
        from claimed cl
        join public.conversations c on c.id = cl.conversation_id
        left join public.listings l on l.id = c.listing_id
        left join public.profiles sp on sp.user_id = case when c.owner_id = r.recipient_id then c.interested_id else c.owner_id end
        where cl.recipient_id = r.recipient_id)
    )), '[]')
  into result
  from (select distinct recipient_id from claimed) r
  join auth.users u on u.id = r.recipient_id
  join public.profiles p on p.user_id = r.recipient_id;

  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Retention (ADR 008, A9): Stand 20261108110000 plus Moderations-Mails (30 Tage nach Erledigung, unerledigte ab
-- Claim bzw. Eintrag) und Abbestell-Token (unsubscribe_token_days).
-- ---------------------------------------------------------------------------
create or replace function private.purge_search_notifications()
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
  mo integer;
  t integer;
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
  delete from private.moderation_notifications where coalesce(done_at, claimed_at, created_at) < cutoff;
  get diagnostics mo = row_count;
  delete from private.unsubscribe_tokens
  where created_at < now() - make_interval(days => private.setting_int('unsubscribe_token_days'));
  get diagnostics t = row_count;
  return jsonb_build_object('queue', q, 'matches', m, 'deliveries', d, 'claims', c, 'state', s,
                            'moderation', mo, 'tokens', t);
end;
$$;
