begin;
\ir _helpers.psql
select plan(17);

-- Datenbankseite der Fotoverarbeitung (ADR 011, Plan M3 Commit 5, Spike-Review Auflagen 1, 4, 7).
select tests.create_user('owner@test.local') as a_id \gset
select tests.create_user('fremd@test.local') as b_id \gset
select id as district from regions where code = 'DE-14612' \gset

select tests.authenticate_as(:'a_id');
insert into listings (kind, direction, title, content_language, region_id)
values ('lease', 'offer', 'Fotoverarbeitung', 'de', :'district') returning id as l \gset
insert into listing_photos (listing_id, sort_order) values (:'l', 0) returning id as p \gset
insert into listing_photos (listing_id, sort_order) values (:'l', 1) returning id as p2 \gset

-- Rechte
select tests.as_postgres();
select is((select allowed_mime_types from storage.buckets where id = 'listing-uploads'), array['image/jpeg'],
  'Eingang nimmt nur JPEG an (PNG gestrichen)');
select ok(not has_function_privilege('authenticated', 'public.claim_photo_processing(uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.claim_photo_processing(uuid, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.complete_photo_processing(uuid, integer, integer)', 'execute')
  and not has_function_privilege('anon', 'public.complete_photo_processing(uuid, integer, integer)', 'execute'),
  'RPCs der Verarbeitung sind für anon/authenticated nicht ausführbar');
select ok(not has_column_privilege('authenticated', 'public.listing_photos', 'processing_attempts', 'update')
  and not has_column_privilege('authenticated', 'public.listing_photos', 'processing_attempts', 'insert'),
  'Versuchszähler setzt nur der Server');

-- Als service_role, wie die Edge Function
select set_config('role', 'service_role', true);
select set_config('request.jwt.claims', '{"role": "service_role"}', true);

select is((select state from claim_photo_processing(:'p', :'b_id')), 'not_found', 'Fremder Nutzer: not_found');
select is((select state from claim_photo_processing(gen_random_uuid(), :'a_id')), 'not_found', 'Unbekanntes Foto: not_found');
select is((select state || '|' || upload_path from claim_photo_processing(:'p', :'a_id')),
  'claimed|' || :'a_id' || '/' || :'l' || '/' || :'p', 'Besitzer: Versuch beansprucht, Eingangspfad zurück');
select claim_photo_processing(:'p', :'a_id');
select claim_photo_processing(:'p', :'a_id');
select is((select processing_attempts::int from listing_photos where id = :'p'), 3, 'Drei Versuche gezählt');
select is((select state from claim_photo_processing(:'p', :'a_id')), 'exhausted', 'Vierter Versuch: exhausted');
select is((select processing_attempts::int from listing_photos where id = :'p'), 3, 'Erschöpft zählt nicht weiter');

-- Ergebnis eintragen
select is(complete_photo_processing(:'p2', 2048, 1365), 'processed', 'Ergebnis eingetragen');
select is((select width || 'x' || height from listing_photos where id = :'p2' and processed_at is not null), '2048x1365',
  'processed_at, Breite und Höhe gesetzt');
select is(complete_photo_processing(:'p2', 2048, 1365), 'already', 'Zweiter Lauf: already');
select is((select state from claim_photo_processing(:'p2', :'a_id')), 'processed', 'Verarbeitetes Foto: kein neuer Versuch');

-- Freigegebene Anzeige geht zurück in die Prüfung
reset role;
select tests.as_postgres();
update listings set status = 'active', expires_at = now() + interval '30 days' where id = :'l';
insert into listing_photos (listing_id, sort_order) values (:'l', 2) returning id as p3 \gset
update listings set status = 'active' where id = :'l';
select set_config('role', 'service_role', true);
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
select complete_photo_processing(:'p3', 100, 100);
select is((select status::text from listings where id = :'l'), 'pending_review', 'Neues Foto an aktiver Anzeige → pending_review');

-- Gelöschtes Foto
delete from listing_photos where id = :'p3';
select is(complete_photo_processing(:'p3', 100, 100), 'gone', 'Gelöschtes Foto: gone');

-- Gesperrtes Konto und entfernte Anzeige: not_found
reset role;
select tests.as_postgres();
insert into listing_photos (listing_id, sort_order) values (:'l', 3) returning id as p4 \gset
update profiles set is_blocked = true where user_id = :'a_id';
select set_config('role', 'service_role', true);
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
select is((select state from claim_photo_processing(:'p4', :'a_id')), 'not_found', 'Gesperrtes Konto: not_found');
reset role;
select tests.as_postgres();
update profiles set is_blocked = false where user_id = :'a_id';
update listings set status = 'removed', reject_code = 'other', reject_reason = 'Test' where id = :'l';
select set_config('role', 'service_role', true);
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
select is((select state from claim_photo_processing(:'p4', :'a_id')), 'not_found', 'Entfernte Anzeige: not_found');

reset role;
select * from finish();
rollback;
