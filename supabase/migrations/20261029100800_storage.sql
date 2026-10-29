-- M1 Storage-Buckets und Policies (CLAUDE.md: Jagdschein-Uploads privat, nur Besitzer und Admins).
-- Per Migration statt config.toml, damit lokal und Cloud identisch sind.
-- Dateien gelöschter Datensätze entfernt der Lösch-Job über die Storage-API (M9, ADR 008).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('verification-docs', 'verification-docs', false, 10485760,
    array['image/jpeg', 'image/png', 'image/heic', 'application/pdf']),
  ('listing-photos', 'listing-photos', false, 8388608,
    array['image/jpeg', 'image/png', 'image/webp', 'image/heic']);

-- verification-docs: Pfad {user_id}/{datei} -----------------------------------
create policy verification_docs_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'verification-docs'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and array_length(storage.foldername(name), 1) = 1
    and (select private.is_active_user((select auth.uid())))
  );

create policy verification_docs_select_own on storage.objects
  for select to authenticated
  using (bucket_id = 'verification-docs' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy verification_docs_select_admin on storage.objects
  for select to authenticated
  using (bucket_id = 'verification-docs' and (select private.is_admin()));

-- listing-photos: Pfad {owner_id}/{listing_id}/{datei} --------------------------
create policy listing_photos_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'listing-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and array_length(storage.foldername(name), 1) = 2
    and exists (
      select 1 from public.listings l
      where l.id::text = (storage.foldername(name))[2] and private.owns_editable_listing(l.id)
    )
  );

-- Lesbar genau dann, wenn die Anzeige für den Aufrufer sichtbar ist (RLS der listings greift).
create policy listing_photos_select_visible on storage.objects
  for select to anon, authenticated
  using (
    bucket_id = 'listing-photos'
    and exists (select 1 from public.listings l where l.id::text = (storage.foldername(name))[2])
  );

create policy listing_photos_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'listing-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.listings l
      where l.id::text = (storage.foldername(name))[2] and private.owns_editable_listing(l.id)
    )
  );
