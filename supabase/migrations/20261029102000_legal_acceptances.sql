-- M2 (ADR 010): Zustimmung zu Nutzungsbedingungen und Kenntnisnahme der Datenschutzerklärung.
-- Historie je Version, Schreiben nur über accept_legal(), gleiches Verhalten für Web und iOS.

create type public.legal_document as enum ('terms', 'privacy');
create type public.client_source as enum ('web', 'ios');

-- Aktuelle Versionen der Rechtstexte. Platzhalter, bis der Anwalt liefert (SPEC 7.2).
insert into private.app_settings (key, value, description) values
  ('legal_terms_version', '"2026-10-draft"', 'Aktuelle Version der Nutzungsbedingungen (Platzhaltertext)'),
  ('legal_privacy_version', '"2026-10-draft"', 'Aktuelle Version der Datenschutzerklärung (Platzhaltertext)');

create table public.legal_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  document public.legal_document not null,
  version text not null check (char_length(version) between 1 and 40),
  source public.client_source not null,
  accepted_at timestamptz not null default now(),
  unique (user_id, document, version)
);

alter table public.legal_acceptances enable row level security;

create policy legal_acceptances_select_own on public.legal_acceptances
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy legal_acceptances_select_admin on public.legal_acceptances
  for select to authenticated
  using ((select private.is_admin()));

grant select on public.legal_acceptances to authenticated;
-- Kein INSERT/UPDATE/DELETE für API-Rollen: Nachweis ist unveränderlich, Löschen per cascade.

-- ---------------------------------------------------------------------------
-- Hilfsfunktionen
-- ---------------------------------------------------------------------------
create function private.setting_text(setting_key text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select value #>> '{}' from private.app_settings where key = setting_key;
$$;

-- DB-Gate (ADR 010): Hat der aktuelle Nutzer beiden aktuellen Versionen zugestimmt?
-- Ab M3 von listings, ab M7 von Chat-Policies genutzt; Meldungen bewusst nicht.
create function private.has_accepted_current_legal()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1 from public.legal_acceptances a
      where a.user_id = (select auth.uid()) and a.document = 'terms'
        and a.version = private.setting_text('legal_terms_version'))
    and exists (
      select 1 from public.legal_acceptances a
      where a.user_id = (select auth.uid()) and a.document = 'privacy'
        and a.version = private.setting_text('legal_privacy_version'));
$$;

revoke execute on function private.setting_text(text) from public, anon, authenticated;
grant execute on function private.setting_text(text) to service_role;
grant execute on function private.has_accepted_current_legal() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------
create function public.legal_status()
returns table (terms_version text, privacy_version text, accepted boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    private.setting_text('legal_terms_version'),
    private.setting_text('legal_privacy_version'),
    private.has_accepted_current_legal();
$$;

-- Der Client schickt die Versionen zurück, die er angezeigt hat. Weichen sie von den aktuellen ab
-- (Texte inzwischen geändert), wird nichts gespeichert und neu angezeigt. Wiederholung ist harmlos.
create function public.accept_legal(p_terms_version text, p_privacy_version text, p_source public.client_source)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null or not private.is_active_user(uid) then
    raise exception 'Nur für angemeldete, aktive Konten' using errcode = '42501';
  end if;

  if p_terms_version is distinct from private.setting_text('legal_terms_version')
     or p_privacy_version is distinct from private.setting_text('legal_privacy_version') then
    raise exception 'Veraltete Version der Rechtstexte' using errcode = '22023';
  end if;

  insert into public.legal_acceptances (user_id, document, version, source)
  values (uid, 'terms', p_terms_version, p_source), (uid, 'privacy', p_privacy_version, p_source)
  on conflict (user_id, document, version) do nothing;
end;
$$;

revoke execute on function public.legal_status() from public, anon;
revoke execute on function public.accept_legal(text, text, public.client_source) from public, anon;
grant execute on function public.legal_status() to authenticated;
grant execute on function public.accept_legal(text, text, public.client_source) to authenticated;
