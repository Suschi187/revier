-- Review M1 (QA F1, Architekt 6/7), Entscheidung 2026-10-29:
-- * kein E-Mail-Bestandteil als öffentlicher Name
-- * öffentlich sind nur Anbieter (mindestens eine öffentliche Anzeige) und die eigenen Chatpartner
-- * öffentlich sichtbar ist nur "verifiziert", nicht pending/rejected (Datensparsamkeit)

create or replace function private.handle_new_user()
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
  -- Neutraler Platzhalter; das Onboarding (M2/I1) verlangt einen Anzeigenamen.
  if name = '' then
    name := 'Nutzer';
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

create or replace view public.public_profiles
with (security_barrier = true)
as
select
  p.user_id,
  p.display_name,
  p.account_type,
  case when p.account_type = 'business' then p.business_name end as business_name,
  case when p.verification_status = 'verified' then 'verified'::public.verification_status
       else 'none'::public.verification_status end as verification_status,
  p.country
from public.profiles p
where p.deleted_at is null
  and not p.is_blocked
  and (
    exists (
      select 1 from public.listings l
      where l.owner_id = p.user_id and l.status = 'active' and l.expires_at > now()
    )
    or exists (
      select 1 from public.conversations c
      where (c.owner_id = p.user_id and c.interested_id = (select auth.uid()))
         or (c.interested_id = p.user_id and c.owner_id = (select auth.uid()))
    )
  );
