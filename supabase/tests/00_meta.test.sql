begin;
\ir _helpers.psql
select plan(7);

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
        'admin_role_rules',
        'grant_admin', 'legal_status', 'listing_content_hints', 'listing_region_counts', 'moderate_listing', 'my_favorites', 'provider_listings',
        'public_cache_epoch', 'public_page_state', 'register_device', 'remove_unavailable_favorites', 'reorder_listing_photos',
        'revoke_admin', 'search_listings', 'set_listing_location']::text[],
  'Nur bewusst freigegebene RPCs in public sind ausführbar (Allowlist)'
);

-- Auch in private nur bewusst ausführbare Hilfsfunktionen (Policies brauchen sie). Ableitungen wie die
-- Standortverfremdung dürfen nie darunter sein (Review Plan M3, B2).
select is(
  array(select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'private'
          and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
        order by 1),
  array['can_report', 'can_write_in', 'claim_listing_creation', 'has_accepted_current_legal', 'has_admin_role',
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

select * from finish();
rollback;
