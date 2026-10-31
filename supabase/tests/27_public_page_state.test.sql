begin;
\ir _helpers.psql
select plan(24);

-- M5 Commit 4 (ADR 015): public_page_state (nur public/gone/null), provider_listings, Cache-Zähler.
set constraints all immediate;

select tests.create_user('ps-owner@test.local') as o1 \gset
select tests.create_user('ps-other@test.local') as o2 \gset
select tests.create_user('ps-new@test.local') as o3 \gset
select tests.create_user('ps-mod@test.local') as adm \gset
select tests.make_admin(:'adm');
select id as dd from regions where code = 'DE-14612' \gset

insert into listings (owner_id, kind, direction, title, content_language, region_id, status, expires_at) values
  (:'o1', 'helper', 'wanted', 'Öffentlich eins', 'de', :'dd', 'active', now() + interval '30 days'),
  (:'o1', 'helper', 'wanted', 'Öffentlich zwei', 'de', :'dd', 'active', now() + interval '30 days'),
  (:'o1', 'helper', 'wanted', 'Öffentlich drei', 'de', :'dd', 'active', now() + interval '30 days'),
  (:'o1', 'helper', 'wanted', 'Entwurf', 'de', :'dd', 'draft', null),
  (:'o1', 'helper', 'wanted', 'In Prüfung', 'de', :'dd', 'pending_review', null),
  (:'o1', 'helper', 'wanted', 'Abgelehnt nie öffentlich', 'de', :'dd', 'rejected', null),
  (:'o2', 'helper', 'wanted', 'Fremd öffentlich', 'de', :'dd', 'active', now() + interval '30 days'),
  (:'o3', 'helper', 'wanted', 'Neu im Entwurf', 'de', :'dd', 'draft', null);
select id as pub from listings where title = 'Öffentlich eins' \gset
select id as draft from listings where title = 'Entwurf' \gset
select id as review from listings where title = 'In Prüfung' \gset
select id as rejected from listings where title = 'Abgelehnt nie öffentlich' \gset
select id as other from listings where title = 'Fremd öffentlich' \gset

-- Nie veröffentlicht → null (kein Orakel)
select tests.as_anon();
select is(public_page_state('listing', :'pub'), 'public', 'Öffentliche Anzeige');
select is(public_page_state('listing', :'draft'), null, 'Entwurf: null');
select is(public_page_state('listing', :'review'), null, 'Erste Prüfung: null');
select is(public_page_state('listing', :'rejected'), null, 'Abgelehnt ohne Veröffentlichung: null');
select is(public_page_state('listing', gen_random_uuid()), null, 'Unbekannt: null');
select throws_ok($$ select public_page_state('photo', gen_random_uuid()) $$, '22023', null, 'Unbekannte Seitenart');

-- Einmal öffentlich, jetzt nicht → gone, egal aus welchem Grund (A4)
select tests.as_postgres();
update listings set status = 'paused' where id = :'pub';
select tests.as_anon();
select is(public_page_state('listing', :'pub'), 'gone', 'Pausiert: gone');
select tests.as_postgres();
update listings set status = 'active', expires_at = now() - interval '1 minute' where id = :'pub';
select tests.as_anon();
select is(public_page_state('listing', :'pub'), 'gone', 'Abgelaufen: gone');
select tests.as_postgres();
update listings set status = 'pending_review', expires_at = null where id = :'pub';
select tests.as_anon();
select is(public_page_state('listing', :'pub'), 'gone', 'Wieder in der Prüfung: gone');
select tests.as_postgres();
update listings set status = 'removed' where id = :'pub';
select tests.as_anon();
select is(public_page_state('listing', :'pub'), 'gone', 'Entfernt: gone, nie „removed“');

-- Anbieter
select is(public_page_state('provider', :'o1'), 'public', 'Anbieter mit öffentlicher Anzeige');
select is(public_page_state('provider', :'o3'), null, 'Anbieter ohne je veröffentlichte Anzeige: null');
select is(public_page_state('provider', gen_random_uuid()), null, 'Unbekannter Anbieter: null');

-- provider_listings: nur öffentliche, neueste zuerst, Paging
select tests.as_postgres();
alter table listings disable trigger listings_zz_publication_fields;
update listings set published_at = now() - interval '2 days' where title = 'Öffentlich zwei';
update listings set published_at = now() - interval '1 day' where title = 'Öffentlich drei';
alter table listings enable trigger listings_zz_publication_fields;
select tests.as_anon();
select provider_listings(:'o1', null, 1) as page1 \gset
select is(array(select e ->> 'title' from jsonb_array_elements(:'page1'::jsonb -> 'items') e), '{Öffentlich drei}'::text[], 'Erste Seite');
select is(array(select e ->> 'title' from jsonb_array_elements(provider_listings(:'o1', :'page1'::jsonb ->> 'next_cursor', 5) -> 'items') e),
  '{Öffentlich zwei}'::text[], 'Zweite Seite ohne Entwurf, Prüfung und Entfernte');
select throws_ok(format($$ select provider_listings(%L, %L, 1) $$, :'o2', :'page1'::jsonb ->> 'next_cursor'), '22023', null,
  'Cursor gilt nur für denselben Anbieter');
select tests.authenticate_as(:'o1');
select is(jsonb_array_length(provider_listings(:'o1', null, 50) -> 'items'), 2, 'Auch der Besitzer sieht nur seine öffentlichen');

-- Gesperrter Anbieter: gone, keine Anzeigen
select tests.as_postgres();
select public_cache_epoch() as e0 \gset
update profiles set is_blocked = true where user_id = :'o1';
select tests.as_anon();
select is(public_page_state('provider', :'o1'), 'gone', 'Gesperrter Anbieter: gone');
select is(jsonb_array_length(provider_listings(:'o1') -> 'items'), 0, 'Gesperrter Anbieter: keine Anzeigen');

-- Cache-Zähler: Sperren, Entfernen, Konto-Löschung erhöhen ihn, normale Änderungen nicht
select is(public_cache_epoch(), :'e0'::bigint + 1, 'Sperren erhöht den Cache-Zähler');
select tests.as_postgres();
update listings set title = 'Fremd geändert' where id = :'other';
update listings set status = 'paused' where id = :'other';
select is(public_cache_epoch(), :'e0'::bigint + 1, 'Bearbeiten und Pausieren erhöhen ihn nicht');
update listings set status = 'removed' where id = :'other';
select is(public_cache_epoch(), :'e0'::bigint + 2, 'Entfernen durch die Moderation erhöht ihn');
update profiles set deleted_at = now() where user_id = :'o3';
select is(public_cache_epoch(), :'e0'::bigint + 3, 'Konto als gelöscht markiert erhöht ihn');
delete from auth.users where id = :'o2';
select is(public_cache_epoch(), :'e0'::bigint + 4, 'Konto-Löschung (Kaskade) erhöht ihn');

select * from finish();
rollback;
