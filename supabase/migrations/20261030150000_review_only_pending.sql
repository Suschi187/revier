-- QA M4 F4 (Review H6): Admins sehen Version und Waffenbegriff-Hinweise nur für Anzeigen in der Prüfung,
-- nicht für fremde Entwürfe oder schon entschiedene Anzeigen. Besitzer sehen ihre Hinweise weiter immer.

create or replace function private.listing_review_version(p_listing_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when private.is_admin()
         and exists (select 1 from public.listings l
                     where l.id = p_listing_id and l.status = 'pending_review'
                       and l.owner_id is distinct from (select auth.uid()))
    then encode(private.listing_content_hash(p_listing_id), 'hex')
  end;
$$;
revoke execute on function private.listing_review_version(uuid) from public, anon, service_role;
grant execute on function private.listing_review_version(uuid) to authenticated;

create or replace function public.listing_content_hints(p_listing_id uuid)
returns table (field text, term text, language public.language_code, category text)
language sql
stable
security definer
set search_path = ''
as $$
  with own as (
    select l.id, l.title, l.description, l.attributes from public.listings l
    where l.id = p_listing_id
      and (l.owner_id = (select auth.uid()) or (l.status = 'pending_review' and (select private.is_admin())))
  ),
  texts as (
    select 'title' as field, own.title as body from own
    union all select 'description', own.description from own
    union all select 'attributes.' || a.key, a.value #>> '{}' from own, jsonb_each(own.attributes) a
      where jsonb_typeof(a.value) = 'string'
    union all select 'attributes.' || a.key, e #>> '{}' from own, jsonb_each(own.attributes) a, jsonb_array_elements(a.value) e
      where jsonb_typeof(a.value) = 'array' and jsonb_typeof(e) = 'string'
    union all select 'photos.alt_text', p.alt_text from own join public.listing_photos p on p.listing_id = own.id
      where p.alt_text is not null
  )
  select distinct t.field, c.term, c.language, c.category
  from texts t join private.content_terms c on t.body ~* c.pattern
  order by 1, 3, 2;
$$;
