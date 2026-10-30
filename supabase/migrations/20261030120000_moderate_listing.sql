-- M4 Commit 3 (ADR 014): Moderation nur über moderate_listing, Freigabe nur für den gesehenen Stand (B1),
-- Waffenbegriff-Hinweise und Warteschlange für Admins (A7, A8, H8).

-- Version des Inhalts für die Detailseite: der Inhalts-Hash als hex, nur für Admins an fremden Anzeigen.
-- Für alle anderen null (kein Orakel; der Hash enthält die PLZ).
create function private.listing_review_version(p_listing_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when private.is_admin()
         and exists (select 1 from public.listings l where l.id = p_listing_id and l.owner_id is distinct from (select auth.uid()))
    then encode(private.listing_content_hash(p_listing_id), 'hex')
  end;
$$;
revoke execute on function private.listing_review_version(uuid) from public, anon, service_role;
grant execute on function private.listing_review_version(uuid) to authenticated;

create function public.admin_listing_version(p_listing_id uuid)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select private.listing_review_version(p_listing_id);
$$;
revoke execute on function public.admin_listing_version(uuid) from public, anon;
grant execute on function public.admin_listing_version(uuid) to authenticated;

-- Entscheidung eines Admins. security invoker: RLS, listings_guard, Bereitschaftsprüfung und Audit greifen wie
-- bei jedem anderen Schreiben; ein Definer-RPC übersprünge den Guard (is_server). Fehlervertrag in ADR 014.
create function public.moderate_listing(
  p_listing_id uuid,
  p_decision text,
  p_expected_version text,
  p_code text default null,
  p_note text default null
)
returns public.listing_status
language plpgsql
security invoker
set search_path = ''
as $$
declare
  listing record;
  target public.listing_status;
  code text := p_code;
  note text := nullif(private.trim_all(coalesce(p_note, '')), '');
  previous_flag text := coalesce(current_setting('revier.moderation', true), '');
begin
  if not private.is_admin() then
    raise exception 'Nur für Admins mit Zwei-Faktor' using errcode = '42501';
  end if;
  target := case p_decision
    when 'approve' then 'active'
    when 'request_changes' then 'draft'
    when 'reject' then 'rejected'
  end::public.listing_status;
  if target is null then
    raise exception 'Unbekannte Entscheidung' using errcode = '22023';
  end if;

  -- Zeile sperren: Besitzer-Änderungen und eine zweite Entscheidung warten oder sehen den neuen Stand.
  select l.id, l.owner_id, l.status into listing from public.listings l where l.id = p_listing_id for update;
  if not found then
    raise exception 'Anzeige nicht gefunden' using errcode = 'P0002';
  end if;
  if listing.owner_id = (select auth.uid()) then
    raise exception 'Eigene Anzeigen moderiert ein anderer Admin' using errcode = '42501';
  end if;
  if listing.status <> 'pending_review' then
    raise exception 'already_decided' using errcode = 'RV003', hint = jsonb_build_object('status', listing.status)::text;
  end if;
  if p_expected_version is null or p_expected_version is distinct from private.listing_review_version(p_listing_id) then
    raise exception 'listing_changed' using errcode = 'RV004';
  end if;

  if target = 'active' then
    code := null;
    note := null;
  elsif code is null then
    raise exception 'Grund fehlt' using errcode = '23514', hint = '{"fields":["reject_code"]}';
  elsif code = 'other' and note is null then
    raise exception 'Freitext fehlt' using errcode = '23514', hint = '{"fields":["reject_reason"]}';
  end if;

  perform set_config('revier.moderation', 'on', true);
  update public.listings set status = target, reject_code = code, reject_reason = note where id = p_listing_id;
  perform set_config('revier.moderation', previous_flag, true);
  return target;
end;
$$;
revoke execute on function public.moderate_listing(uuid, text, text, text, text) from public, anon;
grant execute on function public.moderate_listing(uuid, text, text, text, text) to authenticated;

-- Waffenbegriff-Hinweise auch für Admins (A7); sonst unverändert.
create or replace function public.listing_content_hints(p_listing_id uuid)
returns table (field text, term text, language public.language_code, category text)
language sql
stable
security definer
set search_path = ''
as $$
  with own as (
    select l.id, l.title, l.description, l.attributes from public.listings l
    where l.id = p_listing_id and (l.owner_id = (select auth.uid()) or (select private.is_admin()))
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

-- Warteschlange (A8, H8): älteste Einreichung zuerst, Keyset-Paging, Hinweise und frühere Ablehnungen ohne
-- N+1-Aufrufe. security invoker: Admins lesen über RLS; für alle anderen leer. Nur pending_review (H6).
create function public.admin_review_queue(
  p_after_submitted timestamptz default null,
  p_after_id uuid default null,
  p_limit integer default 25
)
returns table (
  id uuid, title text, kind public.listing_kind, direction public.listing_direction, country public.country_code,
  region_id uuid, submitted_at timestamptz, owner_id uuid, owner_name text, hint_count integer,
  listing_rejections integer, owner_rejections integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select l.id, l.title, l.kind, l.direction, l.country, l.region_id, l.submitted_at, l.owner_id, p.display_name,
    (select count(*)::integer from public.listing_content_hints(l.id)),
    (select count(*)::integer from public.audit_log a where a.target_id = l.id and a.action = 'listing.rejected'),
    (select count(*)::integer from public.audit_log a join public.listings o on o.id = a.target_id
      where a.action = 'listing.rejected' and o.owner_id = l.owner_id)
  from public.listings l
  left join public.profiles p on p.user_id = l.owner_id
  where (select private.is_admin())
    and l.status = 'pending_review'
    and l.owner_id is distinct from (select auth.uid())
    and (p_after_submitted is null or (l.submitted_at, l.id) > (p_after_submitted, p_after_id))
  order by l.submitted_at, l.id
  limit least(greatest(coalesce(p_limit, 25), 1), 100);
$$;
revoke execute on function public.admin_review_queue(timestamptz, uuid, integer) from public, anon;
grant execute on function public.admin_review_queue(timestamptz, uuid, integer) to authenticated;
