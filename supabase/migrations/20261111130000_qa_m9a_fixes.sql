-- QA M9a (docs/QA-REPORT.md, „M9a – Abnahme“):
-- - F1: finalize vergleicht Nutzer-ID und Adresse nur noch als vollständigen JSON-Wert ("…"), nicht als Teilstring.
--   Vorher löschte die Löschung von anna@… auch die Auth-Audit-Einträge von johanna@….
-- - F3: prepare entfernt zusätzlich Realtime-Ereignisse mit der conversation_id einer Unterhaltung des Kontos
--   (unread.changed beim Gegenüber trägt nur diese ID). In prepare bestehen die Unterhaltungen noch.
-- - F2: Der Export nennt Titel gemerkter Anzeigen nur, wenn sie öffentlich sind (wie my_favorites, QA M5 F3);
--   version 2.

create or replace function public.account_deletion_prepare(p_claim_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.account_deletion_leased(p_claim_id, p_user_id) then
    raise exception 'lease_invalid' using errcode = '42501';
  end if;
  update public.audit_log a set details = a.details - 'user_id' where a.details ->> 'user_id' = p_user_id::text;
  delete from realtime.messages m
  where m.payload ->> 'conversation_id' in (
    select c.id::text from public.conversations c where p_user_id in (c.owner_id, c.interested_id)
  );
end;
$$;

create or replace function public.account_deletion_finalize(p_claim_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  mail text;
  quoted_id text := '"' || p_user_id::text || '"';
begin
  if not private.account_deletion_leased(p_claim_id, p_user_id) then
    raise exception 'lease_invalid' using errcode = '42501';
  end if;
  if exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'user_still_exists' using errcode = '55000';
  end if;
  select lower(d.email) into mail from private.account_deletions d where d.user_id = p_user_id;
  -- Nur vollständige JSON-Werte: "<uuid>" bzw. "<adresse>" (QA M9a F1). Adressen enthalten keine Zeichen, die JSON
  -- maskiert; Groß- und Kleinschreibung wie bisher egal (user_deleted schreibt die Adresse wie eingegeben).
  delete from auth.audit_log_entries e
  where position(quoted_id in e.payload::text) > 0
     or (mail is not null and position('"' || mail || '"' in lower(e.payload::text)) > 0);
  delete from auth.flow_state f where f.user_id = p_user_id;
  delete from realtime.messages m
  where m.topic = 'user:' || p_user_id::text or position(quoted_id in coalesce(m.payload::text, '')) > 0;
end;
$$;

create or replace function public.export_my_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  recent integer;
  oldest timestamptz;
begin
  if uid is null or not exists (select 1 from public.profiles p where p.user_id = uid and p.deleted_at is null) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('data_export:' || uid::text, 0));
  select count(*), min(e.created_at) into recent, oldest
  from private.data_exports e where e.user_id = uid and e.created_at > now() - interval '24 hours';
  if recent >= private.setting_int('export_per_24h') then
    raise exception 'export_rate_limited' using errcode = 'RV002',
      hint = jsonb_build_object('retry_after', to_char((oldest + interval '24 hours') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                                'scope', 'data_export')::text;
  end if;
  insert into private.data_exports (user_id) values (uid);

  return jsonb_build_object(
    'format', 'revier-export',
    'version', 2,
    'generated_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'account', (select jsonb_build_object('email', u.email, 'created_at', u.created_at, 'last_sign_in_at', u.last_sign_in_at)
                from auth.users u where u.id = uid),
    'profile', (select jsonb_build_object('display_name', p.display_name, 'account_type', p.account_type, 'business_name', p.business_name,
                  'country', p.country, 'preferred_language', p.preferred_language, 'verification_status', p.verification_status,
                  'is_blocked', p.is_blocked, 'notify_chat_email', p.notify_chat_email, 'created_at', p.created_at)
                from public.profiles p where p.user_id = uid),
    'roles', coalesce((select jsonb_agg(jsonb_build_object('role', r.role, 'created_at', r.created_at) order by r.created_at)
                from private.user_roles r where r.user_id = uid), '[]'::jsonb),
    'legal_acceptances', coalesce((select jsonb_agg(jsonb_build_object('document', a.document, 'version', a.version, 'source', a.source,
                  'accepted_at', a.accepted_at) order by a.accepted_at)
                from public.legal_acceptances a where a.user_id = uid), '[]'::jsonb),
    'listings', coalesce((select jsonb_agg(jsonb_build_object(
                  'id', l.id, 'kind', l.kind, 'direction', l.direction, 'title', l.title, 'description', l.description,
                  'content_language', l.content_language, 'country', l.country,
                  'region_code', (select g.code from public.regions g where g.id = l.region_id),
                  'price_minor', l.price_minor, 'currency', l.currency, 'price_unit', l.price_unit, 'area_hectares', l.area_hectares,
                  'start_date', l.start_date, 'end_date', l.end_date, 'attributes', l.attributes, 'status', l.status,
                  'reject_code', l.reject_code, 'reject_reason', l.reject_reason, 'created_at', l.created_at,
                  'submitted_at', l.submitted_at, 'published_at', l.published_at, 'approved_at', l.approved_at, 'expires_at', l.expires_at,
                  'species', coalesce((select jsonb_agg(s.species_code order by s.species_code) from public.listing_species s where s.listing_id = l.id), '[]'::jsonb),
                  'place', (select jsonb_build_object('postal_code', pl.postal_code, 'place_name', pl.place_name)
                            from public.listing_places pl where pl.listing_id = l.id),
                  'photos', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'sort_order', f.sort_order, 'alt_text', f.alt_text,
                              'width', f.width, 'height', f.height, 'created_at', f.created_at) order by f.sort_order)
                            from public.listing_photos f where f.listing_id = l.id and f.processed_at is not null), '[]'::jsonb))
                  order by l.created_at)
                from public.listings l where l.owner_id = uid), '[]'::jsonb),
    'favorites', coalesce((select jsonb_agg(jsonb_build_object('listing_id', f.listing_id,
                  'title', (select l.title from public.listings l
                            where l.id = f.listing_id and private.listing_is_public(l.status, l.expires_at, l.owner_id)),
                  'created_at', f.created_at) order by f.created_at)
                from public.favorites f where f.user_id = uid), '[]'::jsonb),
    'saved_searches', coalesce((select jsonb_agg(jsonb_build_object('name', s.name, 'filters', s.filters, 'cadence', s.cadence,
                  'notify_email', s.notify_email, 'notify_push', s.notify_push, 'paused_at', s.paused_at, 'expires_at', s.expires_at,
                  'created_at', s.created_at,
                  'matches', coalesce((select jsonb_agg(jsonb_build_object('listing_id', m.listing_id, 'matched_at', m.matched_at,
                                'sent_at', case when m.outcome = 'sent' then m.done_at end) order by m.matched_at)
                              from private.saved_search_matches m where m.saved_search_id = s.id and m.user_id = uid), '[]'::jsonb))
                  order by s.created_at)
                from public.saved_searches s where s.user_id = uid), '[]'::jsonb),
    'conversations', coalesce((select jsonb_agg(jsonb_build_object(
                  'role', case when c.owner_id = uid then 'owner' else 'interested' end,
                  'listing_id', c.listing_id, 'listing_title', (select l.title from public.listings l where l.id = c.listing_id),
                  'counterpart', private.export_party_name(case when c.owner_id = uid then c.interested_id else c.owner_id end),
                  'created_at', c.created_at,
                  'messages', coalesce((select jsonb_agg(jsonb_build_object('from', case when m.sender_id = uid then 'me' else 'counterpart' end,
                                'body', m.body, 'created_at', m.created_at, 'read_at', m.read_at) order by m.created_at, m.id)
                              from public.messages m where m.conversation_id = c.id), '[]'::jsonb))
                  order by c.created_at)
                from public.conversations c where uid in (c.owner_id, c.interested_id)), '[]'::jsonb),
    'blocks', coalesce((select jsonb_agg(jsonb_build_object('display_name', private.export_party_name(b.blocked_id),
                  'created_at', b.created_at) order by b.created_at)
                from public.blocks b where b.blocker_id = uid), '[]'::jsonb),
    'reports', coalesce((select jsonb_agg(jsonb_build_object('target_type', r.target_type,
                  'target_label', case r.target_type
                    when 'listing' then (select l.title from public.listings l where l.id = r.target_id)
                    when 'profile' then private.export_party_name(r.target_id)
                  end,
                  'reason', r.reason, 'note', r.note, 'status', r.status, 'created_at', r.created_at, 'handled_at', r.handled_at)
                  order by r.created_at)
                from public.reports r where r.reporter_id = uid), '[]'::jsonb),
    'devices', coalesce((select jsonb_agg(jsonb_build_object('platform', d.platform, 'language', d.language, 'created_at', d.created_at)
                  order by d.created_at)
                from public.devices d where d.user_id = uid), '[]'::jsonb),
    'verifications', coalesce((select jsonb_agg(jsonb_build_object('document_type', v.document_type, 'status', v.status,
                  'created_at', v.created_at, 'decided_at', v.decided_at, 'reject_reason', v.reject_reason,
                  'document_present', v.document_path is not null) order by v.created_at)
                from public.verifications v where v.user_id = uid), '[]'::jsonb),
    'reviews', coalesce((select jsonb_agg(jsonb_build_object('direction', case when rv.author_id = uid then 'written' else 'received' end,
                  'counterpart', private.export_party_name(case when rv.author_id = uid then rv.target_id else rv.author_id end),
                  'rating', rv.rating, 'text', rv.text, 'created_at', rv.created_at) order by rv.created_at)
                from public.reviews rv where uid in (rv.author_id, rv.target_id)), '[]'::jsonb)
  );
end;
$$;
