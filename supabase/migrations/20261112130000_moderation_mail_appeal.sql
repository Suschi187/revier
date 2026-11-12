-- M9b Commit 9 (ADR 020, Mailtexte): Moderations-Mails nennen statt des Kontakt-Platzhalters aus M8 die Frist zum
-- Anfechten (appeal_window_days ab der Entscheidung) und verlinken /{lang}/account/decisions. Freigaben haben keine Frist.

create or replace function public.claim_moderation_notifications(p_secret text, p_limit integer default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  lim integer := least(coalesce(p_limit, private.setting_int('moderation_email_batch')),
                       private.setting_int('moderation_email_batch'));
  result jsonb;
begin
  if not private.search_notifications_secret_valid(p_secret) then
    raise exception 'Nicht erlaubt' using errcode = '42501';
  end if;

  update private.moderation_notifications n
  set done_at = now()
  where n.id in (
    select x.id from private.moderation_notifications x
    where x.done_at is null and x.claim_id is null
      and not exists (
        select 1 from public.profiles p join auth.users u on u.id = p.user_id
        where p.user_id = x.owner_id and p.deleted_at is null and u.email is not null and u.email_confirmed_at is not null)
    for update of x skip locked);

  with picked as (
    select x.id from private.moderation_notifications x
    where x.done_at is null and x.claim_id is null
    order by x.created_at, x.id
    limit greatest(lim, 0)
    for update of x skip locked
  ),
  claimed as (
    update private.moderation_notifications n
    set claim_id = gen_random_uuid(), claimed_at = now()
    from picked
    where n.id = picked.id
    returning n.claim_id, n.owner_id, n.decision, n.reject_code, n.reason, n.listing_id, n.created_at
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'claim_id', c.claim_id,
      'email', u.email,
      'language', p.preferred_language,
      'decision', c.decision,
      'reject_code', c.reject_code,
      'reason', c.reason,
      'listing_id', c.listing_id,
      'title', l.title,
      'appeal_until', case when c.decision <> 'approved'
                           then c.created_at + make_interval(days => private.setting_int('appeal_window_days')) end
    ) order by c.created_at, c.claim_id), '[]'::jsonb)
  into result
  from claimed c
  join public.profiles p on p.user_id = c.owner_id
  join auth.users u on u.id = c.owner_id
  join public.listings l on l.id = c.listing_id;

  return result;
end;
$$;
