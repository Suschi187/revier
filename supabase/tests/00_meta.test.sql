begin;
\ir _helpers.psql
select plan(9);

-- Jede Tabelle in public hat RLS (CLAUDE.md: keine Tabelle ohne Policy).
select is(
  array(select c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity order by 1),
  array[]::text[],
  'Alle Tabellen in public haben RLS aktiv'
);

select is(
  array(select c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p')
          and not exists (select 1 from pg_policy p where p.polrelid = c.oid) order by 1),
  array[]::text[],
  'Alle Tabellen in public haben mindestens eine Policy'
);

-- Tabellen in private sind für API-Rollen nicht erreichbar.
select is(
  array(select distinct table_name::text from information_schema.role_table_grants
        where table_schema = 'private' and grantee in ('anon', 'authenticated') order by 1),
  array[]::text[],
  'Keine Tabellenrechte für anon/authenticated im Schema private'
);

-- Keine Funktion in public ist für anon/authenticated ausführbar, ohne dass sie bewusst freigegeben wurde.
select is(
  array(select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
        order by 1),
  array['accept_legal', 'admin_access', 'admin_find_user', 'admin_list_admins', 'admin_listing_version', 'admin_review_queue',
        'admin_role_rules', 'admin_stuck_account_deletions', 'block_in_conversation', 'conversation_info', 'conversation_messages', 'extend_saved_search',
        'grant_admin', 'legal_status', 'listing_content_hints', 'listing_region_counts', 'map_listings', 'mark_conversation_read', 'moderate_listing', 'my_blocks', 'my_conversations', 'my_favorites', 'pause_saved_search', 'provider_listings',
        'public_cache_epoch', 'public_page_state', 'region_geo', 'register_device', 'remove_unavailable_favorites', 'reorder_listing_photos',
        'request_account_deletion', 'resume_saved_search', 'revoke_admin', 'search_listings', 'send_message', 'set_listing_location', 'start_conversation', 'unblock_in_conversation', 'unread_count',
        'unsubscribe']::text[],
  'Nur bewusst freigegebene RPCs in public sind ausführbar (Allowlist)'
);

-- Auch in private nur bewusst ausführbare Hilfsfunktionen (Policies brauchen sie). Ableitungen wie die
-- Standortverfremdung dürfen nie darunter sein (Review Plan M3, B2).
select is(
  array(select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'private'
          and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
        order by 1),
  array['can_report', 'chat_item', 'claim_listing_creation', 'has_accepted_current_legal', 'has_admin_role',
        'is_active_user', 'is_admin', 'is_blocked_with', 'is_conversation_participant', 'is_server', 'is_server_caller',
        'listing_attributes_error', 'listing_card', 'listing_is_public', 'listing_resume_allowed', 'listing_review_version', 'owns_editable_listing',
        'search_conditions', 'search_filters_error', 'setting_int', 'trim_all']::text[],
  'Nur bewusst freigegebene Hilfsfunktionen in private sind ausführbar (Allowlist)'
);

-- Kartenpunkt (ADR 016, Review B2): Der Trigger, der map_point setzt, läuft nach der Verfremdung (BEFORE-Trigger
-- alphabetisch), und keine andere Funktion schreibt die Spalte.
select is(
  (select max(tgname) from pg_trigger where tgrelid = 'public.listings'::regclass and not tgisinternal
     and tgtype & 2 = 2),
  'listings_zzz_map_point', 'listings_zzz_map_point ist der letzte BEFORE-Trigger auf listings');
select is(
  array(select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'private') and p.prosrc ~ 'map_point\s*:=|set\s+map_point' order by 1),
  array['listings_map_point']::text[], 'Nur listings_map_point schreibt map_point');

-- Account-Löschung (ADR 019, Review B2): Jeder Bucket steht in der Löschliste, sonst blieben Dateien liegen.
select is(
  array(select b.id::text from storage.buckets b
        where not exists (select 1 from private.account_deletion_buckets d where d.bucket_id = b.id) order by 1),
  array[]::text[],
  'Jeder Storage-Bucket steht in private.account_deletion_buckets'
);

-- Jede Spalte mit Nutzerbezug ist in ADR 008 eingeordnet (FK-Regel bzw. `nofk` für Anker und erlaubte Reste).
-- Eine neue Tabelle mit Nutzerbezug lässt diesen Test fallen: in ADR 008 eintragen, dann hier ergänzen.
select is(
  array(
    select x.col || ':' || coalesce(x.rule, 'nofk') from (
      select n.nspname || '.' || c.relname || '.' || a.attname as col,
             max(case k.confdeltype when 'c' then 'cascade' when 'n' then 'set null' when 'r' then 'restrict' when 'a' then 'no action' end) as rule
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      left join pg_constraint k on k.conrelid = c.oid and k.contype = 'f' and a.attnum = any (k.conkey)
        and k.confrelid in ('public.profiles'::regclass, 'auth.users'::regclass)
      where n.nspname in ('public', 'private') and c.relkind in ('r', 'p')
        and (k.oid is not null or (a.atttypid = 'uuid'::regtype
             and a.attname ~ '^(user|owner|sender|recipient|actor|reporter|handled_by|reviewed_by|blocker|blocked|interested|target|author)(_id)?$'))
      group by 1
    ) x order by 1),
  array['private.account_deletions.user_id:nofk', 'private.admin_lookups.actor_id:cascade', 'private.chat_notifications.recipient_id:cascade',
        'private.listing_creations.owner_id:cascade', 'private.moderation_notifications.owner_id:cascade', 'private.photo_creations.owner_id:cascade',
        'private.reported_message_snapshots.sender_id:nofk', 'private.saved_search_deliveries.user_id:cascade', 'private.saved_search_matches.user_id:cascade',
        'private.search_notification_claims.user_id:cascade', 'private.search_notification_state.user_id:cascade', 'private.unsubscribe_tokens.user_id:cascade',
        'private.user_roles.user_id:cascade', 'public.audit_log.actor_id:set null', 'public.audit_log.target_id:nofk', 'public.blocks.blocked_id:cascade',
        'public.blocks.blocker_id:cascade', 'public.conversations.interested_id:cascade', 'public.conversations.owner_id:cascade', 'public.devices.user_id:cascade',
        'public.favorites.user_id:cascade', 'public.legal_acceptances.user_id:cascade', 'public.listings.owner_id:cascade', 'public.messages.recipient_id:cascade',
        'public.messages.sender_id:cascade', 'public.profiles.user_id:cascade', 'public.reports.handled_by:set null', 'public.reports.reporter_id:set null',
        'public.reports.target_id:nofk', 'public.reviews.author_id:cascade', 'public.reviews.target_id:cascade', 'public.saved_searches.user_id:cascade',
        'public.verifications.reviewed_by:set null', 'public.verifications.user_id:cascade']::text[],
  'Jede Spalte mit Nutzerbezug ist in ADR 008 eingeordnet'
);

select * from finish();
rollback;
