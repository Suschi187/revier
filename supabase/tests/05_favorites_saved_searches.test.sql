begin;
\ir _helpers.psql
select plan(13);

select tests.create_user('a@test.local') as a_id \gset
select tests.create_user('b@test.local') as b_id \gset
select id as district from regions where code = 'AT-321' \gset

select tests.as_postgres();
insert into listings (owner_id, kind, direction, title, content_language, region_id, status, expires_at)
values (:'b_id', 'driven_hunt', 'offer', 'Drückjagd im Tullnerfeld', 'de', :'district', 'active', now() + interval '30 days')
returning id as active_b \gset
insert into listings (owner_id, kind, direction, title, content_language, region_id)
values (:'b_id', 'lease', 'offer', 'Geheimer Entwurf', 'de', :'district') returning id as draft_b \gset

-- Favoriten
select tests.authenticate_as(:'a_id');
insert into favorites (listing_id) values (:'active_b');
select is((select count(*)::int from favorites), 1, 'A merkt sich eine aktive Anzeige');
select throws_ok(format($$ insert into favorites (listing_id) values (%L) $$, :'draft_b'), '42501', null,
  'A kann keinen fremden Entwurf merken (keine Existenzprüfung möglich)');
select throws_ok(format($$ insert into favorites (user_id, listing_id) values (%L, %L) $$, :'b_id', :'active_b'), '42501', null,
  'A legt keine Favoriten für B an');

select tests.authenticate_as(:'b_id');
select is((select count(*)::int from favorites), 0, 'B sieht die Favoriten von A nicht');
delete from favorites;
select tests.as_postgres();
select is((select count(*)::int from favorites), 1, 'B löscht die Favoriten von A nicht');

select tests.as_anon();
select throws_ok($$ select * from favorites $$, '42501', null, 'anon liest keine Favoriten');

-- Suchaufträge
select tests.authenticate_as(:'a_id');
insert into saved_searches (name, filters) values ('Pacht Bayern', '{"country": "DE", "kind": "lease"}');
select is((select count(*)::int from saved_searches), 1, 'A legt einen Suchauftrag an');
select throws_ok($$ update saved_searches set last_notified_at = now() $$, '42501', null, 'last_notified_at setzt nur der Server');
select throws_ok($$ insert into saved_searches (name, filters) values ('Liste', '[]') $$, '23514', null, 'filters muss ein Objekt sein');

select tests.authenticate_as(:'b_id');
select is((select count(*)::int from saved_searches), 0, 'B sieht die Suchaufträge von A nicht');
update saved_searches set name = 'gehackt';
select tests.as_postgres();
select is((select name from saved_searches where user_id = :'a_id'), 'Pacht Bayern', 'B ändert die Suchaufträge von A nicht');

select tests.authenticate_as(:'a_id');
insert into saved_searches (name) select 'Suche ' || n from generate_series(2, 25) n;
select throws_ok($$ insert into saved_searches (name) values ('Nummer 26') $$, '23514', null, 'Höchstens 25 Suchaufträge');

-- Löschen der Anzeige räumt Favoriten auf
select tests.as_postgres();
delete from listings where id = :'active_b';
select is((select count(*)::int from favorites), 0, 'Gelöschte Anzeige entfernt zugehörige Favoriten (cascade)');

select * from finish();
rollback;
