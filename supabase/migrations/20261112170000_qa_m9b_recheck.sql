-- QA M9b Nachprüfung (docs/QA-REPORT.md, „M9b – Nachprüfung“):
-- - N1: Admins entfernen den Kartenpunkt fremder Anzeigen nur noch über resolve_reports (Flag revier.point_code mit
--   Grund und Begründung); ein direktes UPDATE per PostgREST ergibt 42501, sonst entstünde eine Mail ohne Begründung.
--   Besitzer und Server-Pfade bleiben unberührt.
-- - N4: verification_doc_link_seconds wird seit F6 nicht mehr gelesen und entfällt.

create function private.listings_point_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.display_location is null and old.display_location is not null
     and not private.is_server()
     and new.owner_id is distinct from (select auth.uid())
     and coalesce(current_setting('revier.point_code', true), '') = '' then
    raise exception 'Kartenpunkt nur über resolve_reports mit Grund und Begründung' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function private.listings_point_guard() from public, anon, authenticated;
create trigger listings_point_guard before update of display_location on public.listings
  for each row execute function private.listings_point_guard();

delete from private.app_settings where key = 'verification_doc_link_seconds';
