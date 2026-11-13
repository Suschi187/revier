-- Mittlere Bildgröße (M10a Nacharbeit, Detail-LCP): Die Edge Function schreibt neben Bild (2048) und Thumbnail (480)
-- eine dritte Datei mit 1024 px langer Seite. Die Detailseite lädt sie statt des großen Bildes.
-- Bestehende Fotos bekommen den Pfad sofort, die Datei später (scripts/backfill-medium-photos.ts); bis dahin
-- liefert /api/photos/<id>/medium das große Bild aus.

alter table public.listing_photos
  add column medium_path text unique check (medium_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,100}$');

-- Pfade wie bisher aus Besitzer, Anzeige und Foto-id; medium_path setzt nur der Server.
create or replace function private.listing_photos_path_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  prefix text;
begin
  if tg_op = 'UPDATE' then
    if (new.listing_id, new.storage_path, new.upload_path, new.thumb_path, new.medium_path)
       is distinct from (old.listing_id, old.storage_path, old.upload_path, old.thumb_path, old.medium_path)
       and not private.is_server_caller() then
      raise exception 'Fotopfade setzt nur der Server' using errcode = '42501';
    end if;
    return new;
  end if;

  select l.owner_id::text || '/' || l.id::text || '/' into prefix from public.listings l where l.id = new.listing_id;
  if prefix is null then
    raise exception 'Keine Berechtigung für diese Anzeige' using errcode = '42501';
  end if;
  new.upload_path := prefix || new.id::text;
  new.storage_path := prefix || new.id::text || '.jpg';
  new.thumb_path := prefix || new.id::text || '_thumb.jpg';
  new.medium_path := prefix || new.id::text || '_medium.jpg';
  if not private.is_server_caller() then
    new.processed_at := null;
    new.width := null;
    new.height := null;
  end if;
  return new;
end;
$$;

update public.listing_photos set medium_path = left(storage_path, -4) || '_medium.jpg'
where medium_path is null and storage_path like '%.jpg';

-- Versuch beanspruchen: zusätzlich den Pfad der mittleren Größe zurückgeben (Rückgabetyp ändert sich).
drop function public.claim_photo_processing(uuid, uuid);
create function public.claim_photo_processing(p_photo_id uuid, p_user_id uuid)
returns table (state text, upload_path text, storage_path text, thumb_path text, medium_path text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  photo record;
begin
  select p.id, p.processed_at, p.processing_attempts, p.upload_path, p.storage_path, p.thumb_path, p.medium_path into photo
  from public.listing_photos p join public.listings l on l.id = p.listing_id
  where p.id = p_photo_id and l.owner_id = p_user_id and l.status <> 'removed' and private.is_active_user(l.owner_id)
  for update of p;
  if not found then
    return query select 'not_found', null::text, null::text, null::text, null::text;
  elsif photo.processed_at is not null then
    return query select 'processed', null::text, null::text, null::text, null::text;
  elsif photo.processing_attempts >= private.setting_int('photo_processing_max_attempts') then
    return query select 'exhausted', null::text, null::text, null::text, null::text;
  else
    update public.listing_photos set processing_attempts = processing_attempts + 1 where id = photo.id;
    return query select 'claimed', photo.upload_path, photo.storage_path, photo.thumb_path, photo.medium_path;
  end if;
end;
$$;

revoke execute on function public.claim_photo_processing(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_photo_processing(uuid, uuid) to service_role;

-- Lesen: auch die mittlere Größe nur für verarbeitete Fotos (Sichtbarkeit wie Bild und Thumbnail).
drop policy listing_photos_select_processed on storage.objects;
create policy listing_photos_select_processed on storage.objects
  for select to anon, authenticated
  using (
    bucket_id = 'listing-photos'
    and exists (
      select 1 from public.listing_photos p
      where (p.storage_path = name or p.thumb_path = name or p.medium_path = name) and p.processed_at is not null
    )
  );

-- Aufräumen: die mittlere Größe ist keine verwaiste Datei.
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
     and not exists (select 1 from public.listing_photos p where p.storage_path = o.name or p.thumb_path = o.name or p.medium_path = o.name)
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
