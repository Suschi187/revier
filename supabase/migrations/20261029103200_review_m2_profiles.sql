-- Review M2 (Architekt 7, QA F4).
-- * Wer eine fremde Adresse registriert, kann user_metadata frei setzen. Der echte Inhaber bekäme
--   diesen Namen im Onboarding vorbelegt. Deshalb übernimmt der Trigger keinen Anzeigenamen mehr;
--   Sprache und Land bleiben (validiert, im Onboarding sichtbar und änderbar).
-- * Gesperrte Konten ändern ihr Profil nicht mehr (Moderation, M4). Lesen bleibt erlaubt.

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  country_value text := upper(coalesce(meta ->> 'country', ''));
  language_value text := lower(coalesce(meta ->> 'preferred_language', ''));
begin
  -- Neutraler Platzhalter; das Onboarding (M2/I1) verlangt einen Anzeigenamen.
  insert into public.profiles (user_id, display_name, country, preferred_language)
  values (
    new.id,
    'Nutzer',
    case when country_value = any (enum_range(null::public.country_code)::text[])
      then country_value::public.country_code else 'DE' end,
    case when language_value = any (enum_range(null::public.language_code)::text[])
      then language_value::public.language_code else 'de' end
  );
  return new;
end;
$$;

drop policy profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (user_id = (select auth.uid()) and deleted_at is null and not is_blocked)
  with check (user_id = (select auth.uid()));
