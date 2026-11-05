begin;
\ir _helpers.psql
select plan(38);

-- M7 Schreibwege (ADR 017, Review B1, A1, A8, A9, A10): nur per RPC, feste Prüfreihenfolge, keine
-- Unterhaltung ohne Nachricht, Rate-Limits mit echten Werten, Textregeln, read_at, Zustand des Gegenübers, Orakel.

create function tests.chat_err(statement text) returns text language plpgsql as $$
declare h text; s text;
begin
  execute statement;
  return 'ok';
exception when others then
  get stacked diagnostics h = pg_exception_hint, s = returned_sqlstate;
  return s || coalesce(' ' || nullif(h, ''), '');
end;
$$;
grant execute on function tests.chat_err(text) to anon, authenticated;

-- Echte Grenzen (seed.sql hebt sie lokal an)
update private.app_settings set value = '10' where key = 'chat_new_conversations_daily';
update private.app_settings set value = '3' where key = 'chat_new_conversations_daily_new';
update private.app_settings set value = '30' where key = 'chat_messages_per_10min';
update private.app_settings set value = '15' where key = 'chat_messages_per_10min_new';
update private.app_settings set value = '5' where key = 'chat_unanswered_max';

select tests.create_user('c-owner@test.local') as o \gset
select tests.create_user('c-int@test.local') as i \gset
select tests.create_user('c-old@test.local') as old \gset
select tests.create_user('c-nolegal@test.local', null, false) as nl \gset
update auth.users set created_at = now() - interval '30 days' where id = :'old';
select id as district from regions where code = 'DE-09162' \gset
insert into listings (owner_id, kind, direction, title, content_language, region_id, status, expires_at)
select :'o', 'helper', 'wanted', 'Chat ' || n, 'de', :'district', 'active', now() + interval '30 days'
from generate_series(1, 12) n;
create temp table l as select id, row_number() over (order by title collate "C") as n from listings where owner_id = :'o';
grant select on l to authenticated;
select id as l1 from l where n = 1 \gset
select id as l2 from l where n = 2 \gset
insert into listings (owner_id, kind, direction, title, content_language, region_id, status, expires_at)
values (:'o', 'helper', 'wanted', 'Pausiert', 'de', :'district', 'paused', now() + interval '30 days') returning id as lp \gset

-- 1. Prüfreihenfolge und Fehlercodes
select tests.as_anon();
select is(tests.chat_err(format($$ select start_conversation(%L, 'x') $$, :'l1')), '42501', 'anon: kein Aufruf');
select tests.authenticate_as(:'nl');
select is(tests.chat_err(format($$ select start_conversation(%L, '') $$, :'l1')), 'RV001 Zustimmung zur aktuellen Version per legal_status() und accept_legal() einholen',
  'Ohne Zustimmung RV001, vor der Textprüfung');
select tests.authenticate_as(:'i');
select is(tests.chat_err(format($$ select start_conversation(%L, '   ') $$, :'l1')), '22023 body', 'Leerer Text nach dem Trimmen: 22023 body');
select is(tests.chat_err(format($$ select start_conversation(%L, %L) $$, :'l1', repeat('a', 2001))), '22023 body', '2001 Zeichen: 22023');
select is(tests.chat_err(format($$ select start_conversation(%L, %L) $$, :'l1', 'a' || chr(8238) || 'b')), '22023 body', 'Bidi-Steuerzeichen U+202E: 22023');
select is(tests.chat_err(format($$ select start_conversation(%L, %L) $$, :'l1', 'a' || chr(7) || 'b')), '22023 body', 'Steuerzeichen BEL: 22023');
select is(tests.chat_err(format($$ select start_conversation(%L, %L) $$, :'l1', 'a' || chr(133) || 'b')), '22023 body', 'C1-Zeichen NEL: 22023');
select is(tests.chat_err(format($$ select start_conversation(%L, %L) $$, :'lp', 'Hallo')), '42501', 'Nicht öffentliche Anzeige: 42501');
select is(tests.chat_err(format($$ select start_conversation(%L, %L) $$, gen_random_uuid(), 'Hallo')), '42501', 'Unbekannte Anzeige: gleiche Antwort 42501');
select tests.authenticate_as(:'o');
select is(tests.chat_err(format($$ select start_conversation(%L, 'Hallo') $$, :'l1')), '42501', 'Eigene Anzeige: 42501');

-- 2. Normalisierung, Idempotenz, keine Unterhaltung ohne Nachricht
select tests.authenticate_as(:'i');
select start_conversation(:'l1', E'  Zeile 1\r\nZeile 2\r  ') as c1 \gset
select is((select body from messages where conversation_id = :'c1'), E'Zeile 1\nZeile 2', 'Gespeichert: getrimmt, CRLF/CR → LF');
select is(start_conversation(:'l1', 'Noch eine Frage'), :'c1'::uuid, 'Zweiter Aufruf hängt an dieselbe Unterhaltung an');
select is(tests.chat_err(format($$ select start_conversation(%L, %L) $$, :'l1', E'Tab\tok')), 'ok', 'TAB ist erlaubt');
select is((select count(*)::int from conversations c where not exists (select 1 from messages m where m.conversation_id = c.id)), 0,
  'Keine Unterhaltung ohne Nachricht');

-- 3. Ohne Antwort höchstens 5
select is((select count(*)::int from messages where conversation_id = :'c1'), 3, 'Drei Nachrichten ohne Antwort');
select send_message(:'c1', 'vier');
select send_message(:'c1', 'fünf');
select is(tests.chat_err(format($$ select send_message(%L, 'sechs') $$, :'c1')), 'RV002 {"scope": "chat_unanswered", "retry_after": null}',
  'Sechste Nachricht ohne Antwort: RV002 chat_unanswered');
select tests.authenticate_as(:'o');
select send_message(:'c1', 'Antwort');
select tests.authenticate_as(:'i');
select is(tests.chat_err(format($$ select send_message(%L, 'sechs') $$, :'c1')), 'ok', 'Nach einer Antwort geht es weiter');

-- 4. Neue Unterhaltungen: neues Konto 3 je 24 h
select start_conversation(:'l2', 'Hallo zwei');
select start_conversation(id, 'Hallo drei') from l where n = 3;
select ok(tests.chat_err(format($$ select start_conversation(%L, 'Hallo vier') $$, (select id from l where n = 4))) like 'RV002 {"scope": "chat_conversations", "retry_after": "20%Z"}',
  'Vierte neue Unterhaltung eines neuen Kontos: RV002 chat_conversations mit retry_after');
select is(tests.chat_err(format($$ select send_message(%L, 'bestehende geht') $$, :'c1')), 'ok', 'Bestehende Unterhaltung bleibt beschreibbar');
-- Älteres Konto: 10 je 24 h
select tests.authenticate_as(:'old');
select start_conversation(id, 'Hallo ' || n) from l where n <= 10;
select ok(tests.chat_err(format($$ select start_conversation(%L, 'elf') $$, (select id from l where n = 11))) like 'RV002 {"scope": "chat_conversations"%',
  'Elfte neue Unterhaltung eines älteren Kontos: RV002');

-- 5. Nachrichten je 10 min: neues Konto 15 (c1 zählt bisher 7 von i, plus 3 Startnachrichten in l2/l3 = 9... gezählt wird alles)
select tests.as_postgres();
update private.app_settings set value = '1000' where key = 'chat_unanswered_max';
select tests.authenticate_as(:'i');
select count(*) as sent_i from messages where sender_id = :'i' \gset
select send_message(:'c1', 'm' || n) from generate_series(1, 15 - :'sent_i'::int) n;
select ok(tests.chat_err(format($$ select send_message(%L, 'zu viel') $$, :'c1')) like 'RV002 {"scope": "chat_messages", "retry_after": "20%Z"}',
  '16. Nachricht in 10 min (neues Konto): RV002 chat_messages');
select tests.as_postgres();
alter table messages disable trigger messages_guard_update;
update messages set created_at = created_at - interval '11 minutes' where sender_id = :'i';
alter table messages enable trigger messages_guard_update;
select tests.authenticate_as(:'i');
select is(tests.chat_err(format($$ select send_message(%L, 'wieder erlaubt') $$, :'c1')), 'ok', 'Nach 10 Minuten wieder erlaubt');

-- 6. read_at und recipient_id
select tests.authenticate_as(:'o');
select is(mark_conversation_read(:'c1') > 0, true, 'Empfänger markiert gelesen');
select tests.as_postgres();
select ok((select bool_and(read_at = r) from (select read_at, max(read_at) over () r from messages where conversation_id = :'c1' and recipient_id = :'o') x),
  'read_at ist der Zeitpunkt des Aufrufs');
select is(tests.chat_err(format($$ update messages set read_at = now() - interval '1 day' where conversation_id = %L and read_at is not null $$, :'c1')),
  '42501', 'read_at auch für den Server unveränderlich');
select is(tests.chat_err(format($$ update messages set recipient_id = %L where conversation_id = %L $$, :'old', :'c1')), '42501', 'recipient_id unveränderlich');
select is(tests.chat_err(format($$ insert into messages (conversation_id, sender_id, body) values (%L, %L, 'fremd') $$, :'c1', :'old')), '42501',
  'Server: Absender muss Teilnehmer sein');

-- 7. Zustand des Gegenübers (A10) und gesperrte Konten
update profiles set is_blocked = true where user_id = :'o';
select tests.authenticate_as(:'i');
select is(tests.chat_err(format($$ select send_message(%L, 'Hallo?') $$, :'c1')), '42501', 'Gegenüber gesperrt: Schreiben nicht möglich');
select is(mark_conversation_read(:'c1') >= 0, true, 'Lesen und Markieren bleibt möglich');
select tests.as_postgres();
update profiles set is_blocked = false, deleted_at = now() where user_id = :'o';
select tests.authenticate_as(:'i');
select is(tests.chat_err(format($$ select send_message(%L, 'Hallo?') $$, :'c1')), '42501', 'Gegenüber gelöscht: Schreiben nicht möglich');
select tests.as_postgres();
update profiles set deleted_at = null where user_id = :'o';
update profiles set is_blocked = true where user_id = :'i';
select tests.authenticate_as(:'i');
select is(tests.chat_err(format($$ select send_message(%L, 'Hallo?') $$, :'c1')), '42501', 'Selbst gesperrt: Schreiben nicht möglich');
select tests.as_postgres();
update profiles set is_blocked = false where user_id = :'i';

-- 8. Bestehende Unterhaltung zu nicht mehr öffentlicher Anzeige bleibt beschreibbar
update listings set status = 'paused' where id = :'l1';
select tests.authenticate_as(:'i');
select is(tests.chat_err(format($$ select send_message(%L, 'Noch Interesse') $$, :'c1')), 'ok', 'Pausierte Anzeige: bestehende Unterhaltung beschreibbar');
select is(tests.chat_err(format($$ select start_conversation(%L, 'Noch Interesse') $$, :'l1')), 'ok', 'start_conversation zur bestehenden Unterhaltung auch');

-- 9. Orakel: fremde und unbekannte Unterhaltung gleich
select tests.as_postgres();
select tests.create_user('c-fremd@test.local') as f \gset
select tests.authenticate_as(:'f');
select is(tests.chat_err(format($$ select send_message(%L, 'x') $$, :'c1')), tests.chat_err(format($$ select send_message(%L, 'x') $$, gen_random_uuid())),
  'send_message: fremd = unbekannt');
select is(tests.chat_err(format($$ select mark_conversation_read(%L) $$, :'c1')), tests.chat_err(format($$ select mark_conversation_read(%L) $$, gen_random_uuid())),
  'mark_conversation_read: fremd = unbekannt');
select is(tests.chat_err(format($$ select send_message(%L, '') $$, :'c1')), '22023 body', 'Textprüfung vor der Teilnahme (kein Orakel, gleiche Antwort für alle IDs)');

-- 10. Keine direkten Rechte
select tests.authenticate_as(:'i');
select ok(tests.chat_err(format($$ update messages set read_at = now() where conversation_id = %L $$, :'c1')) like '42501%', 'Kein direktes UPDATE');
select is(tests.chat_err($$ select private.chat_check_rate(auth.uid(), 'chat_messages') $$), '42501', 'Hilfsfunktionen nicht aufrufbar');

select * from finish();
rollback;
