begin;
\ir _helpers.psql
select plan(8);

-- QA M5 F3 (ADR 015): Favoriten per RPC. my_favorites liefert Karten verfügbarer und die Zahl nicht mehr
-- verfügbarer Anzeigen in einer Abfrage, remove_unavailable_favorites entfernt nur diese, nur eigene.
set constraints all immediate;

select tests.create_user('fx-owner@test.local') as o \gset
select tests.create_user('fx-fan@test.local') as fan \gset
select tests.create_user('fx-other@test.local') as other \gset
select id as dd from regions where code = 'DE-14612' \gset

-- 300 öffentliche Anzeigen, alle gemerkt (über der früheren URL-Grenze von ~220 IDs)
insert into listings (owner_id, kind, direction, title, content_language, region_id, status, expires_at)
select :'o', 'helper', 'wanted', 'Favorit ' || g, 'de', :'dd', 'active', now() + interval '30 days' from generate_series(1, 300) g;
insert into favorites (user_id, listing_id) select :'fan', id from listings where owner_id = :'o';
insert into favorites (user_id, listing_id) select :'other', id from listings where owner_id = :'o' and title = 'Favorit 1';

select tests.authenticate_as(:'fan');
select is(jsonb_array_length(my_favorites() -> 'items'), 300, '300 Favoriten werden alle geliefert');
select is((my_favorites() ->> 'unavailable')::int, 0, 'Keiner nicht verfügbar');
select is(remove_unavailable_favorites(), 0, 'Entfernen ohne nicht verfügbare entfernt nichts');

-- Zwei werden pausiert bzw. entfernt
select tests.as_postgres();
update listings set status = 'paused' where owner_id = :'o' and title in ('Favorit 1', 'Favorit 2');
select tests.authenticate_as(:'fan');
select is(jsonb_array_length(my_favorites() -> 'items'), 298, 'Nicht mehr verfügbare fehlen in der Liste');
select is((my_favorites() ->> 'unavailable')::int, 2, 'und werden gezählt');
select is(remove_unavailable_favorites(), 2, 'Entfernen entfernt genau die nicht verfügbaren');
select is((select count(*)::int from favorites where user_id = :'fan'), 298, 'Verfügbare Favoriten bleiben');
select tests.as_postgres();
select is((select count(*)::int from favorites where user_id = :'other'), 1, 'Favoriten anderer Konten bleiben unberührt');

select * from finish();
rollback;
