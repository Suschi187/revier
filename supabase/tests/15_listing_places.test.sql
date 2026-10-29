begin;
\ir _helpers.psql
select plan(33);

-- PLZ und Ort je Anzeige (ADR 012, Plan M3 Commit 5b, Review Plan M3 PLZ 1–4).
select tests.create_user('owner@test.local') as a_id \gset
select tests.create_user('fremd@test.local') as b_id \gset
select tests.create_user('admin@test.local') as adm \gset
select tests.create_user('ohne-zustimmung@test.local', accepted => false) as c_id \gset
select tests.make_admin(:'adm');
select id as muenchen from regions where code = 'DE-09162' \gset
select id as miesbach from regions where code = 'DE-09182' \gset
select id as liezen from regions where code = 'AT-612' \gset

-- Zustimmung zu den Rechtstexten (Legal-Gate der RPC)
select tests.authenticate_as(:'a_id');
select accept_legal(terms_version, privacy_version, 'web') from legal_status();
insert into listings (kind, direction, title, content_language, region_id)
values ('lease', 'offer', 'Revier mit PLZ', 'de', :'muenchen') returning id as l \gset
insert into listings (kind, direction, title, content_language, region_id)
values ('lease', 'wanted', 'Gesuch ohne PLZ', 'de', :'muenchen') returning id as w \gset
select tests.authenticate_as(:'b_id');
select accept_legal(terms_version, privacy_version, 'web') from legal_status();
select tests.authenticate_as(:'adm', 'aal2');
select accept_legal(terms_version, privacy_version, 'web') from legal_status();

-- Rechte
select tests.as_postgres();
select ok(not has_table_privilege('anon', 'public.listing_places', 'select'), 'anon hat kein SELECT auf listing_places');
select ok(not has_table_privilege('authenticated', 'public.listing_places', 'delete'), 'authenticated hat kein DELETE');
select ok(not has_column_privilege('authenticated', 'public.listings', 'postal_prefix', 'update')
  and not has_column_privilege('authenticated', 'public.listings', 'postal_prefix', 'insert'),
  'postal_prefix ist für Nutzer nicht schreibbar');
select ok(not has_function_privilege('anon', 'public.set_listing_location(uuid, uuid, text, text)', 'execute'),
  'anon ruft set_listing_location nicht auf');

-- Besitzer setzt Ort per RPC; der Server leitet das Präfix ab.
select tests.authenticate_as(:'a_id');
select lives_ok(format($$ select set_listing_location(%L, %L, ' 80331 ', ' München ') $$, :'l', :'muenchen'),
  'Besitzer setzt PLZ und Ort per RPC');
select is((select postal_code || '|' || place_name from listing_places where listing_id = :'l'), '80331|München',
  'Besitzer liest PLZ und Ort, getrimmt');
select is((select postal_prefix from listings where id = :'l'), '80', 'postal_prefix = erste zwei Ziffern');
select lives_ok(format($$ select set_listing_location(%L, %L) $$, :'w', :'muenchen'), 'Gesuch: Ort ohne PLZ');
select is((select postal_prefix from listings where id = :'w'), null, 'Gesuch ohne PLZ: kein Präfix');
select throws_ok(format($$ update listings set postal_prefix = '99' where id = %L $$, :'l'), '42501', null,
  'Besitzer setzt postal_prefix nicht selbst');

-- Format nach dem Land der Anzeige; die Meldung nennt nur den Feldcode.
select throws_ok(format($$ select set_listing_location(%L, %L, '8033', 'München') $$, :'l', :'muenchen'),
  '23514', 'PLZ hat nicht das Format des Landes', 'DE: vierstellige PLZ wird abgelehnt');
select throws_ok(format($$ select set_listing_location(%L, %L, '89403', 'Liezen') $$, :'l', :'liezen'),
  '23514', 'PLZ hat nicht das Format des Landes', 'AT: fünfstellige PLZ wird abgelehnt');

-- Fremde, anon, Admin ohne 2FA lesen nichts.
select tests.authenticate_as(:'b_id');
select is((select count(*)::int from listing_places), 0, 'Fremder liest keine Orte');
select throws_ok(format($$ select set_listing_location(%L, %L, '80333', 'München') $$, :'l', :'muenchen'),
  '42501', 'Anzeige nicht gefunden', 'Fremder setzt keinen Ort per RPC');
select throws_ok(format($$ insert into listing_places (listing_id, postal_code) values (%L, '80333') $$, :'l'),
  '42501', null, 'Fremder legt keinen Ort direkt an');
update listing_places set postal_code = '80333' where listing_id = :'l';
select tests.as_anon();
select throws_ok($$ select count(*) from listing_places $$, '42501', null, 'anon liest listing_places nicht');
select tests.authenticate_as(:'adm', 'aal1');
select is((select count(*)::int from listing_places), 0, 'Admin ohne 2FA liest keine Orte');
select set_config('request.jwt.claims', jsonb_build_object('sub', :'b_id', 'role', 'authenticated', 'aal', 'aal2',
  'app_role', 'admin', 'app_metadata', jsonb_build_object('role', 'admin'))::text, true);
select is((select count(*)::int from listing_places), 0, 'Admin-Claim ohne user_roles liest keine Orte');
select tests.authenticate_as(:'adm', 'aal2');
select is((select count(*)::int from listing_places where listing_id = :'l'), 1, 'Admin mit 2FA liest den Ort');
select throws_ok(format($$ select set_listing_location(%L, %L, '80333', 'München') $$, :'l', :'muenchen'),
  '42501', null, 'Admin schreibt keinen fremden Ort');
select tests.as_postgres();
select is((select postal_code from listing_places where listing_id = :'l'), '80331', 'Ort ist unverändert');

-- Freigegebene Anzeige: jede Änderung am Ort → pending_review, unverändert zurückgeschrieben → Status bleibt.
update listings set status = 'active', expires_at = now() + interval '30 days' where id = :'l';
select tests.authenticate_as(:'a_id');
select set_listing_location(:'l', :'muenchen', '80331', 'München');
select is((select status::text from listings where id = :'l'), 'active', 'Gleicher Ort zurückgeschrieben: bleibt aktiv');
update listing_places set postal_code = '80333' where listing_id = :'l';
select is((select status::text from listings where id = :'l'), 'pending_review', 'PLZ geändert → pending_review');
select is((select postal_prefix from listings where id = :'l'), '80', 'Präfix nachgeführt');
select tests.as_postgres();
update listings set status = 'active' where id = :'l';
select tests.authenticate_as(:'a_id');
update listing_places set place_name = 'München-Altstadt' where listing_id = :'l';
select is((select status::text from listings where id = :'l'), 'pending_review', 'Ortsname geändert → pending_review');

-- Kreis und PLZ zusammen ändern: ein Schritt, kein Fehler, zurück in die Prüfung.
select tests.as_postgres();
update listings set status = 'active' where id = :'l';
select tests.authenticate_as(:'a_id');
select lives_ok(format($$ select set_listing_location(%L, %L, '83714', 'Miesbach') $$, :'l', :'miesbach'),
  'Kreis und PLZ in einem Schritt');
select is((select status::text || '|' || postal_prefix from listings where id = :'l'), 'pending_review|83',
  'Kreiswechsel per RPC → pending_review, neues Präfix');

-- Server ändert den Ort (z. B. Moderation per Edge Function): Status bleibt.
select tests.as_postgres();
update listings set status = 'active' where id = :'l';
select set_config('role', 'service_role', true);
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
update listing_places set place_name = 'Miesbach' where listing_id = :'l';
reset role;
select tests.as_postgres();
select is((select status::text from listings where id = :'l'), 'active', 'Server ändert den Ort: Status bleibt');

-- Admin an der eigenen Anzeige gilt als Besitzer (QA M3 F1).
select tests.authenticate_as(:'adm', 'aal2');
insert into listings (kind, direction, title, content_language, region_id)
values ('helper', 'offer', 'Eigene Anzeige eines Admins', 'de', :'muenchen') returning id as la \gset
select set_listing_location(:'la', :'muenchen', '80331', 'München');
select tests.as_postgres();
update listings set status = 'active', expires_at = now() + interval '30 days' where id = :'la';
select tests.authenticate_as(:'adm', 'aal2');
update listing_places set postal_code = '80333' where listing_id = :'la';
select is((select status::text from listings where id = :'la'), 'pending_review', 'Admin-Besitzer: Ort geändert → pending_review');

-- Ohne Zustimmung zu den Rechtstexten: RV001.
-- Die Anzeige legt der Server an, weil das Anlegen selbst schon RV001 ergibt (17_listing_rules).
select tests.as_postgres();
insert into listings (owner_id, kind, direction, title, content_language, region_id)
values (:'c_id', 'lease', 'offer', 'Ohne Zustimmung', 'de', :'muenchen') returning id as lc \gset
select tests.authenticate_as(:'c_id');
select throws_ok(format($$ select set_listing_location(%L, %L, '80331', 'München') $$, :'lc', :'muenchen'),
  'RV001', null, 'Ohne Zustimmung: RV001');

-- Gesperrtes Konto schreibt nicht.
select tests.as_postgres();
update profiles set is_blocked = true where user_id = :'a_id';
select tests.authenticate_as(:'a_id');
select throws_ok(format($$ select set_listing_location(%L, %L, '83700', 'Rottach-Egern') $$, :'l', :'miesbach'),
  '42501', null, 'Gesperrtes Konto setzt keinen Ort');

-- Löschen der Anzeige entfernt den Ort.
select tests.as_postgres();
delete from listings where id = :'w';
select is((select count(*)::int from listing_places where listing_id = :'w'), 0, 'Ort verschwindet mit der Anzeige');

-- Kein Such-Orakel (Review Plan M3 PLZ 2): nur diese Funktionen und keine View verwenden listing_places.
select set_eq($$ select n.nspname || '.' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname not in ('pg_catalog', 'information_schema', 'tests') and p.prosrc ~ 'listing_places'
  union all select schemaname || '.' || viewname from pg_views where definition ~ 'listing_places' $$,
  array['private.listing_children_guard', 'private.listing_content_hash', 'private.listing_readiness',
        'public.set_listing_location'],
  'Nur Guard, Bereitschaft, Freigabe-Hash und RPC verwenden listing_places (Allowlist; Trigger der Tabelle lesen nur NEW)');

select * from finish();
rollback;
