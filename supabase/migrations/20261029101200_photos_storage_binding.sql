-- Review M1 (Architekt 2/3/9/11, QA F3): Fotos an Besitzer und Anzeige binden, Uploads nur für
-- registrierte Fotos (Limit 8 gilt damit auch im Bucket), verwaiste Dateien nicht mehr lesbar,
-- Storage-Policies über den indizierten storage_path statt Text-Vergleich je Anzeige.
-- Ablauf im Client: erst Zeile in listing_photos anlegen, dann Datei unter genau diesem Pfad hochladen.

-- Pfad muss {owner_id}/{listing_id}/ der zugehörigen Anzeige sein.
create function private.listing_photos_path_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  expected_prefix text;
begin
  select l.owner_id::text || '/' || l.id::text || '/' into expected_prefix
  from public.listings l where l.id = new.listing_id;
  if expected_prefix is null or left(new.storage_path, length(expected_prefix)) <> expected_prefix then
    raise exception 'storage_path muss mit {owner_id}/{listing_id}/ der Anzeige beginnen' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke execute on function private.listing_photos_path_guard() from public, anon, authenticated;

create trigger listing_photos_path_guard
  before insert or update of storage_path, listing_id on public.listing_photos
  for each row execute function private.listing_photos_path_guard();

-- Erst Berechtigung prüfen, dann sperren: kein FOR UPDATE auf fremde Anzeigen und kein
-- Existenz-Orakel über unterschiedliche Fehlercodes.
create or replace function private.listing_children_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid := coalesce(new.listing_id, old.listing_id);
  current_status public.listing_status;
  privileged boolean := private.is_admin() or private.is_server_caller();
begin
  if not privileged and not private.owns_editable_listing(target) then
    raise exception 'Keine Berechtigung für diese Anzeige' using errcode = '42501';
  end if;

  -- Sperre auf der Anzeige verhindert, dass parallele Uploads das Limit umgehen.
  select status into current_status from public.listings where id = target for update;

  if tg_op = 'INSERT' and tg_table_name = 'listing_photos'
     and (select count(*) from public.listing_photos where listing_id = target) >= 8 then
    raise exception 'Höchstens 8 Fotos pro Anzeige' using errcode = '23514';
  end if;

  if current_status in ('active', 'paused') and not privileged then
    update public.listings set status = 'pending_review', reject_reason = null where id = target;
  end if;

  return coalesce(new, old);
end;
$$;

-- Storage-Policies für listing-photos neu ---------------------------------------
drop policy listing_photos_insert_own on storage.objects;
drop policy listing_photos_select_visible on storage.objects;
drop policy listing_photos_delete_own on storage.objects;

-- Hochladen nur für ein bereits registriertes Foto einer eigenen, bearbeitbaren Anzeige.
create policy listing_photos_insert_registered on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'listing-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.listing_photos p
      where p.storage_path = name and private.owns_editable_listing(p.listing_id)
    )
  );

-- Lesen nur registrierter Fotos; die RLS von listing_photos prüft die Sichtbarkeit der Anzeige.
create policy listing_photos_select_registered on storage.objects
  for select to anon, authenticated
  using (
    bucket_id = 'listing-photos'
    and exists (select 1 from public.listing_photos p where p.storage_path = name)
  );

-- Löschen über den Ordner, damit der Besitzer auch Dateien entfernen kann, deren Zeile schon weg ist.
create policy listing_photos_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'listing-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (storage.foldername(name))[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and private.owns_editable_listing(((storage.foldername(name))[2])::uuid)
  );

-- Postgres verlangt für DELETE auch eine passende SELECT-Policy: Besitzer sehen ihren eigenen
-- Ordner (auch verwaiste Dateien), damit sie aufräumen können. Fremde sehen weiterhin nur
-- registrierte Fotos sichtbarer Anzeigen.
create policy listing_photos_select_own_folder on storage.objects
  for select to authenticated
  using (bucket_id = 'listing-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
