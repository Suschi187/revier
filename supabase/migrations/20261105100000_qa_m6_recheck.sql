-- QA M6 Nachprüfung N2 (docs/QA-REPORT.md, „M6 – Nachprüfung“): Entfernt die Moderation den Kartenpunkt, gilt der
-- Rest des Inhalts weiter als freigegeben. Aktive und pausierte Anzeigen haben immer den freigegebenen Inhalt
-- (jede Änderung des Besitzers führt in die Prüfung), deshalb wird der Freigabe-Hash hier auf den Stand ohne
-- Punkt gesetzt. Sonst ginge „Fortsetzen“ nach einer Pause in die Prüfung, obwohl der Besitzer nichts geändert hat.
create or replace function private.listings_point_removed_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Nur die Moderation an fremden Anzeigen; Besitzer und Server (Kreiswechsel, Verfremdung) nicht.
  if private.is_admin() and new.owner_id is distinct from (select auth.uid()) then
    perform private.write_audit('listing.point_removed', 'listing', new.id, jsonb_build_object('status', new.status));
    if new.status in ('active', 'paused') then
      update private.listing_approvals set content_hash = private.listing_content_hash(new.id)
      where listing_id = new.id;
    end if;
  end if;
  return null;
end;
$$;
revoke execute on function private.listings_point_removed_audit() from public, anon, authenticated;
