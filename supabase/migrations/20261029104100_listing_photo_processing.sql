-- M3 Pflichtpunkt A (Plan M3 Abschnitt 3, Auflagen 2–4, ADR 011): Fotos ohne EXIF/GPS.
-- Ablauf: Zeile in listing_photos anlegen → Original in den privaten Eingang listing-uploads →
-- Edge Function process-listing-photo kodiert neu und schreibt nach listing-photos. In listing-photos
-- schreibt nur noch service_role; öffentlich lesbar sind nur verarbeitete Fotos sichtbarer Anzeigen.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('listing-uploads', 'listing-uploads', false, 15728640, array['image/jpeg', 'image/png']);

-- Clients verkleinern vorher und liefern JPEG (Vertrag Web/iOS, ADR 011); PNG nur als Rückfall.
update storage.buckets set allowed_mime_types = array['image/jpeg'] where id = 'listing-photos';

insert into private.app_settings (key, value, description) values
  ('photo_create_daily_limit', '100', 'Höchstzahl neu angelegter Fotos je Konto in 24 h, auch nach Löschen (Kosten-DoS, Review Plan M3 A9)');

-- ---------------------------------------------------------------------------
-- Spalten. Pfade leitet der Server aus der id ab; processed_at, width, height setzt nur service_role.
-- ---------------------------------------------------------------------------
alter table public.listing_photos
  add column upload_path text unique,
  add column thumb_path text unique check (thumb_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,100}$'),
  add column processed_at timestamptz,
  add column width integer check (width between 1 and 4096),
  add column height integer check (height between 1 and 4096),
  add column alt_text text check (alt_text is null or char_length(btrim(alt_text)) between 1 and 200);

-- Platzhalter, den der Pfad-Trigger immer ersetzt; macht storage_path im Insert-Typ optional.
alter table public.listing_photos alter column storage_path set default '';

revoke insert, update on public.listing_photos from authenticated;
grant insert (listing_id, sort_order, alt_text) on public.listing_photos to authenticated;
grant update (sort_order, alt_text) on public.listing_photos to authenticated;

-- Pfade aus Besitzer, Anzeige und Foto-id (ersetzt die Präfixprüfung aus Review M1).
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
    if (new.listing_id, new.storage_path, new.upload_path, new.thumb_path)
       is distinct from (old.listing_id, old.storage_path, old.upload_path, old.thumb_path)
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
  if not private.is_server_caller() then
    new.processed_at := null;
    new.width := null;
    new.height := null;
  end if;
  return new;
end;
$$;

drop trigger listing_photos_path_guard on public.listing_photos;
create trigger listing_photos_path_guard
  before insert or update on public.listing_photos
  for each row execute function private.listing_photos_path_guard();

-- ---------------------------------------------------------------------------
-- Tageslimit für Fotos (A9): Zähler übersteht Löschungen.
-- ---------------------------------------------------------------------------
create table private.photo_creations (
  owner_id uuid not null references public.profiles (user_id) on delete cascade,
  created_at timestamptz not null default now()
);
create index photo_creations_owner_idx on private.photo_creations (owner_id, created_at);
alter table private.photo_creations enable row level security;

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
  privileged boolean := private.is_admin() or private.is_server_caller();
begin
  if not privileged and not private.owns_editable_listing(target) then
    raise exception 'Keine Berechtigung für diese Anzeige' using errcode = '42501';
  end if;
  -- Sperre auf der Anzeige verhindert, dass parallele Uploads das Limit umgehen.
  select status, owner_id into current_status, owner from public.listings where id = target for update;
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
  -- Nur Änderungen durch den Besitzer führen zurück in die Prüfung; Sortierung und Alt-Text zählen mit.
  if current_status in ('active', 'paused') and not privileged then
    update public.listings set status = 'pending_review', reject_reason = null where id = target;
  end if;
  return coalesce(new, old);
end;
$$;

-- ---------------------------------------------------------------------------
-- Sichtbarkeit der Zeilen: Fremde sehen nur verarbeitete Fotos sichtbarer Anzeigen.
-- ---------------------------------------------------------------------------
drop policy listing_photos_select on public.listing_photos;
create policy listing_photos_select on public.listing_photos
  for select to anon, authenticated
  using (exists (
    select 1 from public.listings l
    where l.id = listing_id and (processed_at is not null or l.owner_id = (select auth.uid()))
  ));

-- ---------------------------------------------------------------------------
-- Storage: listing-photos nur noch vom Server beschreibbar, Lesen nur verarbeitet.
-- ---------------------------------------------------------------------------
drop policy listing_photos_insert_registered on storage.objects;
drop policy listing_photos_select_registered on storage.objects;
create policy listing_photos_select_processed on storage.objects
  for select to anon, authenticated
  using (
    bucket_id = 'listing-photos'
    and exists (
      select 1 from public.listing_photos p
      where (p.storage_path = name or p.thumb_path = name) and p.processed_at is not null
    )
  );

-- Eingang: nur INSERT für den Besitzer, nur für registrierte, unverarbeitete Fotos.
-- Kein SELECT, UPDATE oder DELETE: Originale können GPS enthalten; aufräumen tut der Server.
create policy listing_uploads_insert_registered on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'listing-uploads'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.listing_photos p
      where p.upload_path = name and p.processed_at is null and private.owns_editable_listing(p.listing_id)
    )
  );
