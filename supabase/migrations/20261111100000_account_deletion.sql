-- M9a (ADR 019): Account-Löschung mit frischer Anmeldung und festem, idempotentem Ablauf.
-- - request_account_deletion: frische Anmeldung (amr otp/oauth, 10 Minuten, RV007), bei MFA-Faktor aal2 (RV005),
--   kein Konto mit Rolle (42501, hint admin_role); ohne Legal-Gate und auch für gesperrte Konten. Setzt deleted_at,
--   legt die Ankerzeile an und stößt die Function per pg_net an (läuft nach dem Commit).
-- - Ablauf (Review B1) in der Function delete-account: Storage 1 → prepare → deleteUser → finalize → Storage 2 →
--   complete. Die Schritt-RPCs arbeiten nur mit einem gültigen Lease (claim_id, claimed_until).
-- - Fehler: Backoff 1 min, verdoppelt, höchstens 1 h; die Wiederholung bricht nie ab. Ab 10 Versuchen zählt die
--   Admin-Übersicht „Löschungen hängen“ (nur Anzahl).

insert into private.app_settings (key, value, description) values
  ('account_deletion_reauth_minutes', '10', 'Höchstalter der Anmeldung für die Account-Löschung (ADR 019, Platzhalter)'),
  ('account_deletion_stuck_attempts', '10', 'Ab so vielen Versuchen gilt eine Löschung als hängend (ADR 019)'),
  ('unconfirmed_account_days', '7', 'Nie bestätigte Konten nach so vielen Tagen löschen (ADR 008/019, Platzhalter)');

-- ---------------------------------------------------------------------------
-- Anker und Löschliste
-- ---------------------------------------------------------------------------

-- Ohne FK: überlebt deleteUser und wird erst im letzten Schritt entfernt. Die E-Mail ist ein Snapshot für finalize.
create table private.account_deletions (
  user_id uuid primary key,
  email text,
  requested_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  last_error_at timestamptz,
  claim_id uuid,
  claimed_until timestamptz,
  constraint account_deletions_claim check ((claim_id is null) = (claimed_until is null))
);
create index account_deletions_due_idx on private.account_deletions (next_attempt_at);
alter table private.account_deletions enable row level security;
revoke all on private.account_deletions from public, anon, authenticated;

-- Buckets mit Dateien unter `{user_id}/` (ADR 011). Die Function liest die Liste hier, der Wächter in 00_meta
-- prüft, dass jeder Bucket darin steht.
create table private.account_deletion_buckets (
  bucket_id text primary key
);
insert into private.account_deletion_buckets (bucket_id) values ('listing-uploads'), ('listing-photos'), ('verification-docs');
alter table private.account_deletion_buckets enable row level security;
revoke all on private.account_deletion_buckets from public, anon, authenticated;

-- Geheimnis für den Aufruf der Function (Review A1). Zufällig erzeugt, nie im Repo.
do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'account_deletion_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'account_deletion_secret',
      'Aufruf der Edge Function delete-account durch pg_net/pg_cron (ADR 019).');
  end if;
end;
$$;

create function private.account_deletion_secret_valid(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- Vergleich über Hashes gleicher Länge: keine Zeitunterschiede je übereinstimmendem Präfix.
  select p_secret is not null and exists (
    select 1 from vault.decrypted_secrets s
    where s.name = 'account_deletion_secret'
      and extensions.digest(s.decrypted_secret, 'sha256') = extensions.digest(p_secret, 'sha256')
  );
$$;
revoke execute on function private.account_deletion_secret_valid(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Löschantrag
-- ---------------------------------------------------------------------------

-- Frische Anmeldung per E-Mail-Code/-Link (`otp`) oder Apple (`oauth`, iOS ggf. `id_token`), gemessen gegen den
-- lokalen Stack (ADR 019). `totp` allein zählt nie; ein Refresh behält den Zeitstempel.
create function private.has_fresh_login()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select bool_or((e ->> 'method') in ('otp', 'magiclink', 'oauth', 'id_token')
                   and to_timestamp((e ->> 'timestamp')::double precision)
                       >= now() - make_interval(mins => private.setting_int('account_deletion_reauth_minutes')))
    from jsonb_array_elements(case when jsonb_typeof(auth.jwt() -> 'amr') = 'array' then auth.jwt() -> 'amr' else '[]'::jsonb end) e
  ), false);
$$;
revoke execute on function private.has_fresh_login() from public, anon, service_role;

-- Anstoß der Function (nach dem Commit, pg_net), nur wenn fällige Zeilen ohne laufenden Lease da sind. Ohne URL
-- im Vault nichts. Body ohne Nutzer-ID; die Function holt sich die Zeilen per Claim.
create function private.trigger_account_deletion()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  url text;
  secret text;
begin
  select s.decrypted_secret into url from vault.decrypted_secrets s where s.name = 'account_deletion_url';
  select s.decrypted_secret into secret from vault.decrypted_secrets s where s.name = 'account_deletion_secret';
  if url is null or secret is null then
    return;
  end if;
  if not exists (
    select 1 from private.account_deletions d
    where d.next_attempt_at <= now() and (d.claimed_until is null or d.claimed_until < now())
  ) then
    return;
  end if;
  perform net.http_post(
    url := url,
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-account-deletion-secret', secret),
    timeout_milliseconds := 20000
  );
end;
$$;
revoke execute on function private.trigger_account_deletion() from public, anon, authenticated;

create function public.request_account_deletion()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not private.has_fresh_login() then
    raise exception 'reauth_required' using errcode = 'RV007', hint = '{"reauth":"required"}';
  end if;
  -- Ehemalige Admins mit bestätigtem Faktor: zusätzlich aal2 (Review A3).
  if exists (select 1 from auth.mfa_factors f where f.user_id = uid and f.status = 'verified')
     and coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception 'step_up_required' using errcode = 'RV005';
  end if;
  -- Der Rolleneintrag selbst, nicht is_admin() (das wäre mit aal1 falsch): Rolle zuerst entziehen (ADR 005).
  if exists (select 1 from private.user_roles r where r.user_id = uid) then
    raise exception 'admin_role' using errcode = '42501', hint = '{"reason":"admin_role"}';
  end if;

  update public.profiles set deleted_at = coalesce(deleted_at, now()) where user_id = uid;
  insert into private.account_deletions (user_id, email)
  select u.id, u.email from auth.users u where u.id = uid
  on conflict (user_id) do nothing;
  perform private.trigger_account_deletion();
end;
$$;
revoke execute on function public.request_account_deletion() from public, anon, service_role;
grant execute on function public.request_account_deletion() to authenticated;

-- ---------------------------------------------------------------------------
-- Schritte für die Function (nur service_role, nur mit gültigem Lease)
-- ---------------------------------------------------------------------------

create function private.account_deletion_leased(p_claim_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.account_deletions d
    where d.user_id = p_user_id and d.claim_id = p_claim_id and d.claimed_until > now()
  );
$$;
revoke execute on function private.account_deletion_leased(uuid, uuid) from public, anon, authenticated;

-- Fällige Zeilen sperren (Lease 5 Minuten, Muster ADR 017/018). Ein abgebrochener Lauf gibt die Zeile mit dem
-- Ablauf des Lease frei; attempts zählt schon beim Claim, damit auch Abstürze den Backoff verlängern.
create function public.account_deletion_claim(p_secret text, p_limit integer default 5)
returns table (user_id uuid, claim_id uuid, attempts integer)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.account_deletion_secret_valid(p_secret) then
    raise exception 'invalid_secret' using errcode = '42501';
  end if;
  return query
  with due as (
    select d.user_id from private.account_deletions d
    where d.next_attempt_at <= now() and (d.claimed_until is null or d.claimed_until < now())
    order by d.next_attempt_at, d.user_id
    limit greatest(1, least(coalesce(p_limit, 5), 20))
    for update skip locked
  )
  update private.account_deletions d set
    claim_id = gen_random_uuid(),
    claimed_until = now() + interval '5 minutes',
    attempts = d.attempts + 1,
    -- Fallback, falls der Lauf abbricht: nächster Versuch nach Backoff.
    next_attempt_at = now() + least(interval '1 hour', interval '1 minute' * power(2, least(d.attempts, 10)))
  from due
  where d.user_id = due.user_id
  returning d.user_id, d.claim_id, d.attempts;
end;
$$;

-- Objektnamen unter `{user_id}/` in den Buckets der Löschliste (list() ist nicht rekursiv, Review A2). Gelöscht
-- wird über die Storage-API, nie per SQL. Höchstens 1000 je Aufruf; die Function ruft, bis 0 kommt.
create function public.account_deletion_objects(p_claim_id uuid, p_user_id uuid)
returns table (bucket_id text, name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.account_deletion_leased(p_claim_id, p_user_id) then
    raise exception 'lease_invalid' using errcode = '42501';
  end if;
  return query
  select o.bucket_id, o.name from storage.objects o
  where o.bucket_id in (select b.bucket_id from private.account_deletion_buckets b)
    and o.name like p_user_id::text || '/%'
  order by o.bucket_id, o.name
  limit 1000;
end;
$$;

-- Schritt 3: Verweise in Audit-Details entfernen, bevor die Kaskade läuft (Verifizierungen tragen user_id).
create function public.account_deletion_prepare(p_claim_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.account_deletion_leased(p_claim_id, p_user_id) then
    raise exception 'lease_invalid' using errcode = '42501';
  end if;
  update public.audit_log a set details = a.details - 'user_id' where a.details ->> 'user_id' = p_user_id::text;
end;
$$;

-- Schritt 5: Reste ohne FK nach deleteUser. auth.audit_log_entries (Ereignisse mit ID oder E-Mail, auch das
-- `user_deleted` von deleteUser selbst), auth.flow_state und Realtime-Nachrichten mit der ID (ADR 017).
create function public.account_deletion_finalize(p_claim_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  mail text;
begin
  if not private.account_deletion_leased(p_claim_id, p_user_id) then
    raise exception 'lease_invalid' using errcode = '42501';
  end if;
  if exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'user_still_exists' using errcode = '55000';
  end if;
  select lower(d.email) into mail from private.account_deletions d where d.user_id = p_user_id;
  delete from auth.audit_log_entries e
  where position(p_user_id::text in e.payload::text) > 0
     or (mail is not null and position(mail in lower(e.payload::text)) > 0);
  delete from auth.flow_state f where f.user_id = p_user_id;
  delete from realtime.messages m
  where m.topic = 'user:' || p_user_id::text or position(p_user_id::text in coalesce(m.payload::text, '')) > 0;
end;
$$;

-- Schritt 7: Ankerzeile entfernen, nur wenn das Konto weg ist.
create function public.account_deletion_complete(p_claim_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.account_deletion_leased(p_claim_id, p_user_id) then
    raise exception 'lease_invalid' using errcode = '42501';
  end if;
  if exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'user_still_exists' using errcode = '55000';
  end if;
  delete from private.account_deletions d where d.user_id = p_user_id and d.claim_id = p_claim_id;
end;
$$;

-- Fehler eines Schritts: Lease freigeben, Backoff bleibt aus dem Claim (1 min verdoppelt, höchstens 1 h).
create function public.account_deletion_fail(p_claim_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.account_deletions d set last_error_at = now(), claim_id = null, claimed_until = null
  where d.user_id = p_user_id and d.claim_id = p_claim_id;
end;
$$;

revoke execute on function public.account_deletion_claim(text, integer) from public, anon, authenticated;
revoke execute on function public.account_deletion_objects(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.account_deletion_prepare(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.account_deletion_finalize(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.account_deletion_complete(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.account_deletion_fail(uuid, uuid) from public, anon, authenticated;
grant execute on function public.account_deletion_claim(text, integer) to service_role;
grant execute on function public.account_deletion_objects(uuid, uuid) to service_role;
grant execute on function public.account_deletion_prepare(uuid, uuid) to service_role;
grant execute on function public.account_deletion_finalize(uuid, uuid) to service_role;
grant execute on function public.account_deletion_complete(uuid, uuid) to service_role;
grant execute on function public.account_deletion_fail(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Admin-Übersicht: hängende Löschungen, nur als Anzahl (ohne Identität)
-- ---------------------------------------------------------------------------
create function public.admin_stuck_account_deletions()
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return (select count(*)::integer from private.account_deletions d
          where d.attempts >= private.setting_int('account_deletion_stuck_attempts'));
end;
$$;
revoke execute on function public.admin_stuck_account_deletions() from public, anon, service_role;
grant execute on function public.admin_stuck_account_deletions() to authenticated;

-- Auslöser jede Minute: holt fällige Wiederholungen nach (Backoff), ruft nur bei fälligen Zeilen.
select cron.schedule('account-deletions', '* * * * *', 'select private.trigger_account_deletion()');
