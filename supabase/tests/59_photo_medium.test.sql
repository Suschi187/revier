begin;
\ir _helpers.psql
select plan(9);

-- Mittlere Bildgröße (Migration 20261113140000): Pfad vom Server, Lesen nur verarbeitet, Aufräumen kennt die Datei.
select set_config('storage.allow_delete_query', 'true', true);
select tests.create_user('m59-a@test.local') as a_id \gset
select tests.create_user('m59-b@test.local') as b_id \gset
select id as district from regions where code = 'DE-14612' \gset

select tests.authenticate_as(:'b_id');
insert into listings (kind, direction, title, content_language, region_id) values ('helper', 'wanted', 'Helfer gesucht', 'de', :'district')
returning id as listing_b \gset
insert into listing_photos (listing_id, sort_order) values (:'listing_b', 0) returning id as photo, medium_path \gset
select is(:'medium_path', :'b_id' || '/' || :'listing_b' || '/' || :'photo' || '_medium.jpg', 'medium_path leitet der Server aus Besitzer, Anzeige und Foto-id ab');
select throws_ok(format($$ update listing_photos set medium_path = %L where id = %L $$, :'b_id' || '/' || :'listing_b' || '/x.jpg', :'photo'),
  '42501', null, 'Besitzer ändert medium_path nicht');
select throws_ok(format($$ insert into listing_photos (listing_id, sort_order, medium_path) values (%L, 1, 'x/y/z.jpg') $$, :'listing_b'),
  '42501', null, 'Eigener medium_path wird abgelehnt (Spaltenrecht)');

select tests.as_postgres();
select is((select medium_path from claim_photo_processing(:'photo', :'b_id')), :'medium_path', 'claim_photo_processing liefert den Pfad der mittleren Größe');
insert into storage.objects (bucket_id, name, owner_id) values ('listing-photos', :'medium_path', :'b_id');
update listings set status = 'active', expires_at = now() + interval '30 days' where id = :'listing_b';

select tests.as_anon();
select is((select count(*)::int from storage.objects where bucket_id = 'listing-photos' and name = :'medium_path'), 0,
  'Unverarbeitet: mittlere Größe öffentlich nicht lesbar');

select tests.as_postgres();
update listing_photos set processed_at = now(), width = 2048, height = 1365 where id = :'photo';
select tests.as_anon();
select is((select count(*)::int from storage.objects where bucket_id = 'listing-photos' and name = :'medium_path'), 1,
  'Verarbeitet und öffentlich: mittlere Größe lesbar');
select tests.authenticate_as(:'a_id');
delete from storage.objects where bucket_id = 'listing-photos' and name = :'medium_path';
select tests.as_postgres();
select is((select count(*)::int from storage.objects where bucket_id = 'listing-photos' and name = :'medium_path'), 1,
  'Fremder Nutzer löscht die mittlere Größe nicht');

-- Aufräumen: nicht als verwaist melden, solange die Zeile existiert.
update storage.objects set created_at = now() - interval '30 days' where bucket_id = 'listing-photos' and name = :'medium_path';
select s.decrypted_secret as secret from vault.decrypted_secrets s where s.name = 'account_maintenance_secret' \gset
select is((select count(*)::int from maintenance_storage_objects(:'secret') m where m.name = :'medium_path'), 0,
  'Mittlere Größe mit Fotozeile ist keine verwaiste Datei');
delete from listing_photos where id = :'photo';
select is((select count(*)::int from maintenance_storage_objects(:'secret') m where m.name = :'medium_path' and m.reason = 'photo_orphan'), 1,
  'Ohne Fotozeile wird die mittlere Größe aufgeräumt');

select * from finish();
rollback;
