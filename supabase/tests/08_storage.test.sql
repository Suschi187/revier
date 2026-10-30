begin;
\ir _helpers.psql
select plan(31);

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

-- Anzeigenfotos (ADR 011): Zeile anlegen → Original in den Eingang → Server verarbeitet -------
select ok(not (select public from storage.buckets where id = 'listing-uploads'), 'listing-uploads (Eingang) ist privat');
select ok(not has_column_privilege('authenticated', 'public.listing_photos', 'storage_path', 'insert')
  and not has_column_privilege('authenticated', 'public.listing_photos', 'processed_at', 'insert')
  and not has_column_privilege('authenticated', 'public.listing_photos', 'processed_at', 'update')
  and not has_column_privilege('authenticated', 'public.listing_photos', 'upload_path', 'update')
  and not has_column_privilege('authenticated', 'public.listing_photos', 'listing_id', 'update')
  and has_column_privilege('authenticated', 'public.listing_photos', 'alt_text', 'insert')
  and has_column_privilege('authenticated', 'public.listing_photos', 'sort_order', 'update'),
  'Nutzer setzen nur Anzeige, Reihenfolge und Alt-Text; Pfade und Verarbeitung nur der Server');

select tests.authenticate_as(:'b_id');
insert into listings (kind, direction, title, content_language, region_id) values ('helper', 'wanted', 'Helfer gesucht', 'de', :'district')
returning id as listing_b \gset
insert into listing_photos (listing_id, sort_order, alt_text) values (:'listing_b', 0, 'Hochsitz am Waldrand')
returning id as photo1, upload_path, storage_path, thumb_path \gset
select is(array[:'upload_path', :'storage_path', :'thumb_path'],
  array[:'b_id' || '/' || :'listing_b' || '/' || :'photo1', :'b_id' || '/' || :'listing_b' || '/' || :'photo1' || '.jpg',
        :'b_id' || '/' || :'listing_b' || '/' || :'photo1' || '_thumb.jpg'],
  'Pfade leitet der Server aus Besitzer, Anzeige und Foto-id ab');
select throws_ok(format($$ insert into listing_photos (listing_id, sort_order, storage_path) values (%L, 1, 'x/y/z.jpg') $$, :'listing_b'),
  '42501', null, 'Eigener storage_path wird abgelehnt (Spaltenrecht)');
select throws_ok(format($$ update listing_photos set processed_at = now() where id = %L $$, :'photo1'),
  '42501', null, 'Nutzer markieren Fotos nicht selbst als verarbeitet');

select throws_ok(format($$ insert into storage.objects (bucket_id, name) values ('listing-photos', %L) $$, :'storage_path'),
  '42501', null, 'Nutzer schreiben nicht in listing-photos (nur der Server)');
select throws_ok(format($$ insert into storage.objects (bucket_id, name) values ('listing-uploads', %L) $$, :'b_id' || '/' || :'listing_b' || '/frei.jpg'),
  '42501', null, 'Eingang nur unter dem Pfad eines registrierten Fotos');
insert into storage.objects (bucket_id, name, owner_id) values ('listing-uploads', :'upload_path', :'b_id');
select is((select count(*)::int from storage.objects where bucket_id = 'listing-uploads'), 0, 'Original im Eingang ist auch für den Besitzer nicht lesbar');

select tests.authenticate_as(:'a_id');
select throws_ok(format($$ insert into storage.objects (bucket_id, name) values ('listing-uploads', %L) $$, :'upload_path'),
  '42501', null, 'A lädt nichts in den Eingang von B');
select throws_ok(format($$ insert into listing_photos (listing_id, sort_order) values (%L, 2) $$, :'listing_b'),
  '42501', null, 'A registriert keine Fotos an der Anzeige von B (kein Existenz-Orakel)');
select throws_ok(format($$ insert into listing_photos (listing_id, sort_order) values (%L, 2) $$, gen_random_uuid()),
  '42501', null, 'Unbekannte Anzeige liefert denselben Fehler');

-- Server verarbeitet (wie die Edge Function): Ausgaben schreiben, processed_at setzen
select tests.as_postgres();
select count(*)::int as uploads_before from storage.objects where bucket_id = 'listing-uploads' \gset
select is(:uploads_before, 1, 'Original liegt im Eingang');
insert into storage.objects (bucket_id, name, owner_id) values ('listing-photos', :'storage_path', :'b_id'), ('listing-photos', :'thumb_path', :'b_id');
update listing_photos set processed_at = now(), width = 2048, height = 1365 where id = :'photo1';
select tests.authenticate_as(:'b_id');
select throws_ok(format($$ insert into storage.objects (bucket_id, name) values ('listing-uploads', %L) $$, :'upload_path' || ''),
  '42501', null, 'Nach der Verarbeitung nimmt der Eingang für dieses Foto nichts mehr an');
-- zweites, unverarbeitetes Foto: eine Datei unter seinem Pfad bleibt unsichtbar
insert into listing_photos (listing_id, sort_order) values (:'listing_b', 1) returning storage_path as storage_path2 \gset
select tests.as_postgres();
insert into storage.objects (bucket_id, name, owner_id) values ('listing-photos', :'storage_path2', :'b_id');

select tests.authenticate_as(:'a_id');
select is((select count(*)::int from storage.objects where bucket_id = 'listing-photos'), 0, 'A sieht Fotos eines fremden Entwurfs nicht');
select tests.as_anon();
select is((select count(*)::int from storage.objects where bucket_id = 'listing-photos'), 0, 'anon sieht Fotos eines Entwurfs nicht');

select tests.as_postgres();
update listings set status = 'active', expires_at = now() + interval '30 days' where id = :'listing_b';
select tests.as_anon();
select is((select count(*)::int from storage.objects
           where bucket_id = 'listing-photos' and (storage.foldername(name))[1] in (:'a_id', :'b_id')), 2,
  'anon sieht Bild und Thumbnail des verarbeiteten Fotos, nicht das unverarbeitete');
select is((select count(*)::int from listing_photos where listing_id = :'listing_b'), 1, 'anon sieht nur die verarbeitete Fotozeile');

select tests.authenticate_as(:'a_id');
delete from storage.objects where bucket_id = 'listing-photos';
select tests.as_postgres();
-- Nur Dateien der Testnutzer zählen: Reste aus E2E-Läufen ohne Reset dürfen das Ergebnis nicht ändern (QA M3 F4).
select is((select count(*)::int from storage.objects
           where bucket_id = 'listing-photos' and (storage.foldername(name))[1] in (:'a_id', :'b_id')), 3, 'A löscht keine Fotos von B');

-- Verwaiste Datei (Zeile gelöscht) ist nicht mehr lesbar, der Besitzer kann sie entfernen
select tests.authenticate_as(:'b_id');
delete from listing_photos where id = :'photo1';
select tests.as_anon();
select is((select count(*)::int from storage.objects where bucket_id = 'listing-photos'), 0, 'Verwaiste Datei ist öffentlich nicht lesbar');
select tests.authenticate_as(:'b_id');
delete from storage.objects where bucket_id = 'listing-photos' and name in (:'storage_path', :'thumb_path');
select tests.as_postgres();
select is((select count(*)::int from storage.objects where bucket_id = 'listing-photos' and name in (:'storage_path', :'thumb_path')), 0,
  'Besitzer entfernt die verwaisten Dateien');

-- Tageslimit für Fotos, auch nach Löschen (A9)
update private.app_settings set value = '2' where key = 'photo_create_daily_limit';
select tests.authenticate_as(:'b_id');
delete from listing_photos where listing_id = :'listing_b';
select throws_ok(format($$ insert into listing_photos (listing_id, sort_order) values (%L, 0) $$, :'listing_b'),
  'RV002', null, 'Drittes neues Foto in 24 h über dem Limit, obwohl die anderen gelöscht sind');

select * from finish();
rollback;
