-- M3 Commit 5b (ADR 012, Review Plan M3 PLZ 1–4): PLZ und Ortsname je Anzeige.
-- Nie öffentlich: eine eigene Tabelle, nur für den Besitzer und Admins (aal2) lesbar. Öffentlich ist
-- nur listings.postal_prefix (zwei Ziffern), das der Server ableitet.
-- Ob die PLZ im Verzeichnis existiert und zum Kreis passt, prüft die Bereitschaftsprüfung beim Absenden
-- und bei der Freigabe (Commit 6). Beim Schreiben prüft die DB nur das Format.

alter table public.listings add column postal_prefix text check (postal_prefix ~ '^[0-9]{2}$');
comment on column public.listings.postal_prefix is
  'Erste zwei Ziffern der PLZ aus listing_places, gesetzt nur vom Server (ADR 012)';

-- 1:1 zur Anzeige. Kein FK auf postal_codes, damit Anzeigen ein Update der Referenzdaten überstehen.
-- Bei Gesuchen sind PLZ und Ort optional (Plan M3 6.1), deshalb nullable.
create table public.listing_places (
  listing_id uuid primary key references public.listings (id) on delete cascade,
  postal_code text,
  place_name text check (place_name is null or char_length(place_name) between 1 and 100),
  updated_at timestamptz not null default now()
);
comment on table public.listing_places is
  'PLZ und Ort des Reviers bzw. des gesuchten Gebiets. Nie öffentlich, nie in Suche oder Filtern (ADR 012).';

alter table public.listing_places enable row level security;

-- PLZ und Ortsname getrimmt, Format der PLZ nach dem Land der Anzeige. Läuft vor dem Guard (Name).
-- Das Land wird nicht gespeichert: Es folgt immer dem Kreis der Anzeige.
create function private.listing_places_prepare()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  listing_country public.country_code;
begin
  if tg_op = 'UPDATE' and new.listing_id is distinct from old.listing_id then
    raise exception 'listing_id ist unveränderlich' using errcode = '42501';
  end if;
  select l.country into listing_country from public.listings l where l.id = new.listing_id;
  new.postal_code := nullif(btrim(new.postal_code), '');
  new.place_name := nullif(btrim(new.place_name), '');
  new.updated_at := now();
  -- Fehlermeldungen nennen nur Feldcodes, nie den Wert (Review Plan M3 PLZ 5).
  if new.postal_code is not null and not (case listing_country
      when 'DE' then new.postal_code ~ '^[0-9]{5}$'
      when 'AT' then new.postal_code ~ '^[1-9][0-9]{3}$'
      when 'CH' then new.postal_code ~ '^[1-9][0-9]{3}$'
      when 'CZ' then new.postal_code ~ '^[1-7][0-9]{2} ?[0-9]{2}$'
      when 'PL' then new.postal_code ~ '^[0-9]{2}-[0-9]{3}$'
      else false end) then
    raise exception 'PLZ hat nicht das Format des Landes' using errcode = '23514', hint = 'place.postal_code.format';
  end if;
  return new;
end;
$$;
revoke execute on function private.listing_places_prepare() from public, anon, authenticated, service_role;

create trigger listing_places_a_prepare
  before insert or update on public.listing_places
  for each row execute function private.listing_places_prepare();

-- Guard für Kinder-Tabellen um listing_places erweitert (Review Plan M3 PLZ 4):
-- - Eine Änderung an PLZ oder Ort führt eine freigegebene Anzeige zurück in die Prüfung.
-- - Ein unverändert zurückgeschriebener Ort (oder ein leerer neuer) lässt den Status stehen.
-- - Für listing_places gilt ein Admin an der eigenen Anzeige als Besitzer (QA M3 F1); Admins schreiben
--   dort ohnehin nicht (keine Policy). Fotos und Wildarten folgen mit dem neuen Guard in Commit 6.
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
  privileged boolean := private.is_server_caller()
    or (tg_table_name <> 'listing_places' and private.is_admin());
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
  return coalesce(new, old);
end;
$$;

create trigger listing_places_guard
  before insert or update on public.listing_places
  for each row execute function private.listing_children_guard();

-- Öffentliches Präfix nachführen. Läuft als Definer (is_server), also am listings_guard vorbei und ohne
-- Statuswechsel; den Statuswechsel hat der Guard oben schon gesetzt.
create function private.listing_places_sync_prefix()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  prefix text := left(regexp_replace(new.postal_code, '[^0-9]', '', 'g'), 2);
begin
  update public.listings set postal_prefix = prefix
  where id = new.listing_id and postal_prefix is distinct from prefix;
  return null;
end;
$$;
revoke execute on function private.listing_places_sync_prefix() from public, anon, authenticated, service_role;

create trigger listing_places_sync_prefix
  after insert or update of postal_code on public.listing_places
  for each row execute function private.listing_places_sync_prefix();

-- RLS: Lesen nur Besitzer und Admin mit aal2 (is_admin, nicht has_admin_role). Schreiben nur der Besitzer
-- einer bearbeitbaren Anzeige eines aktiven Kontos. Kein DELETE: Die Zeile verschwindet mit der Anzeige.
create policy listing_places_select on public.listing_places
  for select to authenticated
  using (
    exists (select 1 from public.listings l where l.id = listing_id and l.owner_id = (select auth.uid()))
    or (select private.is_admin())
  );
create policy listing_places_insert_own on public.listing_places
  for insert to authenticated
  with check ((select private.owns_editable_listing(listing_id)));
create policy listing_places_update_own on public.listing_places
  for update to authenticated
  using ((select private.owns_editable_listing(listing_id)))
  with check ((select private.owns_editable_listing(listing_id)));

revoke all on public.listing_places from anon, authenticated;
grant select on public.listing_places to authenticated;
grant insert (listing_id, postal_code, place_name) on public.listing_places to authenticated;
grant update (postal_code, place_name) on public.listing_places to authenticated;

-- RPC für Web und iOS: Kreis und Ort in einer Transaktion (Review Plan M3 PLZ 3). Security invoker,
-- damit RLS, Guards und Legal-Gate greifen. Fremde und unbekannte Anzeigen bekommen dieselbe Antwort.
create function public.set_listing_location(
  p_listing_id uuid,
  p_region_id uuid,
  p_postal_code text default null,
  p_place_name text default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Gleicher Fehler wie private.require_current_legal(), das für Nutzer nicht ausführbar bleibt.
  if not private.has_accepted_current_legal() then
    raise exception 'legal_consent_required'
      using errcode = 'RV001', hint = 'Zustimmung zur aktuellen Version per legal_status() und accept_legal() einholen';
  end if;
  if not private.owns_editable_listing(p_listing_id) then
    raise exception 'Anzeige nicht gefunden' using errcode = '42501';
  end if;
  -- Nur bei echter Änderung schreiben: UPDATE OF region_id löst sonst die Verfremdung aus.
  update public.listings set region_id = p_region_id
  where id = p_listing_id and region_id is distinct from p_region_id;
  -- Erst UPDATE, dann INSERT statt ON CONFLICT: Bei ON CONFLICT liefe der Insert-Guard auch für einen
  -- unveränderten Ort und nähme eine freigegebene Anzeige aus der Öffentlichkeit.
  update public.listing_places set postal_code = p_postal_code, place_name = p_place_name
  where listing_id = p_listing_id;
  if not found then
    insert into public.listing_places (listing_id, postal_code, place_name)
    values (p_listing_id, p_postal_code, p_place_name);
  end if;
end;
$$;
revoke execute on function public.set_listing_location(uuid, uuid, text, text) from public, anon;
grant execute on function public.set_listing_location(uuid, uuid, text, text) to authenticated;

