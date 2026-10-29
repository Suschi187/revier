begin;
\ir _helpers.psql
select plan(6);

-- Fotos umsortieren (Migration reorder_listing_photos)
select tests.create_user('owner@test.local') as a_id \gset
select tests.create_user('fremd@test.local') as b_id \gset
select id as district from regions where code = 'DE-09162' \gset
select tests.authenticate_as(:'a_id');
insert into listings (kind, direction, title, content_language, region_id)
values ('helper', 'wanted', 'Fotos sortieren', 'de', :'district') returning id as l \gset
insert into listing_photos (listing_id, sort_order) values (:'l', 0) returning id as p0 \gset
insert into listing_photos (listing_id, sort_order) values (:'l', 1) returning id as p1 \gset
insert into listing_photos (listing_id, sort_order) values (:'l', 2) returning id as p2 \gset

select lives_ok(format($$ select reorder_listing_photos(%L, array[%L, %L, %L]::uuid[]) $$, :'l', :'p2', :'p0', :'p1'), 'Besitzer sortiert um');
select is((select array_agg(id order by sort_order) from listing_photos where listing_id = :'l'), array[:'p2', :'p0', :'p1']::uuid[], 'Neue Reihenfolge');
select throws_ok(format($$ select reorder_listing_photos(%L, array[%L, %L]::uuid[]) $$, :'l', :'p0', :'p1'), '22023', null, 'Unvollständige Liste abgelehnt');
select throws_ok(format($$ select reorder_listing_photos(%L, array[%L, %L, %L]::uuid[]) $$, :'l', :'p0', :'p0', :'p1'), '22023', null, 'Doppelte Einträge abgelehnt');

select tests.authenticate_as(:'b_id');
select throws_ok(format($$ select reorder_listing_photos(%L, array[%L, %L, %L]::uuid[]) $$, :'l', :'p0', :'p1', :'p2'), '42501', null, 'Fremder sortiert nicht');

-- An einer aktiven Anzeige: zurück in die Prüfung
select tests.as_postgres();
update listings set status = 'active', expires_at = now() + interval '30 days' where id = :'l';
select tests.authenticate_as(:'a_id');
select reorder_listing_photos(:'l', array[:'p0', :'p1', :'p2']::uuid[]);
select is((select status::text from listings where id = :'l'), 'pending_review', 'Umsortieren an aktiver Anzeige → pending_review');

select * from finish();
rollback;
