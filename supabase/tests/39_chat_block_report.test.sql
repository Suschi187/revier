begin;
\ir _helpers.psql
select plan(18);

-- M7 Blockieren und Melden (ADR 017, Review A11, H7): nur aus der eigenen Unterhaltung, ohne Legal-Gate, auch für
-- gesperrte Konten; Melden nur fremder Nachrichten; private Kopie überdauert die Löschung des Absenders.

create function tests.chat_err3(statement text) returns text language plpgsql as $$
declare s text;
begin
  execute statement;
  return 'ok';
exception when others then
  get stacked diagnostics s = returned_sqlstate;
  return s;
end;
$$;
grant execute on function tests.chat_err3(text) to authenticated;

select tests.create_user('br-owner@test.local', 'Bea') as o \gset
select tests.create_user('br-int@test.local', 'Ilse') as i \gset
select tests.create_user('br-fremd@test.local') as f \gset
select id as district from regions where code = 'DE-09162' \gset
insert into listings (owner_id, kind, direction, title, content_language, region_id, status, expires_at)
values (:'o', 'helper', 'wanted', 'Sperren', 'de', :'district', 'active', now() + interval '30 days') returning id as l \gset
select tests.authenticate_as(:'i');
select start_conversation(:'l', 'Betrugsversuch: zahle vorab') as c \gset
select id as m_i from messages where conversation_id = :'c' \gset
select tests.authenticate_as(:'o');
select send_message(:'c', 'Antwort des Besitzers') as m_o \gset

-- 1. Blockieren nur aus der Unterhaltung
select is(tests.chat_err3(format($$ insert into blocks (blocked_id) values (%L) $$, :'i')), '42501', 'Kein direktes INSERT mehr (kein Orakel über den FK)');
select lives_ok(format($$ select block_in_conversation(%L) $$, :'c'), 'Besitzer blockiert aus der Unterhaltung');
select lives_ok(format($$ select block_in_conversation(%L) $$, :'c'), 'Zweimal blockieren ist harmlos');
select is((select count(*)::int from blocks where blocker_id = :'o' and blocked_id = :'i'), 1, 'Eine Sperre');
select is((select display_name from my_blocks()), 'Ilse', 'Liste mit Namen');
select tests.authenticate_as(:'f');
select is(tests.chat_err3(format($$ select block_in_conversation(%L) $$, :'c')), tests.chat_err3(format($$ select block_in_conversation(%L) $$, gen_random_uuid())),
  'Fremde Unterhaltung: gleicher Fehler wie unbekannt');
select tests.authenticate_as(:'o');
select lives_ok(format($$ select unblock_in_conversation(%L) $$, :'c'), 'Entsperren aus der Unterhaltung');
select is((select count(*)::int from my_blocks()), 0, 'Keine Sperre mehr');

-- 2. Ohne Zustimmung und als gesperrtes Konto weiter möglich
select tests.as_postgres();
delete from legal_acceptances where user_id = :'i';
update profiles set is_blocked = true where user_id = :'i';
select tests.authenticate_as(:'i');
select lives_ok(format($$ select block_in_conversation(%L) $$, :'c'), 'Gesperrtes Konto ohne Zustimmung blockiert');
select lives_ok(format($$ insert into reports (target_type, target_id, reason) values ('message', %L, 'harassment') $$, :'m_o'),
  'Gesperrtes Konto ohne Zustimmung meldet');
select tests.as_postgres();
update profiles set is_blocked = false where user_id = :'i';

-- 3. Melden nur fremder Nachrichten der eigenen Unterhaltung
select tests.authenticate_as(:'o');
select is(tests.chat_err3(format($$ insert into reports (target_type, target_id, reason) values ('message', %L, 'scam') $$, :'m_o')), '42501',
  'Eigene Nachricht nicht meldbar');
select lives_ok(format($$ insert into reports (target_type, target_id, reason, note) values ('message', %L, 'scam', 'Vorkasse') $$, :'m_i'),
  'Fremde Nachricht meldbar');
select tests.authenticate_as(:'f');
select is(tests.chat_err3(format($$ insert into reports (target_type, target_id, reason) values ('message', %L, 'scam') $$, :'m_i')), '42501',
  'Unbeteiligte melden keine Nachrichten');

-- 4. Kopie für die Moderation
select tests.as_postgres();
select is((select body from private.reported_message_snapshots s join reports r on r.id = s.report_id where r.target_id = :'m_i'),
  'Betrugsversuch: zahle vorab', 'Kopie der gemeldeten Nachricht');
select tests.authenticate_as(:'o');
select is(tests.chat_err3($$ select * from private.reported_message_snapshots $$), '42501', 'Kopie nicht über die API lesbar');
select tests.as_postgres();
delete from auth.users where id = :'i';
select is((select count(*)::int from messages where id = :'m_i'), 0, 'Absender gelöscht: Nachricht weg');
select is((select count(*)::int from private.reported_message_snapshots s join reports r on r.id = s.report_id where r.target_id = :'m_i'), 1,
  'Kopie bleibt nach der Kontolöschung des Absenders');
select is((select count(*)::int from reports where target_id = :'m_i'), 1, 'Meldung bleibt');

select * from finish();
rollback;
