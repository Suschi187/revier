begin;
\ir _helpers.psql
select plan(28);

-- QA M5 Nachprüfung (docs/QA-REPORT.md, Abschnitt „M5 – Nachprüfung“): Proben zu den Fixes F1, F2, F3, F4, F7
-- über die Tests 28/29 hinaus.
-- - F1: Funktionsattribut extra_float_digits wirkt auch bei extra_float_digits = 0 in der Sitzung und leckt nicht
--   in die Sitzung; Relevanz-Paging mit vielen verschiedenen Rängen
-- - F2: Grenze bei 16 Wörtern, Operatoren, Fehler weiter mit hint q
-- - F3: my_favorites/remove_unavailable_favorites nicht für anon, nur eigene Zeilen, keine Orts- oder Titeldaten
--   nicht verfügbarer Anzeigen, gesperrter Besitzer zählt als nicht verfügbar
-- - F4: nur öffentliche, fremde Anzeigen merkbar (auch pausierte fremde nicht)
-- - F7: Update auf „auf Anfrage“ mit Währung ebenfalls abgewiesen
set constraints all immediate;

create function tests.qa5n_hint(f jsonb)
returns text language plpgsql as $$
declare h text;
begin
  perform public.search_listings(f, null, 20);
  return null;
exception when sqlstate '22023' then
  get stacked diagnostics h = pg_exception_hint;
  return h;
end;
$$;
create function tests.qa5n_all_pages(f jsonb, lim integer)
returns uuid[] language plpgsql as $$
declare
  ids uuid[] := '{}';
  page jsonb;
  cur text := null;
  i integer := 0;
begin
  loop
    page := public.search_listings(f, cur, lim);
    ids := ids || array(select (e ->> 'id')::uuid from jsonb_array_elements(page -> 'items') with ordinality t(e, n) order by n);
    cur := page ->> 'next_cursor';
    i := i + 1;
    exit when cur is null or i >= 100;
  end loop;
  return ids;
end;
$$;
create function tests.qa5n_sqlstate(stmt text)
returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate;
end;
$$;
grant execute on function tests.qa5n_hint(jsonb), tests.qa5n_all_pages(jsonb, integer), tests.qa5n_sqlstate(text) to anon, authenticated;

select tests.create_user('qa5n-owner@test.local', 'QA5N Owner') as o \gset
select tests.create_user('qa5n-fan@test.local', 'QA5N Fan') as fan \gset
select tests.create_user('qa5n-other@test.local', 'QA5N Other') as other \gset
select tests.create_user('qa5n-banned@test.local', 'QA5N Banned') as banned \gset
select id as muc from regions where code = 'DE-09162' \gset

-- 37 Anzeigen mit verschiedenen Rängen (Wort unterschiedlich oft), dazu Gleichstände
insert into listings (owner_id, kind, direction, title, description, content_language, region_id, status, expires_at)
select :'o', 'helper', 'wanted', 'QA5N Nachpruefkeiler ' || g,
       repeat('Nachpruefkeiler ', (g % 13) + 1) || repeat('Fuellwort ', g % 7) || 'Ende.', 'de', :'muc', 'active', now() + interval '30 days'
from generate_series(1, 37) g;

-- ---------------------------------------------------------------------------
-- F1
-- ---------------------------------------------------------------------------
select ok((select proconfig @> array['extra_float_digits=3'] from pg_proc where proname = 'search_listings'),
  'F1: search_listings trägt extra_float_digits = 3 als Funktionsattribut');
set extra_float_digits = 0;
select tests.as_anon();
select is(cardinality(tests.qa5n_all_pages('{"v":1,"q":"Nachpruefkeiler","sort":"relevance"}', 1)), 37,
  'F1: Relevanz mit Limit 1 bei extra_float_digits = 0: alle 37, keine Endlosschleife');
select is((select count(distinct x)::int from unnest(tests.qa5n_all_pages('{"v":1,"q":"Nachpruefkeiler","sort":"relevance"}', 1)) x), 37,
  'F1: keine Doppelten');
select is(tests.qa5n_all_pages('{"v":1,"q":"Nachpruefkeiler","sort":"relevance"}', 3),
  tests.qa5n_all_pages('{"v":1,"q":"Nachpruefkeiler","sort":"relevance"}', 50), 'F1: Limit 3 in derselben Reihenfolge wie am Stück');
select is(current_setting('extra_float_digits'), '0', 'F1: Funktionsattribut leckt nicht in die Sitzung');
select is(tests.qa5n_all_pages('{"v":1,"q":"Nachpruefkeiler","sort":"newest"}', 4),
  tests.qa5n_all_pages('{"v":1,"q":"Nachpruefkeiler","sort":"newest"}', 50), 'F1: newest unverändert');
reset extra_float_digits;

-- ---------------------------------------------------------------------------
-- F2
-- ---------------------------------------------------------------------------
select is(tests.qa5n_hint('{"v":1,"q":"Suche Begehungsschein im Landkreis Rosenheim für Rotwild und Schwarzwild ab sofort"}'), null,
  'F2: natürlicher Satz mit zwölf Wörtern gültig');
select is(tests.qa5n_hint(jsonb_build_object('v', 1, 'q', (select string_agg('wort' || g, ' ') from generate_series(1, 16) g))), null,
  'F2: 16 Wörter gültig');
select is(tests.qa5n_hint(jsonb_build_object('v', 1, 'q', (select string_agg('wort' || g, ' ') from generate_series(1, 17) g))), 'q',
  'F2: 17 Wörter ergeben 22023 mit hint q');
select is(tests.qa5n_hint(jsonb_build_object('v', 1, 'q', (select string_agg('wort' || g, ' or ') from generate_series(1, 17) g))), 'q',
  'F2: auch mit OR-Operatoren begrenzt');
select is(tests.qa5n_hint('{"v":1,"q":"\"Rotwild Schwarzwild\" -Damwild Rosenheim"}'), null, 'F2: Phrase und Ausschluss gültig');
select is(tests.qa5n_hint(jsonb_build_object('v', 1, 'q', repeat('a', 201))), 'q', 'F2: über 200 Zeichen weiter hint q');

-- ---------------------------------------------------------------------------
-- F3 und F4
-- ---------------------------------------------------------------------------
select tests.as_postgres();
insert into listings (owner_id, kind, direction, title, content_language, region_id, status, expires_at) values
  (:'banned', 'helper', 'wanted', 'QA5N Gesperrter Besitzer', 'de', :'muc', 'active', now() + interval '30 days'),
  (:'o', 'helper', 'wanted', 'QA5N Pausiert Geheimtitel', 'de', :'muc', 'active', now() + interval '30 days'),
  (:'fan', 'helper', 'wanted', 'QA5N Eigene des Fans', 'de', :'muc', 'active', now() + interval '30 days');
select id as l_banned from listings where title = 'QA5N Gesperrter Besitzer' \gset
select id as l_paused from listings where title = 'QA5N Pausiert Geheimtitel' \gset
select id as l_own from listings where title = 'QA5N Eigene des Fans' \gset
select id as l_one from listings where title = 'QA5N Nachpruefkeiler 1' \gset
insert into public.listing_places (listing_id, postal_code, place_name)
select :'l_one', code, 'Geheimdorf' from postal_code_regions where region_id = :'muc' order by code limit 1;

select tests.authenticate_as(:'fan');
select lives_ok(format($$ insert into favorites (listing_id) values (%L), (%L), (%L) $$, :'l_one', :'l_banned', :'l_paused'),
  'F4: öffentliche fremde Anzeigen merkbar');
select is(tests.qa5n_sqlstate(format($$ insert into favorites (listing_id) values (%L) $$, :'l_own')), '42501',
  'F4: eigene öffentliche Anzeige nicht merkbar');
select tests.authenticate_as(:'other');
select lives_ok(format($$ insert into favorites (listing_id) values (%L), (%L) $$, :'l_banned', :'l_paused'), 'Anderes Konto merkt zwei');

select tests.as_postgres();
update profiles set is_blocked = true where user_id = :'banned';
update listings set status = 'paused' where id = :'l_paused';

select tests.authenticate_as(:'fan');
select is(tests.qa5n_sqlstate(format($$ insert into favorites (listing_id) values (%L) $$, (select id from listings where title = 'QA5N Nachpruefkeiler 2'))), null,
  'Weitere öffentliche Anzeige merkbar');
select tests.as_postgres();
select tests.authenticate_as(:'other');
select is(tests.qa5n_sqlstate(format($$ insert into favorites (listing_id) values (%L) $$, :'l_one')), null, 'other merkt l_one');
select tests.as_postgres();
update listings set status = 'paused' where title = 'QA5N Nachpruefkeiler 2';
select tests.authenticate_as(:'fan');
select is(tests.qa5n_sqlstate(format($$ insert into favorites (listing_id) values (%L) $$,
  (select id from listings where title = 'QA5N Nachpruefkeiler 3'))), null, 'fan merkt l_three');

select is(jsonb_array_length(my_favorites() -> 'items'), 2, 'F3: nur die zwei verfügbaren eigenen Favoriten (ohne die des anderen Kontos)');
select is((my_favorites() ->> 'unavailable')::int, 3, 'F3: gesperrter Besitzer und zwei pausierte zählen als nicht verfügbar');
select ok(my_favorites()::text not like '%Geheimtitel%' and my_favorites()::text not like '%Geheimdorf%'
  and my_favorites()::text not like '%Gesperrter Besitzer%', 'F3: keine Titel nicht verfügbarer Anzeigen, kein Ortsname');
select is(remove_unavailable_favorites(), 3, 'F3: entfernt genau die drei nicht verfügbaren');
select tests.authenticate_as(:'other');
select is((my_favorites() ->> 'unavailable')::int, 2, 'F3: Favoriten des anderen Kontos unberührt');
select tests.as_anon();
select is(tests.qa5n_sqlstate('select public.my_favorites()'), '42501', 'F3: anon darf my_favorites nicht aufrufen');
select is(tests.qa5n_sqlstate('select public.remove_unavailable_favorites()'), '42501', 'F3: anon darf remove_unavailable_favorites nicht aufrufen');
select tests.authenticate_as(:'other');
select is(tests.qa5n_sqlstate(format($$ insert into favorites (listing_id) values (%L) $$, :'l_paused')), '42501',
  'F4: pausierte fremde Anzeige nicht merkbar (kein Orakel)');

-- ---------------------------------------------------------------------------
-- F7
-- ---------------------------------------------------------------------------
select tests.as_postgres();
select is(tests.qa5n_sqlstate(format($$ update listings set price_unit = 'on_request', currency = 'EUR', price_minor = null where id = %L $$, :'l_one')),
  '23514', 'F7: Update auf „auf Anfrage“ mit Währung verletzt price_consistent');
select is(tests.qa5n_sqlstate(format($$ update listings set price_unit = 'on_request', currency = null, price_minor = null where id = %L $$, :'l_one')),
  null, 'F7: „auf Anfrage“ ohne Währung bleibt erlaubt');

select * from finish();
rollback;
