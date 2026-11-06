-- M8 Commit 2 (ADR 018, Plan M8 4.1, Review B3, A7, A9, A12): Suchauftrag mit Laufzeit, Takt, Pause,
-- Filterprüfung, exakten Grants, Limit, Legal-Gate, RPCs und Retention.
begin;
\ir _helpers.psql
select plan(74);

-- SQLSTATE und hint eines Statements (null, wenn es durchläuft).
create function tests.ss_err(stmt text)
returns text language plpgsql as $$
declare
  c text;
  h text;
begin
  execute stmt;
  return null;
exception when others then
  get stacked diagnostics c = returned_sqlstate, h = pg_exception_hint;
  return c || coalesce(' ' || nullif(h, ''), '');
end;
$$;
grant execute on function tests.ss_err(text) to anon, authenticated;

select tests.create_user('ss8-a@test.local') as a_id \gset
select tests.create_user('ss8-b@test.local') as b_id \gset
select tests.create_user('ss8-c@test.local', null, false) as c_id \gset
select tests.create_user('ss8-d@test.local') as d_id \gset
select tests.create_user('ss8-e@test.local') as e_id \gset

-- ---------------------------------------------------------------------------
-- Spalten, Einstellungen, Grants
-- ---------------------------------------------------------------------------
select is(
  array(select column_name || ':' || udt_name || ':' || is_nullable || ':' || coalesce(column_default, '-')
        from information_schema.columns
        where table_schema = 'public' and table_name = 'saved_searches'
          and column_name in ('cadence', 'paused_at', 'expires_at', 'filters') order by column_name),
  array['cadence:saved_search_cadence:NO:''instant''::saved_search_cadence', 'expires_at:timestamptz:NO:(now() + make_interval(days => private.setting_int(''saved_search_days''::text)))',
        'filters:jsonb:NO:''{"v": 1}''::jsonb', 'paused_at:timestamptz:YES:-'],
  'Neue Spalten cadence, paused_at, expires_at; filters standardmäßig v1');
select is(enum_range(null::public.saved_search_cadence)::text[], array['instant', 'daily'], 'Takt instant | daily');

select is(
  array(select key || '=' || (value #>> '{}') from private.app_settings
        where key like 'saved_search%' or key = 'search_email_batch' order by key),
  array['saved_search_daily_hour=7', 'saved_search_days=42', 'saved_search_expired_keep_days=30',
        'saved_search_extend_window_days=14', 'saved_search_instant_delay_minutes=2',
        'saved_search_instant_min_gap_minutes=10', 'search_email_batch=50'],
  'Einstellungen für Suchaufträge');

-- Exakte Grant-Menge (A7), auch Grants auf Tabellenebene schlagen hier durch.
select is(
  array(select c.column_name || ':' || p.priv
        from information_schema.columns c
        cross join (values ('insert'), ('update')) p (priv)
        where c.table_schema = 'public' and c.table_name = 'saved_searches'
          and has_column_privilege('authenticated', 'public.saved_searches', c.column_name, p.priv)
        order by 1),
  array['cadence:insert', 'cadence:update', 'filters:insert', 'name:insert', 'name:update',
        'notify_email:insert', 'notify_email:update'],
  'authenticated: insert (name, filters, cadence, notify_email), update (name, cadence, notify_email)');
select ok(has_table_privilege('authenticated', 'public.saved_searches', 'select')
          and has_table_privilege('authenticated', 'public.saved_searches', 'delete'),
  'authenticated liest und löscht (RLS: nur eigene)');
select is(
  array(select c.column_name || ':' || p.priv
        from information_schema.columns c
        cross join (values ('select'), ('insert'), ('update')) p (priv)
        where c.table_schema = 'public' and c.table_name = 'saved_searches'
          and has_column_privilege('anon', 'public.saved_searches', c.column_name, p.priv)
        order by 1),
  array[]::text[], 'anon hat keine Rechte an saved_searches');
select ok(not has_table_privilege('anon', 'public.saved_searches', 'delete'), 'anon löscht nichts');

select is(
  array(select p.proname || ':' || has_function_privilege('anon', p.oid, 'execute')::text || ':'
               || has_function_privilege('authenticated', p.oid, 'execute')::text || ':' || p.prosecdef::text
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in ('pause_saved_search', 'resume_saved_search', 'extend_saved_search')
        order by 1),
  array['extend_saved_search:false:true:true', 'pause_saved_search:false:true:true', 'resume_saved_search:false:true:true'],
  'RPCs: Definer, nur authenticated');
select is(
  array(select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'private')
          and p.proname in ('pause_saved_search', 'resume_saved_search', 'extend_saved_search', 'purge_expired_saved_searches',
                            'saved_searches_guard', 'saved_searches_filters', 'saved_searches_limit')
          and not ('search_path=""' = any (p.proconfig))
        order by 1),
  array[]::text[], 'Alle neuen Funktionen mit search_path = ''''');

select is(
  array(select t.tgname::text from pg_trigger t where t.tgrelid = 'public.saved_searches'::regclass and not t.tgisinternal order by 1),
  array['saved_searches_a_guard', 'saved_searches_b_filters', 'saved_searches_c_limit'],
  'Trigger in fester Reihenfolge: Schutz, Filter, Limit');

-- ---------------------------------------------------------------------------
-- Anlegen
-- ---------------------------------------------------------------------------
select tests.authenticate_as(:'a_id');
insert into saved_searches (name, filters) values ('Pacht DE', '{"v": 1, "country": "DE", "kind": "lease", "sort": "price_asc", "currency": "EUR", "price_unit": "per_year"}')
returning id as s1 \gset
select is((select filters from saved_searches where id = :'s1'),
  '{"v": 1, "country": "DE", "kind": "lease", "currency": "EUR", "price_unit": "per_year"}'::jsonb, 'sort wird beim Speichern entfernt');
select is((select expires_at from saved_searches where id = :'s1'), now() + interval '42 days', 'Server setzt expires_at = now() + 42 Tage');
select is((select cadence::text || ':' || notify_email::text || ':' || notify_push::text || ':' || (paused_at is null)::text
           from saved_searches where id = :'s1'),
  'instant:true:false:true', 'Standard: sofort, E-Mail an, Push aus, nicht pausiert');
insert into saved_searches (name, cadence, notify_email) values ('Alles täglich', 'daily', false) returning id as s2 \gset
select is((select filters::text || ':' || cadence::text from saved_searches where id = :'s2'), '{"v": 1}:daily',
  'Ohne Filter gilt v1; Takt täglich wählbar');

select throws_ok($$ insert into saved_searches (name, expires_at) values ('x', now() + interval '1 year') $$, '42501', null,
  'expires_at nicht einfügbar');
select throws_ok($$ insert into saved_searches (name, paused_at) values ('x', now()) $$, '42501', null, 'paused_at nicht einfügbar');
select throws_ok($$ insert into saved_searches (name, notify_push) values ('x', true) $$, '42501', null, 'notify_push nicht einfügbar');
select throws_ok($$ insert into saved_searches (name, last_notified_at) values ('x', now()) $$, '42501', null,
  'last_notified_at nicht einfügbar');
select throws_ok(format($$ insert into saved_searches (name, user_id) values ('x', %L) $$, :'b_id'), '42501', null,
  'user_id nicht einfügbar');

-- ---------------------------------------------------------------------------
-- Ändern: Filter fest, Server-Spalten geschützt
-- ---------------------------------------------------------------------------
select throws_ok($$ update saved_searches set filters = '{"v": 1}' $$, '42501', null, 'Filter sind nach dem Anlegen fest');
select throws_ok($$ update saved_searches set notify_push = true $$, '42501', null, 'notify_push nicht änderbar');
select throws_ok($$ update saved_searches set paused_at = now() $$, '42501', null, 'paused_at nicht änderbar');
select throws_ok($$ update saved_searches set expires_at = now() + interval '1 year' $$, '42501', null, 'expires_at nicht änderbar');
select throws_ok($$ update saved_searches set last_notified_at = now() $$, '42501', null, 'last_notified_at nicht änderbar');
select throws_ok($$ update saved_searches set created_at = now() - interval '1 day' $$, '42501', null, 'created_at nicht änderbar');
update saved_searches set name = 'Pacht Deutschland', cadence = 'daily', notify_email = false where id = :'s1';
select is((select name || ':' || cadence::text || ':' || notify_email::text from saved_searches where id = :'s1'),
  'Pacht Deutschland:daily:false', 'Name, Takt und E-Mail sind änderbar');
update saved_searches set notify_email = true, cadence = 'instant' where id = :'s1';

-- Zweite Linie: Auch mit (versehentlichem) Spalten-Grant schützt der Trigger die Server-Spalten.
select tests.as_postgres();
grant insert (paused_at, expires_at, last_notified_at, created_at) on public.saved_searches to authenticated;
grant update (paused_at, expires_at, last_notified_at, user_id, created_at) on public.saved_searches to authenticated;
select tests.authenticate_as(:'a_id');
select throws_ok(format($$ update saved_searches set paused_at = now() where id = %L $$, :'s1'), '42501', 'Diese Felder setzt nur der Server',
  'Trigger: paused_at nur über die RPC');
select throws_ok(format($$ update saved_searches set expires_at = now() + interval '1 year' where id = %L $$, :'s1'), '42501',
  'Diese Felder setzt nur der Server', 'Trigger: expires_at nur über die RPC');
select throws_ok(format($$ update saved_searches set last_notified_at = now() where id = %L $$, :'s1'), '42501',
  'Diese Felder setzt nur der Server', 'Trigger: last_notified_at nur der Server');
select throws_ok(format($$ update saved_searches set created_at = now() - interval '1 day' where id = %L $$, :'s1'), '42501',
  'Diese Felder setzt nur der Server', 'Trigger: created_at unveränderlich');
insert into saved_searches (name, paused_at, expires_at, last_notified_at, created_at)
values ('Trick', now(), now() + interval '5 years', now(), now() - interval '1 year') returning id as trick \gset
select is((select (paused_at is null and last_notified_at is null and created_at = now()
                   and expires_at = now() + interval '42 days')::text from saved_searches where id = :'trick'),
  'true', 'Trigger: Server-Spalten beim Anlegen vom Server gesetzt, Eingaben verworfen');
select tests.as_postgres();
revoke insert (paused_at, expires_at, last_notified_at, created_at) on public.saved_searches from authenticated;
revoke update (paused_at, expires_at, last_notified_at, user_id, created_at) on public.saved_searches from authenticated;
delete from saved_searches where id = :'trick';

-- ---------------------------------------------------------------------------
-- Filterprüfung wie die Suche (B3)
-- ---------------------------------------------------------------------------
select tests.authenticate_as(:'a_id');
select is(tests.ss_err($$ insert into saved_searches (name, filters) values ('x', '{"v": 1, "foo": 1}') $$), '22023 foo',
  'Unbekannter Schlüssel: 22023 hint foo');
select is(tests.ss_err($$ insert into saved_searches (name, filters) values ('x', '{}') $$), '22023 v', 'Ohne v: 22023 hint v');
select is(tests.ss_err($$ insert into saved_searches (name, filters) values ('x', '[]') $$), '22023 filters',
  'Kein Objekt: 22023 hint filters');
select is(tests.ss_err($$ insert into saved_searches (name, filters) values ('x', '{"v": 1, "sort": "price_asc"}') $$), '22023 sort',
  'Ungültige Sortierung wird wie in der Suche abgelehnt');
select is(tests.ss_err(format($$ insert into saved_searches (name, filters) values ('x', %L) $$,
    jsonb_build_object('v', 1, 'q', (select string_agg('wort' || g, ' ') from generate_series(1, 17) g)))), '22023 q',
  'Suchbegriff mit 33 Knoten: 22023 hint q (Probelauf search_conditions)');
select is(tests.ss_err(format($$ insert into saved_searches (name, filters) values ('x', %L) $$,
    jsonb_build_object('v', 1, 'q', (select string_agg('wort' || g, ' ') from generate_series(1, 16) g)))), null,
  'Suchbegriff mit 31 Knoten wird gespeichert');
select tests.as_postgres();
select is(tests.ss_err(format($$ insert into saved_searches (user_id, name, filters) values (%L, 'x', %L) $$, :'b_id',
    jsonb_build_object('v', 1, 'q', (select string_agg('wort' || g, ' ') from generate_series(1, 17) g)))), '22023 q',
  'Auch der Server speichert keinen Filter, den der Abgleich nicht ausführen kann');
select is(tests.ss_err(format($$ update saved_searches set filters = '{"v": 2}' where id = %L $$, :'s1')), '22023 v',
  'Server-Update der Filter wird ebenso geprüft');
update saved_searches set filters = '{"v": 1, "kind": "permit", "sort": "newest"}' where id = :'s1';
select is((select filters from saved_searches where id = :'s1'), '{"v": 1, "kind": "permit"}'::jsonb, 'Server-Update entfernt sort');

-- ---------------------------------------------------------------------------
-- Aktives Konto und Zustimmung (RV001)
-- ---------------------------------------------------------------------------
update profiles set is_blocked = true where user_id = :'d_id';
insert into saved_searches (user_id, name) values (:'c_id', 'C alt') returning id as c1 \gset
insert into saved_searches (user_id, name) values (:'d_id', 'D alt') returning id as d1 \gset
select is((select expires_at from saved_searches where id = :'c1'), now() + interval '42 days',
  'Server-Insert ohne Angabe: expires_at = now() + 42 Tage');

select tests.authenticate_as(:'c_id');
select is(tests.ss_err($$ insert into saved_searches (name) values ('ohne Zustimmung') $$),
  'RV001 Zustimmung zur aktuellen Version per legal_status() und accept_legal() einholen', 'Anlegen ohne Zustimmung: RV001');
update saved_searches set notify_email = false, name = 'C umbenannt' where id = :'c1';
select is((select name || ':' || notify_email::text from saved_searches where id = :'c1'), 'C umbenannt:false',
  'Ohne Zustimmung: umbenennen und E-Mail aus gehen');
select throws_ok(format($$ update saved_searches set notify_email = true where id = %L $$, :'c1'), 'RV001', null,
  'E-Mail wieder einschalten verlangt die Zustimmung');

select tests.authenticate_as(:'d_id');
select throws_ok($$ insert into saved_searches (name) values ('gesperrt') $$, '42501', null, 'Gesperrtes Konto legt nichts an');

select tests.as_anon();
select throws_ok($$ insert into saved_searches (name) values ('anon') $$, '42501', null, 'anon legt nichts an');
select throws_ok($$ select pause_saved_search(gen_random_uuid()) $$, '42501', null, 'anon pausiert nichts');
select throws_ok($$ select extend_saved_search(gen_random_uuid()) $$, '42501', null, 'anon verlängert nichts');

-- ---------------------------------------------------------------------------
-- Pausieren, Fortsetzen, Verlängern
-- ---------------------------------------------------------------------------
select tests.authenticate_as(:'a_id');
select is((select (pause_saved_search(:'s1')).paused_at), now(), 'Pausieren setzt paused_at');
select is((select expires_at from saved_searches where id = :'s1'), now() + interval '42 days', 'Pausieren hält die Laufzeit nicht an');
select tests.as_postgres();
update saved_searches set paused_at = now() - interval '1 hour' where id = :'s1';
select tests.authenticate_as(:'a_id');
select is((select (pause_saved_search(:'s1')).paused_at), now() - interval '1 hour', 'Erneutes Pausieren ändert nichts');

select tests.authenticate_as(:'b_id');
select throws_ok(format($$ select pause_saved_search(%L) $$, :'s2'), '42501', 'Suchauftrag nicht gefunden', 'Fremd pausieren: 42501');
select throws_ok($$ select pause_saved_search(gen_random_uuid()) $$, '42501', 'Suchauftrag nicht gefunden',
  'Unbekannt pausieren: derselbe Fehler');
select throws_ok(format($$ select resume_saved_search(%L) $$, :'s1'), '42501', 'Suchauftrag nicht gefunden', 'Fremd fortsetzen: 42501');
select throws_ok($$ select resume_saved_search(gen_random_uuid()) $$, '42501', 'Suchauftrag nicht gefunden',
  'Unbekannt fortsetzen: derselbe Fehler');
select throws_ok(format($$ select extend_saved_search(%L) $$, :'s1'), '42501', 'Suchauftrag nicht gefunden', 'Fremd verlängern: 42501');
select throws_ok($$ select extend_saved_search(gen_random_uuid()) $$, '42501', 'Suchauftrag nicht gefunden',
  'Unbekannt verlängern: derselbe Fehler');
select tests.as_postgres();
select is((select (paused_at = now() - interval '1 hour')::text from saved_searches where id = :'s1'), 'true',
  'Fremde Aufrufe ändern nichts');

select tests.authenticate_as(:'a_id');
select is((select (resume_saved_search(:'s1')).paused_at), null, 'Fortsetzen löscht paused_at');

-- Verlängern: außerhalb des Fensters RV006 mit extend_from, im Fenster und nach Ablauf now() + 42 Tage.
select is(tests.ss_err(format($$ select extend_saved_search(%L) $$, :'s1')),
  'RV006 ' || jsonb_build_object('extend_from',
    to_char((now() + interval '28 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))::text,
  'Zu früh verlängern: RV006 mit hint extend_from (Ablauf minus 14 Tage, UTC)');
select tests.as_postgres();
update saved_searches set expires_at = now() + interval '10 days' where id = :'s1';
update saved_searches set expires_at = now() - interval '3 days', paused_at = now() - interval '5 days' where id = :'s2';
select tests.authenticate_as(:'a_id');
select is((select (extend_saved_search(:'s1')).expires_at), now() + interval '42 days', 'Im Fenster: verlängert auf now() + 42 Tage');
select is((select (extend_saved_search(:'s2')).expires_at), now() + interval '42 days', 'Nach Ablauf und aus der Pause verlängerbar');
select is((select paused_at from saved_searches where id = :'s2'), now() - interval '5 days', 'Verlängern beendet die Pause nicht');

-- Ohne Zustimmung: Pausieren ja, Fortsetzen und Verlängern RV001. Gesperrt: Pausieren ja, sonst 42501.
select tests.authenticate_as(:'c_id');
select isnt((select (pause_saved_search(:'c1')).paused_at), null, 'Ohne Zustimmung pausieren geht');
select throws_ok(format($$ select resume_saved_search(%L) $$, :'c1'), 'RV001', null, 'Ohne Zustimmung fortsetzen: RV001');
select throws_ok(format($$ select extend_saved_search(%L) $$, :'c1'), 'RV001', null, 'Ohne Zustimmung verlängern: RV001');
select tests.authenticate_as(:'d_id');
select isnt((select (pause_saved_search(:'d1')).paused_at), null, 'Gesperrtes Konto pausiert');
select throws_ok(format($$ select resume_saved_search(%L) $$, :'d1'), '42501', null, 'Gesperrtes Konto setzt nicht fort');

-- ---------------------------------------------------------------------------
-- Limit (abgelaufene zählen mit)
-- ---------------------------------------------------------------------------
select tests.authenticate_as(:'e_id');
insert into saved_searches (name) select 'E ' || n from generate_series(1, 25) n;
select tests.as_postgres();
update saved_searches set expires_at = now() - interval '20 days' where user_id = :'e_id' and name in ('E 1', 'E 2', 'E 3');
select tests.authenticate_as(:'e_id');
select is(tests.ss_err($$ insert into saved_searches (name) values ('E 26') $$), '23514 {"reason":"saved_searches_limit"}',
  'Höchstens 25, abgelaufene zählen mit: 23514 hint saved_searches_limit');
select tests.as_postgres();
select is(tests.ss_err(format($$ insert into saved_searches (user_id, name) values (%L, 'E 26') $$, :'e_id')),
  '23514 {"reason":"saved_searches_limit"}', 'Limit gilt auch für den Server');

-- ---------------------------------------------------------------------------
-- Retention
-- ---------------------------------------------------------------------------
update saved_searches set expires_at = now() - interval '31 days' where user_id = :'e_id' and name in ('E 1', 'E 2');
update saved_searches set expires_at = now() - interval '29 days' where user_id = :'e_id' and name = 'E 3';
select is(private.purge_expired_saved_searches() >= 2, true, 'Retention löscht abgelaufene Aufträge nach 30 Tagen');
select is((select array_agg(name order by name) from saved_searches where user_id = :'e_id' and expires_at < now()),
  array['E 3'], 'Weniger als 30 Tage abgelaufen bleibt sichtbar');
select is((select schedule || ' ' || command from cron.job where jobname = 'saved-searches-retention'),
  '17 3 * * * select private.purge_expired_saved_searches()', 'Cron-Job für die Retention täglich');
select ok(not has_function_privilege('authenticated', 'private.purge_expired_saved_searches()', 'execute')
          and not has_function_privilege('anon', 'private.purge_expired_saved_searches()', 'execute'),
  'Retention nicht für Clients ausführbar');

select * from finish();
rollback;
