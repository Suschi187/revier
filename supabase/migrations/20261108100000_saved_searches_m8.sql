-- M8 Commit 2 (ADR 018, Plan M8 4.1 und Review B3, A7, A9, A11, A12): Suchauftrag.
-- - Neue Spalten cadence, paused_at, expires_at; Laufzeit 42 Tage, Server setzt expires_at.
-- - Filter werden beim Speichern geprüft wie in der Suche (search_filters_error und Probelauf von
--   search_conditions, der einen Suchbegriff mit mehr als 32 Knoten abfängt); sort wird entfernt.
--   Trigger statt CHECK, weil die Prüfung Referenzdaten liest (Restore-Reihenfolge).
-- - Grants exakt: Filter nach dem Anlegen fest, notify_push bis I6 nicht vom Client setzbar.
-- - Pausieren, Fortsetzen, Verlängern nur über Definer-RPCs; fremde und unbekannte IDs liefern 42501.
-- - Verlängern außerhalb des Fensters: RV006 mit hint {"extend_from": "<ISO UTC>"}.
-- - Limit 25 je Konto (abgelaufene zählen mit), serialisiert je Nutzer.
-- - Retention: abgelaufene Aufträge werden saved_search_expired_keep_days nach expires_at gelöscht.

insert into private.app_settings (key, value, description) values
  ('saved_search_days', '42', 'Laufzeit eines Suchauftrags in Tagen, auch nach dem Verlängern (ADR 018)'),
  ('saved_search_extend_window_days', '14', 'Tage vor dem Ablauf, ab denen ein Suchauftrag verlängert werden kann (ADR 018)'),
  ('saved_search_expired_keep_days', '30', 'Tage nach dem Ablauf, bis ein Suchauftrag gelöscht wird (ADR 008, ADR 018)'),
  ('saved_search_daily_hour', '7', 'Stunde (Europe/Berlin), ab der die tägliche Sammelmail fällig ist (ADR 018)'),
  ('saved_search_instant_delay_minutes', '2', 'Minuten nach der Freigabe, bevor eine Sofort-Mail fällig ist (ADR 018, H7)'),
  ('saved_search_instant_min_gap_minutes', '10', 'Mindestabstand zwischen zwei Sofort-Mails an denselben Empfänger (ADR 018)'),
  ('search_email_batch', '50', 'Höchstzahl Empfänger je Lauf der Suchauftrags-Mails (ADR 018)');

-- ---------------------------------------------------------------------------
-- Spalten
-- ---------------------------------------------------------------------------
create type public.saved_search_cadence as enum ('instant', 'daily');

alter table public.saved_searches
  add column cadence public.saved_search_cadence not null default 'instant',
  add column paused_at timestamptz,
  add column expires_at timestamptz;

-- Ohne Angabe gilt das Filterformat v1 ohne Einschränkung (ADR 015); '{}' bestünde die Prüfung nicht.
alter table public.saved_searches alter column filters set default '{"v": 1}'::jsonb;

-- ---------------------------------------------------------------------------
-- Bestandszeilen (A12): sort entfernen, ungültige Filter löschen und zählen, Laufzeit setzen.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  removed integer := 0;
begin
  update public.saved_searches set filters = filters - 'sort' where filters ? 'sort';
  for r in select s.id, s.filters from public.saved_searches s loop
    begin
      if private.search_filters_error(r.filters) is not null then
        raise exception 'Ungültiger Filter' using errcode = '22023';
      end if;
      perform private.search_conditions(r.filters);
    exception when others then
      delete from public.saved_searches where id = r.id;
      removed := removed + 1;
    end;
  end loop;
  raise notice 'saved_searches: % Suchaufträge mit ungültigen Filtern gelöscht', removed;
  update public.saved_searches
  set expires_at = now() + make_interval(days => private.setting_int('saved_search_days'))
  where expires_at is null;
end;
$$;

alter table public.saved_searches alter column expires_at set not null;

-- Retention und (ab Commit 3) Abgleich nach Ablauf.
create index saved_searches_expires_idx on public.saved_searches (expires_at);

-- ---------------------------------------------------------------------------
-- Grants (A7): Spalten-Grants einzeln entziehen, ein revoke auf die Tabelle entfernt sie nicht.
-- ---------------------------------------------------------------------------
revoke insert (notify_push) on public.saved_searches from authenticated;
revoke update (filters, notify_push) on public.saved_searches from authenticated;
grant insert (name, filters, cadence, notify_email) on public.saved_searches to authenticated;
grant update (name, cadence, notify_email) on public.saved_searches to authenticated;

-- ---------------------------------------------------------------------------
-- Trigger (Reihenfolge alphabetisch: a_guard, b_filters, c_limit)
-- ---------------------------------------------------------------------------
-- Server-Spalten und Schreibregeln. Der Server wird nur über die Rolle erkannt (ADR 017), die RPCs unten
-- setzen für ihr UPDATE das transaktionslokale Flag revier.saved_search_rpc (wie revier.moderation).
-- Anlegen und E-Mail wieder einschalten verlangen aktives Konto und Zustimmung (RV001); Pausieren,
-- E-Mail aus, Umbenennen, Takt und Löschen nicht.
create function private.saved_searches_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  server boolean := private.is_server_caller();
  rpc boolean := coalesce(current_setting('revier.saved_search_rpc', true), '') = 'on';
  uid uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    if not server then
      if uid is null or not private.is_active_user(uid) then
        raise exception 'Nicht erlaubt' using errcode = '42501';
      end if;
      -- Gleicher Fehler wie private.require_current_legal(), das für Nutzer nicht ausführbar bleibt.
      if not private.has_accepted_current_legal() then
        raise exception 'legal_consent_required'
          using errcode = 'RV001', hint = 'Zustimmung zur aktuellen Version per legal_status() und accept_legal() einholen';
      end if;
      new.created_at := now();
      new.paused_at := null;
      new.last_notified_at := null;
      new.expires_at := null;
    end if;
    if new.expires_at is null then
      new.expires_at := now() + make_interval(days => private.setting_int('saved_search_days'));
    end if;
    return new;
  end if;

  if server then
    return new;
  end if;
  if new.user_id is distinct from old.user_id or new.created_at is distinct from old.created_at
     or new.last_notified_at is distinct from old.last_notified_at
     or (not rpc and (new.paused_at is distinct from old.paused_at or new.expires_at is distinct from old.expires_at)) then
    raise exception 'Diese Felder setzt nur der Server' using errcode = '42501';
  end if;
  if new.notify_email and not old.notify_email then
    if uid is null or not private.is_active_user(uid) then
      raise exception 'Nicht erlaubt' using errcode = '42501';
    end if;
    if not private.has_accepted_current_legal() then
      raise exception 'legal_consent_required'
        using errcode = 'RV001', hint = 'Zustimmung zur aktuellen Version per legal_status() und accept_legal() einholen';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function private.saved_searches_guard() from public, anon, authenticated;

create trigger saved_searches_a_guard
  before insert or update on public.saved_searches
  for each row execute function private.saved_searches_guard();

-- Filter wie in der Suche (B3): gleiche Fehler (22023 mit hint), auch die Grenze von 32 Knoten im Suchbegriff.
create function private.saved_searches_filters()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  bad text;
begin
  bad := private.search_filters_error(new.filters);
  if bad is not null then
    raise exception 'Ungültiger Filter' using errcode = '22023', hint = bad;
  end if;
  perform private.search_conditions(new.filters);
  -- Die Reihenfolge spielt für den Abgleich keine Rolle.
  new.filters := new.filters - 'sort';
  return new;
end;
$$;
revoke execute on function private.saved_searches_filters() from public, anon, authenticated;

create trigger saved_searches_b_filters
  before insert or update of filters on public.saved_searches
  for each row execute function private.saved_searches_filters();

-- Limit (A7): serialisiert je Nutzer wie favorites_limit; abgelaufene Aufträge zählen mit.
drop trigger saved_searches_limit on public.saved_searches;

create or replace function private.saved_searches_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('saved_searches'), hashtext(new.user_id::text));
  if (select count(*) from public.saved_searches where user_id = new.user_id) >= 25 then
    raise exception 'Höchstens 25 Suchaufträge pro Konto, abgelaufene zählen mit'
      using errcode = '23514', hint = '{"reason":"saved_searches_limit"}';
  end if;
  return new;
end;
$$;
revoke execute on function private.saved_searches_limit() from public, anon, authenticated;

create trigger saved_searches_c_limit
  before insert on public.saved_searches
  for each row execute function private.saved_searches_limit();

-- ---------------------------------------------------------------------------
-- RPCs (Definer). Gleiche Antwort für fremde und unbekannte IDs (42501), kein Orakel.
-- ---------------------------------------------------------------------------
-- Pausieren geht immer (auch ohne Zustimmung, auch gesperrt) und hält die Laufzeit nicht an (H4).
create function public.pause_saved_search(p_id uuid)
returns public.saved_searches
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  s public.saved_searches;
  previous_flag text := coalesce(current_setting('revier.saved_search_rpc', true), '');
begin
  if uid is null then
    raise exception 'Suchauftrag nicht gefunden' using errcode = '42501';
  end if;
  select * into s from public.saved_searches where id = p_id and user_id = uid for update;
  if not found then
    raise exception 'Suchauftrag nicht gefunden' using errcode = '42501';
  end if;
  if s.paused_at is null then
    perform set_config('revier.saved_search_rpc', 'on', true);
    update public.saved_searches set paused_at = now() where id = p_id returning * into s;
    perform set_config('revier.saved_search_rpc', previous_flag, true);
  end if;
  return s;
end;
$$;
revoke execute on function public.pause_saved_search(uuid) from public, anon;
grant execute on function public.pause_saved_search(uuid) to authenticated;

-- Fortsetzen holt nichts nach (Treffer aus der Pause bleiben ohne Mail, Commit 3).
create function public.resume_saved_search(p_id uuid)
returns public.saved_searches
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  s public.saved_searches;
  previous_flag text := coalesce(current_setting('revier.saved_search_rpc', true), '');
begin
  if uid is null or not private.is_active_user(uid) then
    raise exception 'Nicht erlaubt' using errcode = '42501';
  end if;
  perform private.require_current_legal();
  select * into s from public.saved_searches where id = p_id and user_id = uid for update;
  if not found then
    raise exception 'Suchauftrag nicht gefunden' using errcode = '42501';
  end if;
  if s.paused_at is not null then
    perform set_config('revier.saved_search_rpc', 'on', true);
    update public.saved_searches set paused_at = null where id = p_id returning * into s;
    perform set_config('revier.saved_search_rpc', previous_flag, true);
  end if;
  return s;
end;
$$;
revoke execute on function public.resume_saved_search(uuid) from public, anon;
grant execute on function public.resume_saved_search(uuid) to authenticated;

-- Verlängern im Fenster der letzten Tage vor dem Ablauf oder danach, auch aus der Pause (H4).
-- Setzt now() + saved_search_days; die Pause bleibt bestehen.
create function public.extend_saved_search(p_id uuid)
returns public.saved_searches
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  s public.saved_searches;
  extend_from timestamptz;
  previous_flag text := coalesce(current_setting('revier.saved_search_rpc', true), '');
begin
  if uid is null or not private.is_active_user(uid) then
    raise exception 'Nicht erlaubt' using errcode = '42501';
  end if;
  perform private.require_current_legal();
  select * into s from public.saved_searches where id = p_id and user_id = uid for update;
  if not found then
    raise exception 'Suchauftrag nicht gefunden' using errcode = '42501';
  end if;
  extend_from := s.expires_at - make_interval(days => private.setting_int('saved_search_extend_window_days'));
  if now() < extend_from then
    raise exception 'extend_not_yet' using errcode = 'RV006',
      hint = jsonb_build_object('extend_from', to_char(extend_from at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))::text;
  end if;
  perform set_config('revier.saved_search_rpc', 'on', true);
  update public.saved_searches
  set expires_at = now() + make_interval(days => private.setting_int('saved_search_days'))
  where id = p_id returning * into s;
  perform set_config('revier.saved_search_rpc', previous_flag, true);
  return s;
end;
$$;
revoke execute on function public.extend_saved_search(uuid) from public, anon;
grant execute on function public.extend_saved_search(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Retention (ADR 008, A9): abgelaufene Aufträge bleiben 30 Tage sichtbar und verlängerbar, danach weg.
-- ---------------------------------------------------------------------------
create function private.purge_expired_saved_searches()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  removed integer;
begin
  delete from public.saved_searches
  where expires_at < now() - make_interval(days => private.setting_int('saved_search_expired_keep_days'));
  get diagnostics removed = row_count;
  return removed;
end;
$$;
revoke execute on function private.purge_expired_saved_searches() from public, anon, authenticated;

select cron.schedule('saved-searches-retention', '17 3 * * *', 'select private.purge_expired_saved_searches()');
