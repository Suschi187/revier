begin;
\ir _helpers.psql
select plan(20);

-- M4 Commit 2 (ADR 014): Grund-Code, Einreichzeitpunkt, Moderation nur mit Flag, Moderatoren ändern keine
-- Inhalte, is_admin nur für aktive Konten. Die RPC moderate_listing folgt in 22_moderate_listing.
set constraints all immediate;

select tests.create_user('owner@test.local') as owner_id \gset
select tests.create_user('mod@test.local') as mod_id \gset
select tests.make_admin(:'mod_id');
select id as dd from regions where code = 'DE-14612' \gset

select tests.authenticate_as(:'owner_id');
insert into listings (kind, direction, title, content_language, region_id)
values ('helper', 'wanted', 'Moderation Felder', 'de', :'dd') returning id as l \gset
select tests.as_postgres();
select tests.make_ready(:'l');

-- Einreichen setzt submitted_at
select tests.authenticate_as(:'owner_id');
update listings set status = 'pending_review' where id = :'l';
select isnt((select submitted_at from listings where id = :'l'), null, 'Einreichen setzt submitted_at');
select throws_ok(format($$ update listings set reject_code = 'other' where id = %L $$, :'l'), '42501', null,
  'Besitzer setzt keinen Grund-Code');

-- Ohne Flag kein Roh-UPDATE durch Admins (A4)
select tests.authenticate_as(:'mod_id', 'aal2');
select set_config('revier.moderation', '', true);
select throws_ok(format($$ update listings set status = 'active' where id = %L $$, :'l'), '42501', null,
  'Roh-UPDATE ohne Moderations-Flag scheitert');
select set_config('revier.moderation', 'on', true);

-- Moderatoren ändern keine Inhalte (A5), weder an der Anzeige noch an Kindern
select throws_ok(format($$ update listings set title = 'Umgeschrieben' where id = %L $$, :'l'), '42501', null,
  'Moderator ändert keinen Titel');
select throws_ok(format($$ update listings set status = 'active', description = 'Andere Beschreibung mit mehr als dreißig Zeichen' where id = %L $$, :'l'),
  '42501', null, 'Moderator ändert beim Freigeben keine Inhalte');
select throws_ok(format($$ insert into listing_species (listing_id, species_code) values (%L, 'red_deer') $$, :'l'), '42501', null,
  'Moderator fügt keine Wildart hinzu');
update listing_places set place_name = 'Woanders' where listing_id = :'l';
select is((select place_name from listing_places where listing_id = :'l'), 'Testort', 'Moderator ändert keinen Ort (RLS)');

-- Zurückgeben braucht einen Code, der Freitext ist optional; Audit erkennt es am Code (A6)
select throws_ok(format($$ update listings set status = 'draft', reject_reason = 'Nur Text' where id = %L $$, :'l'), '23514', null,
  'Zurückgeben ohne Code scheitert');
update listings set status = 'draft', reject_code = 'incomplete' where id = :'l';
select is((select reject_code from listings where id = :'l'), 'incomplete', 'Zurückgegebener Entwurf behält den Code');
select tests.as_postgres();
select is((select details from audit_log where target_id = :'l' and action = 'listing.draft'),
  jsonb_build_object('from', 'pending_review', 'code', 'incomplete', 'reason', null), 'Audit mit Code, ohne Freitext');

-- Erneutes Einreichen leert den Grund und setzt submitted_at neu
-- now() steht in der Testtransaktion still; den alten Zeitpunkt deshalb am Trigger vorbei zurückdatieren.
alter table listings disable trigger listings_zz_moderation_fields;
update listings set submitted_at = now() - interval '2 days' where id = :'l';
alter table listings enable trigger listings_zz_moderation_fields;
select tests.authenticate_as(:'owner_id');
update listings set status = 'pending_review' where id = :'l';
select tests.as_postgres();
select is((select (reject_code, reject_reason)::text from listings where id = :'l'), '(,)', 'Erneutes Einreichen leert Code und Freitext');
select is((select submitted_at from listings where id = :'l'), now(), 'submitted_at ist der letzte Einreichzeitpunkt');

-- Constraints fangen vergessene Pfade (auch Server)
select throws_ok(format($$ update listings set status = 'rejected', reject_reason = 'ohne Code' where id = %L $$, :'l'), '23514', null,
  'Freitext ohne Code verletzt den Check');
select throws_ok(format($$ update listings set status = 'rejected', reject_code = 'other' where id = %L $$, :'l'), '23514', null,
  '„anderer Grund“ ohne Freitext verletzt den Check');
select is((select status from listings where id = :'l'), 'pending_review'::listing_status, 'Status unverändert nach den Fehlversuchen');
update listings set status = 'active', expires_at = now() + interval '30 days' where id = :'l';
select is((select (reject_code, submitted_at is not null)::text from listings where id = :'l'), '(,t)',
  'Freigabe leert den Code (Trigger auch auf dem Server-Pfad), submitted_at bleibt');

-- Hash ohne Verwaltungsspalten (A6)
select private.listing_content_hash(:'l') as h1 \gset
alter table listings disable trigger listings_zz_moderation_fields;
alter table listings drop constraint listings_reject_code_status;
update listings set submitted_at = now() - interval '1 day', reject_code = 'duplicate' where id = :'l';
select is(private.listing_content_hash(:'l'), :'h1'::bytea, 'submitted_at und reject_code ändern den Inhalts-Hash nicht');
-- Gegenprobe: Inhaltsspalten ändern ihn
update listings set title = 'Anderer Titel' where id = :'l';
select isnt(private.listing_content_hash(:'l'), :'h1'::bytea, 'Gegenprobe: der Titel ändert den Hash');
alter table listings enable trigger listings_zz_moderation_fields;

-- Gesperrte Admins haben keine Rechte (A11)
select tests.authenticate_as(:'mod_id', 'aal2');
select ok(private.is_admin(), 'Aktiver Admin mit aal2');
select tests.as_postgres();
update profiles set is_blocked = true where user_id = :'mod_id';
select tests.authenticate_as(:'mod_id', 'aal2');
select ok(not private.is_admin(), 'Gesperrter Admin ist kein Admin');

-- Kartenpunkt entfernen bleibt erlaubt (ADR 006), siehe 12_location
select * from finish();
rollback;
