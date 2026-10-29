begin;
\ir _helpers.psql
select plan(23);

select tests.create_user('owner@test.local') as o_id \gset
select tests.create_user('a@test.local') as a_id \gset
select tests.create_user('b@test.local') as b_id \gset
select tests.create_user('admin@test.local') as admin_id \gset
select tests.make_admin(:'admin_id');
select id as district from regions where code = 'DE-09162' \gset

select tests.as_postgres();
insert into listings (owner_id, kind, direction, title, content_language, region_id, status, expires_at)
values (:'o_id', 'permit', 'offer', 'Begehungsschein', 'de', :'district', 'active', now() + interval '30 days') returning id as listing \gset
insert into listings (owner_id, kind, direction, title, content_language, region_id)
values (:'o_id', 'lease', 'offer', 'Entwurf', 'de', :'district') returning id as draft \gset

-- Unterhaltung starten
select tests.authenticate_as(:'a_id');
insert into conversations (listing_id) values (:'listing') returning id as conv \gset
select is((select owner_id from conversations where id = :'conv'), :'o_id'::uuid, 'owner_id kommt aus der Anzeige');
select throws_ok(format($$ insert into conversations (listing_id) values (%L) $$, :'draft'), '42501', null, 'Kein Kontakt zu Entwürfen');
select throws_ok(format($$ insert into conversations (listing_id, owner_id) values (%L, %L) $$, :'listing', :'b_id'), '42501', null,
  'owner_id ist nicht frei wählbar (Spalte nicht freigegeben)');

insert into messages (conversation_id, body) values (:'conv', 'Ist der Begehungsschein noch frei?') returning id as msg_a \gset
select ok((select last_message_at is not null from conversations where id = :'conv'), 'Neue Nachricht aktualisiert last_message_at');
select throws_ok(format($$ insert into messages (conversation_id, sender_id, body) values (%L, %L, 'gefälscht') $$, :'conv', :'o_id'), '42501', null,
  'Absender ist nicht frei wählbar');

-- Akzeptanzkriterium M1: Fremde lesen keine Nachrichten
select tests.authenticate_as(:'b_id');
select is((select count(*)::int from messages), 0, 'B liest die Nachrichten von A und dem Anbieter nicht');
select is((select count(*)::int from conversations), 0, 'B sieht die Unterhaltung nicht');
select throws_ok(format($$ insert into messages (conversation_id, body) values (%L, 'Ich mische mich ein') $$, :'conv'), '42501', null,
  'B schreibt nicht in fremde Unterhaltungen');

select tests.authenticate_as(:'admin_id', 'aal2');
select is((select count(*)::int from messages), 0, 'Auch Admins lesen Chats nicht pauschal');

select tests.as_anon();
select throws_ok($$ select * from messages $$, '42501', null, 'anon liest keine Nachrichten');

-- Gelesen markieren
select tests.authenticate_as(:'o_id');
select is((select count(*)::int from messages where conversation_id = :'conv'), 1, 'Anbieter liest die Nachricht');
update messages set read_at = now() where id = :'msg_a';
select ok((select read_at is not null from messages where id = :'msg_a'), 'Empfänger markiert als gelesen');
select throws_ok(format($$ update messages set body = 'verändert' where id = %L $$, :'msg_a'), '42501', null, 'Niemand ändert den Text');

insert into messages (conversation_id, body) values (:'conv', 'Ja, noch frei.') returning id as msg_o \gset
update messages set read_at = now() where id = :'msg_o';
select tests.as_postgres();
select is((select read_at from messages where id = :'msg_o'), null, 'Absender markiert die eigene Nachricht nicht als gelesen');

-- Blockieren
select tests.authenticate_as(:'o_id');
insert into blocks (blocked_id) values (:'a_id');
select throws_ok(format($$ insert into messages (conversation_id, body) values (%L, 'Hallo?') $$, :'conv'), '42501', null,
  'Wer blockiert, schreibt auch nicht mehr');
select tests.authenticate_as(:'a_id');
select throws_ok(format($$ insert into messages (conversation_id, body) values (%L, 'Hallo?') $$, :'conv'), '42501', null,
  'Blockierter Nutzer kann nicht mehr schreiben');
select is((select count(*)::int from blocks), 0, 'Blockierter sieht die Sperre nicht');
select is((select count(*)::int from messages where conversation_id = :'conv'), 2, 'Bisheriger Verlauf bleibt lesbar');

select tests.authenticate_as(:'b_id');
delete from blocks;
select tests.as_postgres();
select is((select count(*)::int from blocks), 1, 'B hebt fremde Sperren nicht auf');

-- Neue Unterhaltung bei bestehender Sperre
select tests.as_postgres();
insert into blocks (blocker_id, blocked_id) values (:'o_id', :'b_id');
select tests.authenticate_as(:'b_id');
select throws_ok(format($$ insert into conversations (listing_id) values (%L) $$, :'listing'), '42501', null,
  'Blockierter Nutzer startet keine neue Unterhaltung');

-- Kein Orakel für fremde Sperren (Review M1)
select tests.authenticate_as(:'b_id');
select throws_ok(format($$ select private.is_blocked_pair(%L, %L) $$, :'o_id', :'a_id'), '42501', null,
  'Fremde Sperrbeziehungen sind nicht abfragbar');
select ok(private.is_blocked_with(:'o_id'), 'Eigene Sperrbeziehung ist für die Policy prüfbar');

-- Löschen einer Anzeige entfernt Unterhaltungen
select tests.as_postgres();
delete from listings where id = :'listing';
select is((select count(*)::int from messages), 0, 'Gelöschte Anzeige entfernt Unterhaltungen und Nachrichten (cascade)');

select * from finish();
rollback;
