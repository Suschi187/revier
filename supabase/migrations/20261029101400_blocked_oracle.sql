-- Review M1 (Architekt 1): Hilfsfunktionen in private sind für API-Rollen ausführbar, damit Policies
-- sie aufrufen können. Über pg_graphql (in der Cloud oft aktiv) wären sie abfragbar. Daher:
-- * graphql_public ist nicht mehr exponiert (supabase/config.toml, in der Cloud ebenso)
-- * is_blocked_pair(a, b) verriet beliebige fremde Sperren; API-Rollen bekommen nur noch
--   is_blocked_with(other), das ausschließlich Sperren des angemeldeten Nutzers betrifft.

create function private.is_blocked_with(other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_blocked_pair((select auth.uid()), other);
$$;
grant execute on function private.is_blocked_with(uuid) to authenticated;

revoke execute on function private.is_blocked_pair(uuid, uuid) from public, anon, authenticated;

drop policy conversations_insert_interested on public.conversations;
create policy conversations_insert_interested on public.conversations
  for insert to authenticated
  with check (
    interested_id = (select auth.uid())
    and (select private.is_active_user((select auth.uid())))
    and exists (select 1 from public.listings l where l.id = listing_id and l.status = 'active' and l.expires_at > now())
    and not private.is_blocked_with(owner_id)
  );
