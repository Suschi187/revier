-- Fix QA M2 F1 (ADR 010): Revier ist passwortlos. Supabase Auth hat keinen Schalter nur für
-- Passwörter. Ablehnen geht nicht, weil Auth auch bei der Anmeldung per Code intern ein
-- zufälliges Passwort setzt. Deshalb leert die DB den Hash bei jedem Schreiben: Kein Passwort
-- (aus Registrierung oder updateUser) ist je zur Anmeldung nutzbar. Das verhindert die
-- Kontoübernahme vor der Registrierung und dauerhaften Zugang nach einem Token-Diebstahl.

create function private.discard_password()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.encrypted_password := '';
  return new;
end;
$$;

revoke execute on function private.discard_password() from public, anon, authenticated;

-- Ohne Spaltenliste: Auth schreibt bei Updates alle Spalten, so greift der Trigger immer.
create trigger discard_password
  before insert or update on auth.users
  for each row execute function private.discard_password();
