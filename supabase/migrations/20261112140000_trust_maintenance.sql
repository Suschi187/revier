-- M9b Commit 10 (ADR 020, Aufräumjobs; ADR 008, SPEC 7.3; Fristen sind Platzhalter):
-- - Verifizierungsdokumente verification_document_days (30) nach der Entscheidung: Datei über die Storage-API
--   (account-maintenance, Grund verification_expired), danach setzt der Job document_path = null.
-- - Anträge ohne Einreichung nach storage_orphan_hours (24) löschen; Dateien ohne Antrag nach derselben Frist
--   (verification_orphan).
-- - Verlassene Entwürfe: listings.edited_at (letzte Bearbeitung durch den Besitzer, auch Fotos, Wildarten, Ort),
--   Hinweis draft_notice_days (30) vor Ablauf von draft_inactive_months (12) als Dienstmail draft_expiry_notice mit
--   listings.draft_notice_at; gelöscht wird nur, wenn der Hinweis mindestens 30 Tage alt ist und seitdem nichts
--   geändert wurde. Die Fotos entfernt danach der Job für Dateien ohne Zeile (ADR 019).

insert into private.app_settings (key, value, description) values
  ('draft_inactive_months', '12', 'Entwürfe ohne Bearbeitung so viele Monate, dann gelöscht (ADR 020, SPEC 7.3, Platzhalter)'),
  ('draft_notice_days', '30', 'Hinweis so viele Tage vor dem Löschen eines verlassenen Entwurfs (ADR 020, Platzhalter)');

-- Spalten -----------------------------------------------------------------------------------------------------------
alter table public.listings add column edited_at timestamptz, add column draft_notice_at timestamptz;
update public.listings set edited_at = greatest(created_at, coalesce(submitted_at, created_at));
alter table public.listings alter column edited_at set default now(), alter column edited_at set not null;
create index listings_draft_edited_idx on public.listings (edited_at) where status = 'draft';
grant select (edited_at, draft_notice_at) on public.listings to authenticated;

-- Nur der Server setzt beide Spalten; eine Änderung des Besitzers stempelt edited_at.
create function private.listings_edited_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.edited_at := now();
    new.draft_notice_at := null;
    return new;
  end if;
  if private.is_server() then
    return new;
  end if;
  new.draft_notice_at := old.draft_notice_at;
  -- Vergleich über jsonb: Zeilenvergleich kennt für geography/geometry keinen eindeutigen Operator.
  new.edited_at := case when old.owner_id = (select auth.uid()) and to_jsonb(new) is distinct from to_jsonb(old)
                        then now() else old.edited_at end;
  return new;
end;
$$;
revoke execute on function private.listings_edited_at() from public, anon, authenticated;
create trigger listings_edited_at before insert or update on public.listings
  for each row execute function private.listings_edited_at();

-- Nicht im Inhalts-Hash: Pausieren und Fortsetzen bleiben ohne neue Prüfung (ADR 020, Entscheidung 4 aus M5).
create or replace function private.listing_content_hash(p_listing_id uuid)
returns bytea
language sql
stable
security definer
set search_path = ''
as $$
  select extensions.digest(jsonb_build_object(
    'listing', (select to_jsonb(l) - array['id', 'created_at', 'owner_id', 'country', 'status', 'reject_reason', 'reject_code', 'submitted_at',
                                          'published_at', 'approved_at', 'map_point', 'expires_at', 'search_vector', 'postal_prefix',
                                          'edited_at', 'draft_notice_at']
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

-- Kinder-Guard: Fotos, Wildarten und Ort stempeln edited_at --------------------------------------------------------
create or replace function private.listing_children_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid := coalesce(new.listing_id, old.listing_id);
  current_status public.listing_status;
  owner uuid;
  privileged boolean;
begin
  select l.owner_id into owner from public.listings l where l.id = target;
  -- Nur Server-Pfade sind privilegiert; Moderatoren ändern keine fremden Fotos, Wildarten oder Orte (ADR 014, A5).
  privileged := private.is_server_caller();
  if not privileged and not private.owns_editable_listing(target) then
    raise exception 'Keine Berechtigung für diese Anzeige' using errcode = '42501';
  end if;
  if not privileged and tg_op <> 'DELETE' then
    perform private.require_current_legal();
  end if;
  -- Sperre auf der Anzeige verhindert, dass parallele Uploads das Limit umgehen.
  select status into current_status from public.listings where id = target for update;
  if tg_op = 'INSERT' and tg_table_name = 'listing_photos' then
    if (select count(*) from public.listing_photos where listing_id = target) >= 8 then
      raise exception 'Höchstens 8 Fotos pro Anzeige' using errcode = '23514';
    end if;
    if not privileged then
      perform pg_advisory_xact_lock(hashtext('photo_creations:' || owner::text));
      if (select count(*) from private.photo_creations c
          where c.owner_id = owner and c.created_at > now() - interval '24 hours')
         >= private.setting_int('photo_create_daily_limit') then
        raise exception 'Tageslimit für Fotos erreicht' using errcode = 'RV002';
      end if;
      insert into private.photo_creations (owner_id) values (owner);
    end if;
  end if;
  -- Verschachtelt, weil PL/pgSQL die Felder von NEW auch in einem kurzgeschlossenen Ausdruck auflöst.
  if tg_table_name = 'listing_places' then
    if (tg_op = 'UPDATE' and (new.postal_code, new.place_name) is not distinct from (old.postal_code, old.place_name))
       or (tg_op = 'INSERT' and new.postal_code is null and new.place_name is null) then
      return new;
    end if;
  end if;
  -- Nur Änderungen durch den Besitzer führen zurück in die Prüfung; Sortierung und Alt-Text zählen mit.
  if current_status in ('active', 'paused') and not privileged then
    update public.listings set status = 'pending_review', reject_reason = null where id = target;
  end if;
  -- Verlassene Entwürfe (ADR 020): Fotos, Wildarten und Ort zählen als Bearbeitung des Besitzers.
  if not privileged then
    update public.listings set edited_at = now() where id = target;
  end if;
  return coalesce(new, old);
end;
$$;

-- Storage-Kandidaten um die Verifizierung erweitert -----------------------------------------------------------------
create or replace function public.maintenance_storage_objects(p_secret text, p_limit integer default 1000)
returns table (bucket_id text, name text, reason text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cutoff timestamptz := now() - make_interval(hours => private.setting_int('storage_orphan_hours'));
  doc_cutoff timestamptz := now() - make_interval(days => private.setting_int('verification_document_days'));
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
  union all
  (select o.bucket_id, o.name, 'verification_expired'::text from storage.objects o
   join public.verifications v on v.document_path = o.name
   where o.bucket_id = 'verification-docs' and v.status <> 'pending' and v.decided_at < doc_cutoff
   order by v.decided_at)
  union all
  (select o.bucket_id, o.name, 'verification_orphan'::text from storage.objects o
   where o.bucket_id = 'verification-docs' and o.created_at < cutoff
     and not exists (select 1 from public.verifications v where v.document_path = o.name)
   order by o.created_at)
  limit greatest(1, least(coalesce(p_limit, 1000), 1000));
end;
$$;

-- Dienstmail zum verlassenen Entwurf --------------------------------------------------------------------------------
create or replace function private.account_notification_details(p_kind text, p_ref_id uuid, p_user_id uuid, p_payload jsonb)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_kind in ('verification_verified', 'verification_rejected', 'verification_revoked') then (
      select jsonb_build_object(
        'document_type', v.document_type,
        'code', case p_kind when 'verification_rejected' then v.reject_code when 'verification_revoked' then v.revoke_code end,
        'reason', case p_kind when 'verification_rejected' then v.reject_reason when 'verification_revoked' then v.revoke_reason end,
        'decided_at', d.at,
        'appeal_until', case when p_kind <> 'verification_verified'
                             then d.at + make_interval(days => private.setting_int('appeal_window_days')) end)
      from public.verifications v
      cross join lateral (select case p_kind when 'verification_revoked' then v.revoked_at else v.decided_at end as at) d
      where v.id = p_ref_id and v.user_id = p_user_id
        and case p_kind
              when 'verification_verified' then v.status = 'verified'
              when 'verification_rejected' then v.status = 'rejected'
              else v.revoked_at is not null
            end)
    when p_kind in ('account_blocked', 'account_unblocked', 'account_warned') then (
      select jsonb_build_object(
        'code', a.details ->> 'code', 'reason', a.details ->> 'reason', 'decided_at', a.created_at,
        'appeal_until', case when p_kind <> 'account_unblocked'
                             then a.created_at + make_interval(days => private.setting_int('appeal_window_days')) end)
      from public.audit_log a
      where a.id = p_ref_id and a.target_type = 'profile' and a.target_id = p_user_id
        and a.action = case p_kind when 'account_blocked' then 'profile.blocked' when 'account_unblocked' then 'profile.unblocked'
                                   else 'profile.warned' end)
    when p_kind = 'report_resolved' then (
      select jsonb_build_object(
        'target_type', r.target_type, 'outcome', r.outcome, 'decided_at', r.handled_at,
        'listing_title', case when r.target_type = 'listing' then (select l.title from public.listings l where l.id = r.target_id) end,
        'appeal_until', r.handled_at + make_interval(days => private.setting_int('appeal_window_days')))
      from public.reports r
      where r.id = p_ref_id and r.reporter_id = p_user_id and r.status = 'handled')
    when p_kind = 'appeal_decided' then (
      select jsonb_build_object('status', ap.status, 'reason', ap.decision_note, 'decision_action', ap.decision_action,
                                'decided_at', ap.decided_at)
      from public.appeals ap where ap.id = p_ref_id and ap.user_id = p_user_id and ap.status <> 'open')
    -- Nur solange der Entwurf noch ein unbearbeiteter Entwurf ist; sonst keine Mail.
    when p_kind = 'draft_expiry_notice' then (
      select jsonb_build_object('listing_id', l.id, 'listing_title', l.title, 'deletes_at', p_payload ->> 'deletes_at')
      from public.listings l
      where l.id = p_ref_id and l.owner_id = p_user_id and l.status = 'draft' and l.edited_at <= l.draft_notice_at)
  end;
$$;

-- Täglicher Job -----------------------------------------------------------------------------------------------------
create function private.run_trust_maintenance()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  unsubmitted integer;
  docs integer;
  noticed integer := 0;
  drafts integer;
  r record;
  inactive interval := make_interval(months => private.setting_int('draft_inactive_months'));
  notice interval := make_interval(days => private.setting_int('draft_notice_days'));
begin
  delete from public.verifications
  where status = 'pending' and submitted_at is null
    and created_at < now() - make_interval(hours => private.setting_int('storage_orphan_hours'));
  get diagnostics unsubmitted = row_count;

  -- Datei ist über die Storage-API gelöscht (account-maintenance): Pfad entfernen, Metadaten bleiben.
  update public.verifications v set document_path = null, document_deleted_at = now()
  where v.document_path is not null and v.status <> 'pending'
    and v.decided_at < now() - make_interval(days => private.setting_int('verification_document_days'))
    and not exists (select 1 from storage.objects o where o.bucket_id = 'verification-docs' and o.name = v.document_path);
  get diagnostics docs = row_count;

  for r in
    select l.id, l.owner_id from public.listings l
    where l.status = 'draft' and l.edited_at < now() - inactive + notice
      and (l.draft_notice_at is null or l.draft_notice_at < l.edited_at)
    limit 1000
  loop
    update public.listings set draft_notice_at = now() where id = r.id;
    insert into private.account_notifications (kind, user_id, ref_id, payload)
    values ('draft_expiry_notice', r.owner_id, r.id,
            jsonb_build_object('deletes_at', to_char((now() + notice) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')))
    on conflict (kind, ref_id, user_id) do update set payload = excluded.payload, created_at = now(), claim_id = null,
      claimed_at = null, sent_at = null, attempts = 0, done_at = null;
    noticed := noticed + 1;
  end loop;

  delete from public.listings l
  where l.status = 'draft' and l.draft_notice_at < now() - notice and l.edited_at <= l.draft_notice_at;
  get diagnostics drafts = row_count;

  return jsonb_build_object('unsubmitted', unsubmitted, 'documents', docs, 'draft_notices', noticed, 'drafts_deleted', drafts);
end;
$$;
revoke execute on function private.run_trust_maintenance() from public, anon, authenticated;
select cron.schedule('trust-maintenance', '57 4 * * *', 'select private.run_trust_maintenance()');
