begin;
\ir _helpers.psql
select plan(22);

-- Wie die Storage-API: Löschen freischalten, die RLS-Policies gelten weiter.
select set_config('storage.allow_delete_query', 'true', true);

select tests.create_user('a@test.local') as a_id \gset
select tests.create_user('b@test.local') as b_id \gset
select tests.create_user('admin@test.local') as admin_id \gset
select tests.make_admin(:'admin_id');
select id as district from regions where code = 'DE-14612' \gset

select ok(not (select public from storage.buckets where id = 'verification-docs'), 'verification-docs ist privat');
select ok(not (select public from storage.buckets where id = 'listing-photos'), 'listing-photos ist privat (Zugriff nur über Policies)');

-- Verifizierungsdokumente: Akzeptanzkriterium M1 (Bucket) -----------------------
select tests.authenticate_as(:'a_id');
insert into storage.objects (bucket_id, name, owner_id) values ('verification-docs', :'a_id' || '/jagdschein.jpg', :'a_id');
select is((select count(*)::int from storage.objects where bucket_id = 'verification-docs'), 1, 'A lädt den eigenen Jagdschein hoch und sieht ihn');
select throws_ok(format($$ insert into storage.objects (bucket_id, name) values ('verification-docs', %L) $$, :'b_id' || '/untergeschoben.jpg'),
  '42501', null, 'A lädt nicht in den Ordner von B hoch');
select throws_ok(format($$ insert into storage.objects (bucket_id, name) values ('verification-docs', %L) $$, :'a_id' || '/tief/verschachtelt.jpg'),
  '42501', null, 'Keine Unterordner im Dokument-Bucket');

select tests.authenticate_as(:'b_id');
select is((select count(*)::int from storage.objects where bucket_id = 'verification-docs'), 0, 'B sieht den Jagdschein von A nicht');
select tests.as_anon();
select is((select count(*)::int from storage.objects where bucket_id = 'verification-docs'), 0, 'anon sieht keine Dokumente');
select tests.authenticate_as(:'admin_id', 'aal1');
select is((select count(*)::int from storage.objects where bucket_id = 'verification-docs'), 0, 'Admin ohne 2FA sieht keine Dokumente');
select tests.authenticate_as(:'admin_id', 'aal2');
select is((select count(*)::int from storage.objects where bucket_id = 'verification-docs'), 1, 'Admin mit 2FA sieht das Dokument');

select tests.authenticate_as(:'a_id');
delete from storage.objects where bucket_id = 'verification-docs';
select tests.as_postgres();
select is((select count(*)::int from storage.objects where bucket_id = 'verification-docs'), 1, 'Dokumente löscht nur der Server (Retention, M9)');

-- Anzeigenfotos: erst registrieren, dann hochladen (Review M1) -------------------
select tests.authenticate_as(:'b_id');
insert into listings (kind, direction, title, content_language, region_id) values ('helper', 'wanted', 'Helfer gesucht', 'de', :'district')
returning id as listing_b \gset
select :'b_id' || '/' || :'listing_b' || '/1.jpg' as path1 \gset
select throws_ok(format($$ insert into storage.objects (bucket_id, name) values ('listing-photos', %L) $$, :'path1'),
  '42501', null, 'Upload ohne registriertes Foto wird abgelehnt (Limit gilt auch im Bucket)');
insert into listing_photos (listing_id, storage_path, sort_order) values (:'listing_b', :'path1', 0);
insert into storage.objects (bucket_id, name, owner_id) values ('listing-photos', :'path1', :'b_id');
select is((select count(*)::int from storage.objects where bucket_id = 'listing-photos'), 1, 'Registriertes Foto lässt sich hochladen');
select throws_ok(format($$ insert into listing_photos (listing_id, storage_path, sort_order) values (%L, %L, 1) $$,
  :'listing_b', :'a_id' || '/' || :'listing_b' || '/fremd.jpg'), '23514', null, 'storage_path mit fremdem Besitzer-Präfix wird abgelehnt');

select tests.authenticate_as(:'a_id');
select throws_ok(format($$ insert into storage.objects (bucket_id, name) values ('listing-photos', %L) $$, :'a_id' || '/' || :'listing_b' || '/fremd.jpg'),
  '42501', null, 'A lädt keine Fotos zur Anzeige von B hoch');
select throws_ok(format($$ insert into listing_photos (listing_id, storage_path, sort_order) values (%L, %L, 2) $$,
  :'listing_b', :'b_id' || '/' || :'listing_b' || '/2.jpg'), '42501', null, 'A registriert keine Fotos an der Anzeige von B (kein Existenz-Orakel)');
select throws_ok(format($$ insert into listing_photos (listing_id, storage_path, sort_order) values (%L, %L, 2) $$,
  gen_random_uuid(), :'a_id' || '/x/2.jpg'), '42501', null, 'Unbekannte Anzeige liefert denselben Fehler');
select is((select count(*)::int from storage.objects where bucket_id = 'listing-photos'), 0, 'A sieht Fotos eines fremden Entwurfs nicht');
select tests.as_anon();
select is((select count(*)::int from storage.objects where bucket_id = 'listing-photos'), 0, 'anon sieht Fotos eines Entwurfs nicht');

select tests.as_postgres();
update listings set status = 'active', expires_at = now() + interval '30 days' where id = :'listing_b';
select tests.as_anon();
select is((select count(*)::int from storage.objects where bucket_id = 'listing-photos'), 1, 'anon sieht Fotos einer aktiven Anzeige');

select tests.authenticate_as(:'a_id');
delete from storage.objects where bucket_id = 'listing-photos';
select tests.as_postgres();
select is((select count(*)::int from storage.objects where bucket_id = 'listing-photos'), 1, 'A löscht keine Fotos von B');

-- Verwaiste Datei (Zeile gelöscht) ist nicht mehr lesbar, der Besitzer kann sie entfernen
select tests.authenticate_as(:'b_id');
delete from listing_photos where storage_path = :'path1';
select tests.as_anon();
select is((select count(*)::int from storage.objects where bucket_id = 'listing-photos'), 0, 'Verwaiste Datei ist öffentlich nicht lesbar');
select tests.authenticate_as(:'b_id');
delete from storage.objects where bucket_id = 'listing-photos' and name = :'path1';
select tests.as_postgres();
select is((select count(*)::int from storage.objects where bucket_id = 'listing-photos'), 0, 'Besitzer entfernt die verwaiste Datei');

select * from finish();
rollback;
