begin;
\ir _helpers.psql
select plan(42);

select tests.create_user('a@test.local', 'Anna') as a_id \gset
select tests.create_user('b@test.local', 'Bernd') as b_id \gset
select tests.create_user('admin@test.local') as admin_id \gset
select tests.make_admin(:'admin_id');
select id as district from regions where code = 'DE-09184' \gset
select id as state from regions where code = 'DE-BY' \gset

-- Anlegen ------------------------------------------------------------------
select tests.authenticate_as(:'a_id');
insert into listings (kind, direction, title, content_language, region_id)
values ('lease', 'offer', 'Entwurf von A', 'de', :'district') returning id as draft_a \gset

select is((select country::text from listings where id = :'draft_a'), 'DE', 'Land wird aus der Region abgeleitet');
select is((select owner_id from listings where id = :'draft_a'), :'a_id'::uuid, 'owner_id ist der angemeldete Nutzer');

select throws_ok(format($$ insert into listings (kind, direction, title, content_language, region_id, status)
  values ('lease', 'offer', 'Sofort aktiv', 'de', %L, 'active') $$, :'district'), '42501', null, 'Neue Anzeige kann nicht direkt aktiv sein');
select throws_ok(format($$ insert into listings (kind, direction, title, content_language, region_id)
  values ('lease', 'offer', 'Bundesland', 'de', %L) $$, :'state'), '23514', null, 'Region auf Länderebene wird abgelehnt');
select throws_ok(format($$ insert into listings (owner_id, kind, direction, title, content_language, region_id)
  values (%L, 'lease', 'offer', 'Fremd', 'de', %L) $$, :'b_id', :'district'), '42501', null, 'Anzeige für ein fremdes Konto geht nicht');
select throws_ok(format($$ insert into listings (kind, direction, title, content_language, region_id, attributes)
  values ('lease', 'offer', 'Koordinaten', 'de', %L, '{"lat": 48.1, "lng": 11.5}') $$, :'district'), '23514', null, 'Koordinaten in attributes werden abgelehnt');
select throws_ok(format($$ insert into listings (kind, direction, title, content_language, region_id, price_minor)
  values ('lease', 'offer', 'Preis ohne Währung', 'de', %L, 100000) $$, :'district'), '23514', null, 'Preis ohne Währung/Einheit wird abgelehnt');

-- Lesen: Akzeptanzkriterium M1 (Entwürfe) -------------------------------------
select tests.authenticate_as(:'b_id');
select is((select count(*)::int from listings where id = :'draft_a'), 0, 'B liest den Entwurf von A nicht');
update listings set title = 'gehackt' where id = :'draft_a';
select tests.as_postgres();
select is((select title from listings where id = :'draft_a'), 'Entwurf von A', 'B ändert die Anzeige von A nicht');
select tests.authenticate_as(:'b_id');
delete from listings where id = :'draft_a';
select tests.as_postgres();
select is((select count(*)::int from listings where id = :'draft_a'), 1, 'B löscht die Anzeige von A nicht');

select tests.as_anon();
select is((select count(*)::int from listings), 0, 'anon sieht keine Entwürfe');

-- Statuswechsel --------------------------------------------------------------
select tests.authenticate_as(:'a_id');
select throws_ok(format($$ update listings set status = 'active' where id = %L $$, :'draft_a'), '42501', null, 'Besitzer schaltet nicht selbst frei');
update listings set status = 'pending_review' where id = :'draft_a';
select is((select status::text from listings where id = :'draft_a'), 'pending_review', 'Besitzer reicht zur Prüfung ein');
select throws_ok(format($$ update listings set expires_at = now() + interval '1 year' where id = %L $$, :'draft_a'), '42501', null, 'Besitzer setzt expires_at nicht');
select throws_ok(format($$ update listings set reject_reason = 'passt schon' where id = %L $$, :'draft_a'), '42501', null, 'Besitzer setzt reject_reason nicht');

select tests.authenticate_as(:'admin_id', 'aal1');
update listings set status = 'active' where id = :'draft_a';
select tests.as_postgres();
select is((select status::text from listings where id = :'draft_a'), 'pending_review', 'Admin ohne 2FA schaltet nicht frei (Zeile für ihn nicht änderbar)');

select tests.authenticate_as(:'admin_id', 'aal2');
select throws_ok(format($$ update listings set status = 'rejected' where id = %L $$, :'draft_a'), '23514', null, 'Ablehnen ohne Grund geht nicht');
update listings set status = 'active' where id = :'draft_a';
select ok((select expires_at between now() + interval '59 days' and now() + interval '61 days' from listings where id = :'draft_a'), 'Freigabe setzt expires_at auf 60 Tage');

select tests.as_anon();
select is((select count(*)::int from listings where id = :'draft_a'), 1, 'anon sieht die freigegebene Anzeige');

select tests.authenticate_as(:'a_id');
update listings set status = 'paused' where id = :'draft_a';
select tests.as_anon();
select is((select count(*)::int from listings where id = :'draft_a'), 0, 'Pausierte Anzeige ist nicht öffentlich');
select tests.authenticate_as(:'a_id');
update listings set status = 'active' where id = :'draft_a';
select is((select status::text from listings where id = :'draft_a'), 'active', 'Besitzer setzt eine pausierte Anzeige selbst fort');

update listings set title = 'Umgeschrieben nach Freigabe' where id = :'draft_a';
select is((select status::text from listings where id = :'draft_a'), 'pending_review', 'Inhaltsänderung an aktiver Anzeige führt zurück in die Prüfung');

select tests.authenticate_as(:'admin_id', 'aal2');
update listings set status = 'rejected', reject_reason = 'Bitte Pachtdauer angeben' where id = :'draft_a';
select tests.authenticate_as(:'a_id');
select is((select reject_reason from listings where id = :'draft_a'), 'Bitte Pachtdauer angeben', 'Besitzer sieht den Ablehnungsgrund');
update listings set status = 'pending_review' where id = :'draft_a';
select is((select reject_reason from listings where id = :'draft_a'), null, 'Erneutes Einreichen leert den Ablehnungsgrund');

-- Abgelaufene Anzeigen, gesperrte Besitzer --------------------------------------
select tests.authenticate_as(:'admin_id', 'aal2');
update listings set status = 'active' where id = :'draft_a';
select tests.as_postgres();
update listings set expires_at = now() - interval '1 day' where id = :'draft_a';
select tests.as_anon();
select is((select count(*)::int from listings where id = :'draft_a'), 0, 'Abgelaufene Anzeige ist nicht öffentlich');
select tests.as_postgres();
update listings set status = 'paused' where id = :'draft_a';
select tests.authenticate_as(:'a_id');
select throws_ok(format($$ update listings set status = 'active' where id = %L $$, :'draft_a'), '42501', null, 'Abgelaufene Anzeige lässt sich nicht ohne Prüfung fortsetzen');

select tests.as_postgres();
update listings set status = 'active', expires_at = now() + interval '10 days' where id = :'draft_a';
update profiles set is_blocked = true where user_id = :'a_id';
select tests.as_anon();
select is((select count(*)::int from listings where id = :'draft_a'), 0, 'Anzeigen gesperrter Nutzer sind nicht öffentlich');
select tests.authenticate_as(:'a_id');
select throws_ok(format($$ insert into listings (kind, direction, title, content_language, region_id)
  values ('lease', 'offer', 'Gesperrt', 'de', %L) $$, :'district'), '42501', null, 'Gesperrte Nutzer legen keine Anzeigen an');
select tests.as_postgres();
update profiles set is_blocked = false where user_id = :'a_id';

-- Entfernen durch die Moderation -------------------------------------------------
select tests.authenticate_as(:'admin_id', 'aal2');
update listings set status = 'removed', reject_reason = 'Betrugsverdacht' where id = :'draft_a';
select tests.authenticate_as(:'a_id');
select throws_ok(format($$ update listings set title = 'Neuer Versuch' where id = %L $$, :'draft_a'), '42501', null, 'Entfernte Anzeige ist für den Besitzer gesperrt');
delete from listings where id = :'draft_a';
select tests.as_postgres();
select is((select count(*)::int from listings where id = :'draft_a'), 1, 'Entfernte Anzeige kann der Besitzer nicht löschen (DSA)');

-- Vier-Augen-Prinzip und Löschen durch gesperrte Nutzer (Review M1)
select tests.authenticate_as(:'admin_id', 'aal2');
insert into listings (kind, direction, title, content_language, region_id, status)
values ('lease', 'offer', 'Anzeige des Admins', 'de', :'district', 'pending_review') returning id as own_admin \gset
select throws_ok(format($$ update listings set status = 'active' where id = %L $$, :'own_admin'), '42501', null,
  'Admin gibt die eigene Anzeige nicht frei');
select tests.as_postgres();
update profiles set is_blocked = true where user_id = :'b_id';
insert into listings (owner_id, kind, direction, title, content_language, region_id)
values (:'b_id', 'lease', 'offer', 'Beweis', 'de', :'district') returning id as evidence \gset
select tests.authenticate_as(:'b_id');
delete from listings where id = :'evidence';
select tests.as_postgres();
select is((select count(*)::int from listings where id = :'evidence'), 1, 'Gesperrte Nutzer löschen keine Anzeigen (Beweise bleiben)');
delete from listings where id = :'evidence';
update profiles set is_blocked = false where user_id = :'b_id';

-- Standortverfremdung (ADR 006) ---------------------------------------------------
select tests.authenticate_as(:'b_id');
insert into listings (kind, direction, title, content_language, region_id, display_location)
values ('permit', 'offer', 'Mit Standort', 'de', :'district', 'SRID=4326;POINT(11.5 48.0)') returning id as loc \gset
select ok((select extensions.st_distance(display_location, 'SRID=4326;POINT(11.5 48.0)'::extensions.geography) between 2990 and 5010
  from listings where id = :'loc'), 'Gespeicherter Punkt liegt 3–5 km vom eingegebenen entfernt');
select display_location::text as first_blur from listings where id = :'loc' \gset
update listings set display_location = 'SRID=4326;POINT(11.6 48.1)' where id = :'loc';
update listings set display_location = 'SRID=4326;POINT(11.5 48.0)' where id = :'loc';
select is((select display_location::text from listings where id = :'loc'), :'first_blur',
  'Gleicher Eingabepunkt ergibt immer denselben Punkt (kein Herausmitteln möglich)');
select tests.as_postgres();
select is((select count(*)::int from listings where display_location = 'SRID=4326;POINT(11.5 48.0)'::extensions.geography), 0,
  'Der Originalpunkt wird nirgends gespeichert');

-- Fotos und Wildarten --------------------------------------------------------------
select tests.authenticate_as(:'b_id');
insert into listing_photos (listing_id, storage_path, sort_order)
select :'loc', :'b_id' || '/' || :'loc' || '/foto' || n || '.jpg', n from generate_series(0, 7) n;
select is((select count(*)::int from listing_photos where listing_id = :'loc'), 8, 'Besitzer lädt 8 Fotos hoch');
select throws_ok(format($$ insert into listing_photos (listing_id, storage_path, sort_order) values (%L, %L, 7) $$,
  :'loc', :'b_id' || '/' || :'loc' || '/neunt.jpg'), '23514', null, 'Ein neuntes Foto wird abgelehnt');
insert into listing_species (listing_id, species_code) values (:'loc', 'roe_deer');

select tests.authenticate_as(:'a_id');
select throws_ok(format($$ insert into listing_species (listing_id, species_code) values (%L, 'wild_boar') $$, :'loc'),
  '42501', null, 'A ändert keine Wildarten an der Anzeige von B');
select is((select count(*)::int from listing_photos where listing_id = :'loc'), 0, 'A sieht die Fotos des Entwurfs von B nicht');

select tests.authenticate_as(:'b_id');
update listings set status = 'pending_review' where id = :'loc';
select tests.authenticate_as(:'admin_id', 'aal2');
update listings set status = 'active' where id = :'loc';
select tests.as_anon();
select is((select count(*)::int from listing_photos where listing_id = :'loc'), 8, 'anon sieht die Fotos der aktiven Anzeige');
select tests.authenticate_as(:'b_id');
delete from listing_photos where listing_id = :'loc' and sort_order = 7;
select is((select status::text from listings where id = :'loc'), 'pending_review', 'Fotoänderung an aktiver Anzeige führt zurück in die Prüfung');

-- Volltextsuche -------------------------------------------------------------------
select tests.as_postgres();
update listings set title = 'Gesellschaftsjagden auf Schwarzwild', description = 'Wir suchen Jäger' where id = :'loc';
select ok((select search_vector @@ websearch_to_tsquery('german', 'Gesellschaftsjagd') from listings where id = :'loc'),
  'Deutsche Suche findet Wortformen (Stemming)');

select * from finish();
rollback;
