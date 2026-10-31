begin;
\ir _helpers.psql
select plan(19);

-- M5 Commit 2 (ADR 015): published_at/approved_at, eindeutige Regions-Slugs, Favoriten-Limit.
set constraints all immediate;

select tests.create_user('pub-owner@test.local') as owner_id \gset
select tests.create_user('pub-mod@test.local') as mod_id \gset
select tests.create_user('pub-fan@test.local') as fan_id \gset
select tests.make_admin(:'mod_id');
select id as dd from regions where code = 'DE-14612' \gset

select tests.authenticate_as(:'owner_id');
insert into listings (kind, direction, title, content_language, region_id)
values ('helper', 'wanted', 'Veröffentlichung', 'de', :'dd') returning id as l \gset
select tests.as_postgres();
select tests.make_ready(:'l');

-- Nur der Server setzt die Zeitpunkte
select tests.authenticate_as(:'owner_id');
select throws_ok(format($$ update listings set published_at = now() where id = %L $$, :'l'), '42501', null,
  'Besitzer setzt published_at nicht');
select throws_ok(format($$ update listings set approved_at = now() where id = %L $$, :'l'), '42501', null,
  'Besitzer setzt approved_at nicht');
update listings set status = 'pending_review' where id = :'l';
select is((select (published_at, approved_at)::text from listings where id = :'l'), '(,)', 'Einreichen setzt nichts');

-- Erste Freigabe setzt beide
select tests.authenticate_as(:'mod_id', 'aal2');
select moderate_listing(:'l', 'approve', admin_listing_version(:'l'));
select is((select published_at from listings where id = :'l'), now(), 'Freigabe setzt published_at');
select is((select approved_at from listings where id = :'l'), now(), 'Freigabe setzt approved_at');

-- Zeitpunkte zurückdatieren (der Trigger hält sie sonst auch für den Server fest), damit spätere Änderungen sichtbar sind
select tests.as_postgres();
alter table listings disable trigger listings_zz_publication_fields;
update listings set published_at = now() - interval '10 days', approved_at = now() - interval '10 days' where id = :'l';
alter table listings enable trigger listings_zz_publication_fields;

-- Pausieren und Fortsetzen ist keine Freigabe; die Anzeige bleibt fortsetzbar (Hash ohne die Spalten)
select tests.authenticate_as(:'owner_id');
update listings set status = 'paused' where id = :'l';
select lives_ok(format($$ update listings set status = 'active' where id = %L $$, :'l'), 'Fortsetzen nach Pause möglich');
select is((select approved_at from listings where id = :'l'), now() - interval '10 days', 'Fortsetzen ändert approved_at nicht');
select is((select published_at from listings where id = :'l'), now() - interval '10 days', 'Fortsetzen ändert published_at nicht');

-- Bearbeiten und erneute Freigabe: approved_at neu, published_at bleibt (keine „neue“ Anzeige)
update listings set title = 'Veröffentlichung geändert' where id = :'l';
select is((select status::text from listings where id = :'l'), 'pending_review', 'Bearbeitung führt in die Prüfung');
select tests.authenticate_as(:'mod_id', 'aal2');
select moderate_listing(:'l', 'approve', admin_listing_version(:'l'));
select is((select approved_at from listings where id = :'l'), now(), 'Erneute Freigabe setzt approved_at');
select is((select published_at from listings where id = :'l'), now() - interval '10 days', 'published_at bleibt die erste Freigabe');

-- Auch der Server-Pfad setzt die Zeitpunkte (Trigger auf allen Pfaden) und hält sie fest
select tests.as_postgres();
insert into listings (owner_id, kind, direction, title, content_language, region_id, status)
values (:'owner_id', 'helper', 'wanted', 'Direkt aktiv', 'de', :'dd', 'active') returning id as l2 \gset
select isnt((select published_at from listings where id = :'l2'), null, 'Server-Insert als aktiv setzt published_at');
update listings set published_at = null where id = :'l2';
select isnt((select published_at from listings where id = :'l2'), null, 'Auch der Server leert published_at nicht');
insert into listings (owner_id, kind, direction, title, content_language, region_id, status, published_at)
values (:'owner_id', 'helper', 'wanted', 'Vorgabe', 'de', :'dd', 'draft', now()) returning id as l3 \gset
select is((select published_at from listings where id = :'l3'), null, 'Ein Entwurf bekommt kein published_at, auch nicht vorgegeben');
select results_eq(
  $$ select count(*)::int from listings where status = 'active' and published_at is null $$,
  array[0], 'Keine aktive Anzeige ohne published_at');

-- Regions-Slugs: Bundesland global eindeutig, Kreis je Bundesland
select is((select count(*)::int from (select slug from regions where level = 'state' group by slug having count(*) > 1) x),
  0, 'Bundesland-Slugs sind über alle Länder eindeutig');
select throws_ok(
  $$ insert into regions (country, level, code, slug, name_de, name_en, name_cs, name_pl, centroid)
     select 'AT', 'state', 'AT-X', slug, 'x', 'x', 'x', 'x', centroid from regions where code = 'DE-BY' $$,
  '23505', null, 'Doppelter Bundesland-Slug in einem anderen Land scheitert');

-- Favoriten-Limit (500, Code 23514 mit Hint)
update private.app_settings set value = '1' where key = 'favorites_max';
select tests.authenticate_as(:'fan_id');
insert into favorites (listing_id) values (:'l');
select throws_like(format($$ insert into favorites (listing_id) values (%L) $$, :'l2'), '%Favoriten%',
  'Limit für Favoriten greift');
select tests.as_postgres();
select is((select value::int from private.app_settings where key = 'favorites_max'), 1, 'Einstellung favorites_max vorhanden');

select * from finish();
rollback;
