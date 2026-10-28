-- M1 Fundament: Erweiterungen, Enums, Schema private, Rollen, Access Token Hook, Einstellungen.
-- Siehe docs/adr/005-rollen-admin-2fa.md und docs/adr/008-retention-loeschung.md.

create extension if not exists postgis with schema extensions;

-- Keine neue Funktion ist ohne ausdrückliche Freigabe ausführbar. Das muss global gelten:
-- Schema-bezogene Default Privileges können das globale EXECUTE für PUBLIC nicht entziehen.
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Enums (SPEC 3.1)
-- ---------------------------------------------------------------------------
create type public.country_code as enum ('DE', 'AT', 'CH', 'CZ', 'PL');
create type public.language_code as enum ('de', 'en', 'cs', 'pl');
create type public.currency_code as enum ('EUR', 'CHF', 'CZK', 'PLN');
create type public.account_type as enum ('private', 'business');
create type public.verification_status as enum ('none', 'pending', 'verified', 'rejected');
create type public.verification_request_status as enum ('pending', 'verified', 'rejected');
create type public.document_type as enum ('jagdschein', 'jagdkarte', 'revierbescheinigung', 'gewerbe');
create type public.region_level as enum ('state', 'district');
create type public.listing_kind as enum ('lease', 'permit', 'driven_hunt', 'trophy_hunt', 'helper');
create type public.listing_direction as enum ('offer', 'wanted');
create type public.price_unit as enum ('total', 'per_year', 'per_hectare_year', 'per_day', 'per_animal', 'on_request');
create type public.listing_status as enum ('draft', 'pending_review', 'active', 'paused', 'expired', 'rejected', 'removed');
create type public.report_target as enum ('listing', 'message', 'profile');
create type public.report_reason as enum ('scam', 'illegal', 'weapons', 'harassment', 'wrong_category', 'other');
create type public.report_status as enum ('open', 'handled');
create type public.device_platform as enum ('ios');

-- ---------------------------------------------------------------------------
-- Schema private: nicht über die API erreichbar (nicht in api.schemas).
-- anon/authenticated brauchen USAGE, damit Policies die Hilfsfunktionen aufrufen können;
-- Tabellen hier bekommen keine Rechte für diese Rollen.
-- ---------------------------------------------------------------------------
create schema private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated, service_role;

create type private.app_role as enum ('admin');

create table private.user_roles (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null references auth.users (id) on delete cascade,
  role private.app_role not null,
  unique (user_id, role)
);
alter table private.user_roles enable row level security;

-- Konfigurierbare Fristen (ADR 008). Werte sind Platzhalter bis zur anwaltlichen Prüfung.
create table private.app_settings (
  key text primary key,
  value jsonb not null,
  description text not null,
  updated_at timestamptz not null default now()
);
alter table private.app_settings enable row level security;

insert into private.app_settings (key, value, description) values
  ('verification_document_days', '30', 'Tage nach Entscheidung, bis das Verifizierungsdokument gelöscht wird (Platzhalter, rechtlich prüfen)'),
  ('account_deletion_grace_days', '0', 'Tage zwischen Löschantrag und harter Löschung (Platzhalter)'),
  ('audit_log_months', '24', 'Aufbewahrung Audit-Log in Monaten (Platzhalter, DSA prüfen)'),
  ('handled_reports_months', '12', 'Aufbewahrung erledigter Meldungen in Monaten (Platzhalter, DSA prüfen)'),
  ('listing_active_days', '60', 'Laufzeit einer freigegebenen Anzeige in Tagen (SPEC 3.1)');

-- ---------------------------------------------------------------------------
-- Hilfsfunktionen für Policies
-- ---------------------------------------------------------------------------

-- Admin-Rechte: Rolle in der Tabelle (Entzug wirkt sofort) UND 2FA im aktuellen Token.
create function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select auth.jwt() ->> 'aal') = 'aal2', false)
     and exists (
       select 1 from private.user_roles r
       where r.user_id = (select auth.uid()) and r.role = 'admin'
     );
$$;

-- Nur für UI-Hinweise, nie für Rechte.
create function private.has_admin_role()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.user_roles r
    where r.user_id = (select auth.uid()) and r.role = 'admin'
  );
$$;

create function private.setting_int(setting_key text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select (value #>> '{}')::integer from private.app_settings where key = setting_key;
$$;

grant execute on function private.is_admin() to anon, authenticated, service_role;
grant execute on function private.has_admin_role() to authenticated, service_role;
grant execute on function private.setting_int(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Custom Access Token Hook: Claim app_role für die UI (ADR 005)
-- ---------------------------------------------------------------------------
create function private.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  claims jsonb := event -> 'claims';
begin
  if exists (
    select 1 from private.user_roles r
    where r.user_id = (event ->> 'user_id')::uuid and r.role = 'admin'
  ) then
    claims := jsonb_set(claims, '{app_role}', '"admin"');
  else
    claims := claims - 'app_role';
  end if;
  return jsonb_set(event, '{claims}', claims);
end;
$$;

revoke execute on function private.custom_access_token_hook(jsonb) from public, anon, authenticated;
grant usage on schema private to supabase_auth_admin;
grant execute on function private.custom_access_token_hook(jsonb) to supabase_auth_admin;
