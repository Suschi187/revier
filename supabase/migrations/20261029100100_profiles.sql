-- M1 profiles (SPEC 3.1, 3.4). Nutzerbezogene Fremdschlüssel anderer Tabellen zeigen auf
-- profiles.user_id (= auth.uid()), damit Policies direkt mit auth.uid() vergleichen können.

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 60),
  account_type public.account_type not null default 'private',
  business_name text check (business_name is null or char_length(btrim(business_name)) between 1 and 120),
  country public.country_code not null default 'DE',
  preferred_language public.language_code not null default 'de',
  verification_status public.verification_status not null default 'none',
  is_blocked boolean not null default false,
  deleted_at timestamptz,
  constraint business_name_requires_business check (business_name is null or account_type = 'business')
);

alter table public.profiles enable row level security;

-- Lesen: eigenes Profil oder Admin. Öffentliche Felder nur über public_profiles.
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy profiles_select_admin on public.profiles
  for select to authenticated
  using ((select private.is_admin()));

-- Ändern: nur das eigene Profil, und nur die per Spalten-GRANT freigegebenen Felder.
-- verification_status, is_blocked, deleted_at ändern ausschließlich Server-Funktionen (M4/M9).
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (user_id = (select auth.uid()) and deleted_at is null)
  with check (user_id = (select auth.uid()));

grant select on public.profiles to authenticated;
grant update (display_name, account_type, business_name, country, preferred_language)
  on public.profiles to authenticated;
-- Kein INSERT/DELETE für API-Rollen: Anlegen per Trigger, Löschen über auth.users (cascade).

-- ---------------------------------------------------------------------------
-- Profil beim Registrieren anlegen (gleiches Verhalten für Web und iOS).
-- Aus den Metadaten werden nur unkritische Felder übernommen und validiert; Status-, Sperr-
-- und Rollenfelder nie.
-- ---------------------------------------------------------------------------
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  name text := left(btrim(coalesce(meta ->> 'display_name', '')), 60);
  country_value text := upper(coalesce(meta ->> 'country', ''));
  language_value text := lower(coalesce(meta ->> 'preferred_language', ''));
begin
  if name = '' then
    name := left(coalesce(nullif(split_part(new.email, '@', 1), ''), 'Nutzer'), 60);
  end if;

  insert into public.profiles (user_id, display_name, country, preferred_language)
  values (
    new.id,
    name,
    case when country_value = any (enum_range(null::public.country_code)::text[])
      then country_value::public.country_code else 'DE' end,
    case when language_value = any (enum_range(null::public.language_code)::text[])
      then language_value::public.language_code else 'de' end
  );
  return new;
end;
$$;

revoke execute on function private.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------
-- Öffentliche Profilsicht (SPEC 3.4). Bewusst ohne security_invoker: Eine invoker-View
-- bräuchte eine anon-Policy auf profiles, die dann alle Spalten lesbar machte. Die View
-- gibt nur die freigegebenen Spalten aktiver Konten aus; security_barrier verhindert, dass
-- Filter von außen vor dem eigenen WHERE ausgewertet werden. Spalten sind per Test fixiert.
-- ---------------------------------------------------------------------------
create view public.public_profiles
with (security_barrier = true)
as
select
  p.user_id,
  p.display_name,
  p.account_type,
  case when p.account_type = 'business' then p.business_name end as business_name,
  p.verification_status,
  p.country
from public.profiles p
where p.deleted_at is null
  and not p.is_blocked;

grant select on public.public_profiles to anon, authenticated;
