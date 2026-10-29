-- M3 Commit 5 (ADR 011, Spike-Review Auflagen 1, 4, 7): Datenbankseite der Edge Function process-listing-photo.
-- - Der Eingang nimmt nur noch JPEG an; Clients wandeln vorher um (Web per Canvas, iOS nativ).
-- - Höchstens 3 Verarbeitungsversuche je Foto. Den Zähler setzt nur der Server; nach einem Abbruch der
--   Plattform (546/Timeout) braucht ein neuer Versuch irgendwann eine neue Fotozeile.
-- - Zwei RPCs nur für service_role: Versuch beanspruchen und Ergebnis eintragen, jeweils atomar.

update storage.buckets set allowed_mime_types = array['image/jpeg'] where id = 'listing-uploads';

insert into private.app_settings (key, value, description) values
  ('photo_processing_max_attempts', '3', 'Höchstzahl der Verarbeitungsversuche je Foto (Kosten-DoS, Spike-Review Auflage 4)');

alter table public.listing_photos
  add column processing_attempts smallint not null default 0 check (processing_attempts >= 0);
comment on column public.listing_photos.processing_attempts is
  'Verarbeitungsversuche der Edge Function, gesetzt nur vom Server (ADR 011)';

-- Beansprucht einen Versuch für ein Foto des Nutzers. Ergebnis:
--   claimed    Versuch gezählt, Pfade zurück
--   processed  schon verarbeitet (idempotent, kein Versuch gezählt)
--   exhausted  keine Versuche mehr
--   not_found  unbekannt, fremd, entfernte Anzeige oder gesperrtes Konto (eine Antwort für alles)
create function public.claim_photo_processing(p_photo_id uuid, p_user_id uuid)
returns table (state text, upload_path text, storage_path text, thumb_path text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  photo record;
begin
  select p.id, p.processed_at, p.processing_attempts, p.upload_path, p.storage_path, p.thumb_path into photo
  from public.listing_photos p join public.listings l on l.id = p.listing_id
  where p.id = p_photo_id and l.owner_id = p_user_id and l.status <> 'removed' and private.is_active_user(l.owner_id)
  for update of p;
  if not found then
    return query select 'not_found', null::text, null::text, null::text;
  elsif photo.processed_at is not null then
    return query select 'processed', null::text, null::text, null::text;
  elsif photo.processing_attempts >= private.setting_int('photo_processing_max_attempts') then
    return query select 'exhausted', null::text, null::text, null::text;
  else
    update public.listing_photos set processing_attempts = processing_attempts + 1 where id = photo.id;
    return query select 'claimed', photo.upload_path, photo.storage_path, photo.thumb_path;
  end if;
end;
$$;

-- Trägt das Ergebnis ein. Ergebnis:
--   processed  eingetragen; eine freigegebene Anzeige geht zurück in die Prüfung (Review Plan M3 A1)
--   already    ein paralleler Lauf war schneller (gleiche Pfade, Ausgaben behalten)
--   gone       Foto inzwischen gelöscht (Ausgaben wieder entfernen)
create function public.complete_photo_processing(p_photo_id uuid, p_width integer, p_height integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid;
begin
  update public.listing_photos set processed_at = now(), width = p_width, height = p_height
  where id = p_photo_id and processed_at is null
  returning listing_id into target;
  if target is null then
    return case when exists (select 1 from public.listing_photos where id = p_photo_id) then 'already' else 'gone' end;
  end if;
  update public.listings set status = 'pending_review', reject_reason = null
  where id = target and status in ('active', 'paused');
  return 'processed';
end;
$$;

revoke execute on function public.claim_photo_processing(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.complete_photo_processing(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_photo_processing(uuid, uuid) to service_role;
grant execute on function public.complete_photo_processing(uuid, integer, integer) to service_role;
