begin;
\ir _helpers.psql
select plan(28);

-- Chat und Blockieren (M1, ab M7 nur per RPC, ADR 017). Weitere Fälle: 36_chat_write_paths.

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
select start_conversation(:'listing', 'Ist der Begehungsschein noch frei?') as conv \gset
select is((select owner_id from conversations where id = :'conv'), :'o_id'::uuid, 'owner_id kommt aus der Anzeige');
select throws_ok(format($$ select start_conversation(%L, 'Hallo') $$, :'draft'), '42501', null, 'Kein Kontakt zu Entwürfen');
select throws_ok(format($$ insert into conversations (listing_id) values (%L) $$, :'listing'), '42501', null,
  'Unterhaltungen nur per RPC (kein direktes INSERT)');
select ok((select last_message_at is not null from conversations where id = :'conv'), 'Neue Nachricht aktualisiert last_message_at');
select is((select sender_id::text || '>' || recipient_id::text from messages where conversation_id = :'conv'), :'a_id' || '>' || :'o_id',
  'Absender und Empfänger setzt der Server');
select throws_ok(format($$ insert into messages (conversation_id, body) values (%L, 'direkt') $$, :'conv'), '42501', null,
  'Nachrichten nur per RPC (kein direktes INSERT)');
select id as msg_a from messages where conversation_id = :'conv' \gset

-- Akzeptanzkriterium M1: Fremde lesen keine Nachrichten
select tests.authenticate_as(:'b_id');
select is((select count(*)::int from messages), 0, 'B liest die Nachrichten von A und dem Anbieter nicht');
select is((select count(*)::int from conversations), 0, 'B sieht die Unterhaltung nicht');
select throws_ok(format($$ select send_message(%L, 'Ich mische mich ein') $$, :'conv'), '42501', null,
  'B schreibt nicht in fremde Unterhaltungen');

select tests.authenticate_as(:'admin_id', 'aal2');
select is((select count(*)::int from messages), 0, 'Auch Admins lesen Chats nicht pauschal');

select tests.as_anon();
select throws_ok($$ select * from messages $$, '42501', null, 'anon liest keine Nachrichten');

-- Gelesen markieren
select tests.authenticate_as(:'o_id');
select is((select count(*)::int from messages where conversation_id = :'conv'), 1, 'Anbieter liest die Nachricht');
select is(mark_conversation_read(:'conv'), 1, 'Empfänger markiert als gelesen');
select throws_ok(format($$ update messages set read_at = null where id = %L $$, :'msg_a'), '42501', null, 'read_at nicht direkt änderbar');
select throws_ok(format($$ update messages set body = 'verändert' where id = %L $$, :'msg_a'), '42501', null, 'Niemand ändert den Text');

select send_message(:'conv', 'Ja, noch frei.') as msg_o \gset
select is(mark_conversation_read(:'conv'), 0, 'Absender markiert die eigene Nachricht nicht als gelesen');
select tests.as_postgres();
select is((select read_at from messages where id = :'msg_o'), null, 'Eigene Nachricht bleibt ungelesen');

-- Blockieren
select tests.authenticate_as(:'o_id');
insert into blocks (blocked_id) values (:'a_id');
select throws_ok(format($$ select send_message(%L, 'Hallo?') $$, :'conv'), '42501', null,
  'Wer blockiert, schreibt auch nicht mehr');
select tests.authenticate_as(:'a_id');
select throws_ok(format($$ select send_message(%L, 'Hallo?') $$, :'conv'), '42501', null,
  'Blockierter Nutzer kann nicht mehr schreiben');
select throws_ok(format($$ select start_conversation(%L, 'Hallo?') $$, :'listing'), '42501', null,
  'Blockierter Nutzer schreibt auch nicht über start_conversation');
select is((select count(*)::int from blocks), 0, 'Blockierter sieht die Sperre nicht');
select is((select count(*)::int from messages where conversation_id = :'conv'), 2, 'Bisheriger Verlauf bleibt lesbar');

select tests.authenticate_as(:'b_id');
delete from blocks;
select tests.as_postgres();
select is((select count(*)::int from blocks), 1, 'B hebt fremde Sperren nicht auf');

-- Neue Unterhaltung bei bestehender Sperre
insert into blocks (blocker_id, blocked_id) values (:'o_id', :'b_id');
select tests.authenticate_as(:'b_id');
select throws_ok(format($$ select start_conversation(%L, 'Hallo') $$, :'listing'), '42501', null,
  'Blockierter Nutzer startet keine neue Unterhaltung');

-- Kein Orakel für fremde Sperren (Review M1)
select throws_ok(format($$ select private.is_blocked_pair(%L, %L) $$, :'o_id', :'a_id'), '42501', null,
  'Fremde Sperrbeziehungen sind nicht abfragbar');
select ok(private.is_blocked_with(:'o_id'), 'Eigene Sperrbeziehung ist prüfbar');

-- Gelöschte Anzeige: Chats bleiben als Beweis erhalten (Entscheidung Review M1)
select tests.as_postgres();
delete from blocks;
select tests.authenticate_as(:'o_id');
delete from listings where id = :'listing';
select tests.as_postgres();
select results_eq(format($$ select listing_id is null, (select count(*)::int from messages m where m.conversation_id = c.id) from conversations c where id = %L $$, :'conv'),
  $$ values (true, 2) $$, 'Unterhaltung und Nachrichten bleiben, Verweis auf die Anzeige ist leer');
select tests.authenticate_as(:'a_id');
select is((select count(*)::int from messages where conversation_id = :'conv'), 2, 'Interessent behält den Verlauf');

select * from finish();
rollback;
