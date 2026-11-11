-- M9a (ADR 019, Aufräumjobs; ADR 008 Fristen, alle Werte Platzhalter):
-- - Nie bestätigte Konten (Review A12): täglich Ankerzeilen und deleted_at, gelöscht über denselben Weg wie
--   Löschanträge (Function delete-account). Nur ohne Bestätigung, ohne je angemeldet zu sein, älter als
--   unconfirmed_account_days, ohne andere Identität als email und ohne Rolle.
-- - Erledigte Meldungen samt Kopien gemeldeter Nachrichten (Kaskade über report_id) nach handled_reports_months.
-- - Audit-Log nach audit_log_months.
-- - Storage (Function account-maintenance, nur über die API): Foto-Eingang listing-uploads älter als 24 h und
--   Dateien in listing-photos ohne Zeile, älter als 24 h. Eigenes Vault-Secret und eigene URL; ohne URL nichts.

create function private.queue_unconfirmed_account_deletions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  queued integer;
begin
  with candidates as (
    select u.id, u.email from auth.users u
    where u.email_confirmed_at is null
      and u.last_sign_in_at is null
      and u.created_at < now() - make_interval(days => private.setting_int('unconfirmed_account_days'))
      and not exists (select 1 from auth.identities i where i.user_id = u.id and i.provider <> 'email')
      and not exists (select 1 from private.user_roles r where r.user_id = u.id)
  ),
  inserted as (
    insert into private.account_deletions (user_id, email)
    select c.id, c.email from candidates c
    on conflict (user_id) do nothing
    returning user_id
  )
  update public.profiles p set deleted_at = coalesce(p.deleted_at, now())
  from candidates c where p.user_id = c.id;
  get diagnostics queued = row_count;
  perform private.trigger_account_deletion();
  return queued;
end;
$$;
revoke execute on function private.queue_unconfirmed_account_deletions() from public, anon, authenticated;

create function private.purge_handled_reports()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  purged integer;
begin
  delete from public.reports r
  where r.status = 'handled'
    and r.handled_at < now() - make_interval(months => private.setting_int('handled_reports_months'));
  get diagnostics purged = row_count;
  return purged;
end;
$$;
revoke execute on function private.purge_handled_reports() from public, anon, authenticated;

create function private.purge_audit_log()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  purged integer;
begin
  delete from public.audit_log a
  where a.created_at < now() - make_interval(months => private.setting_int('audit_log_months'));
  get diagnostics purged = row_count;
  return purged;
end;
$$;
revoke execute on function private.purge_audit_log() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Storage-Aufräumen über die Function account-maintenance
-- ---------------------------------------------------------------------------
insert into private.app_settings (key, value, description) values
  ('storage_orphan_hours', '24', 'Foto-Eingang und Dateien ohne Zeile nach so vielen Stunden löschen (ADR 019, Platzhalter)');

do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'account_maintenance_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'account_maintenance_secret',
      'Aufruf der Edge Function account-maintenance durch pg_cron (ADR 019).');
  end if;
end;
$$;

create function private.account_maintenance_secret_valid(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_secret is not null and exists (
    select 1 from vault.decrypted_secrets s
    where s.name = 'account_maintenance_secret'
      and extensions.digest(s.decrypted_secret, 'sha256') = extensions.digest(p_secret, 'sha256')
  );
$$;
revoke execute on function private.account_maintenance_secret_valid(text) from public, anon, authenticated;

-- Kandidaten in Blöcken (höchstens 1000): Eingang nach Frist; listing-photos ohne Zeile (weder storage_path noch
-- thumb_path) nach Frist. Die Frist schützt laufende Uploads und die Verarbeitung (ADR 011).
create function public.maintenance_storage_objects(p_secret text, p_limit integer default 1000)
returns table (bucket_id text, name text, reason text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cutoff timestamptz := now() - make_interval(hours => private.setting_int('storage_orphan_hours'));
begin
  if not private.account_maintenance_secret_valid(p_secret) then
    raise exception 'invalid_secret' using errcode = '42501';
  end if;
  return query
  (select o.bucket_id, o.name, 'upload_expired'::text from storage.objects o
   where o.bucket_id = 'listing-uploads' and o.created_at < cutoff
   order by o.created_at)
  union all
  (select o.bucket_id, o.name, 'photo_orphan'::text from storage.objects o
   where o.bucket_id = 'listing-photos' and o.created_at < cutoff
     and not exists (select 1 from public.listing_photos p where p.storage_path = o.name or p.thumb_path = o.name)
   order by o.created_at)
  limit greatest(1, least(coalesce(p_limit, 1000), 1000));
end;
$$;
revoke execute on function public.maintenance_storage_objects(text, integer) from public, anon, authenticated;
grant execute on function public.maintenance_storage_objects(text, integer) to service_role;

create function private.trigger_account_maintenance()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  url text;
  secret text;
begin
  select s.decrypted_secret into url from vault.decrypted_secrets s where s.name = 'account_maintenance_url';
  select s.decrypted_secret into secret from vault.decrypted_secrets s where s.name = 'account_maintenance_secret';
  if url is null or secret is null then
    return;
  end if;
  perform net.http_post(
    url := url,
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-account-maintenance-secret', secret),
    timeout_milliseconds := 30000
  );
end;
$$;
revoke execute on function private.trigger_account_maintenance() from public, anon, authenticated;

select cron.schedule('unconfirmed-accounts', '7 4 * * *', 'select private.queue_unconfirmed_account_deletions()');
select cron.schedule('reports-retention', '27 4 * * *', 'select private.purge_handled_reports()');
select cron.schedule('audit-retention', '37 4 * * *', 'select private.purge_audit_log()');
select cron.schedule('account-maintenance', '23 * * * *', 'select private.trigger_account_maintenance()');
