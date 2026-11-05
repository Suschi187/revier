begin;
\ir _helpers.psql
select plan(57);

-- QA M7 Abnahme (docs/QA-REPORT.md „M7 – Abnahme“): gezielte Angriffe auf die Chat-RPCs, Tabellen, realtime.messages,
-- Meldungen und die Auswahl der Benachrichtigung. Bekannte Fehler stehen als TODO (Fund-Nummer im Text).

create function tests.qa7_err(statement text) returns text language plpgsql as $$
declare s text; m text; h text;
begin
  execute statement;
  return 'ok';
exception when others then
  get stacked diagnostics s = returned_sqlstate, m = message_text, h = pg_exception_hint;
  return s || '|' || m || '|' || coalesce(h, '');
end;
$$;
grant execute on function tests.qa7_err(text) to anon, authenticated;

-- Echte Grenzen; die Rate-Limits stellt Abschnitt 3 eigens ein.
update private.app_settings set value = '10' where key = 'chat_new_conversations_daily';
update private.app_settings set value = '3' where key = 'chat_new_conversations_daily_new';
update private.app_settings set value = '30' where key = 'chat_messages_per_10min';
update private.app_settings set value = '15' where key = 'chat_messages_per_10min_new';
update private.app_settings set value = '5' where key = 'chat_unanswered_max';
update private.app_settings set value = '2' where key = 'chat_email_delay_minutes';
update private.app_settings set value = '15' where key = 'chat_email_min_interval_minutes';
select s.decrypted_secret as secret from vault.decrypted_secrets s where s.name = 'chat_notifications_secret' \gset
delete from private.chat_notifications;
insert into private.chat_notifications (conversation_id, recipient_id, channel, last_sent_at)
select distinct conversation_id, recipient_id, 'email', now() from messages where read_at is null;

select tests.create_user('q7-owner@test.local', 'Q7 Olaf') as o \gset
select tests.create_user('q7-int@test.local', 'Q7 Ina') as i \gset
select tests.create_user('q7-fremd@test.local', 'Q7 Fred') as f \gset
select tests.create_user('q7-gesperrt@test.local', 'Q7 Sepp', false) as s \gset
select tests.create_user('q7-melder@test.local', 'Q7 Mona') as r \gset
select id as district from regions where code = 'DE-09162' \gset
insert into listings (owner_id, kind, direction, title, content_language, region_id, status, expires_at, published_at) values
  (:'o', 'helper', 'wanted', 'Q7 Aktiv A', 'de', :'district', 'active', now() + interval '30 days', now()),
  (:'o', 'helper', 'wanted', 'Q7 Aktiv B', 'de', :'district', 'active', now() + interval '30 days', now()),
  (:'o', 'helper', 'wanted', 'Q7 Entwurf', 'de', :'district', 'draft', null, null);
select id as la from listings where title = 'Q7 Aktiv A' \gset
select id as lb from listings where title = 'Q7 Aktiv B' \gset
select id as ld from listings where title = 'Q7 Entwurf' \gset

select tests.authenticate_as(:'i');
select start_conversation(:'la', 'Q7 Erste Frage') as c1 \gset
select tests.authenticate_as(:'f');
select start_conversation(:'lb', 'Q7 Frage von Fred') as cf \gset
select tests.authenticate_as(:'r');
select start_conversation(:'la', 'Q7 Frage von Mona') as cr \gset
select tests.authenticate_as(:'o');
select send_message(:'cr', 'Q7 Antwort an Mona') as m_or \gset
select tests.as_postgres();

-- ---------------------------------------------------------------------------
-- 1. Eingaben und Prüfreihenfolge
-- ---------------------------------------------------------------------------
select tests.authenticate_as(:'i');
select is(split_part(tests.qa7_err(format($$ select start_conversation(%L, null) $$, :'lb')), '|', 1) || ' ' ||
          split_part(tests.qa7_err(format($$ select start_conversation(%L, null) $$, :'lb')), '|', 3), '22023 body', 'Text null: 22023 body');
select is(split_part(tests.qa7_err($$ select start_conversation(null, 'Hallo') $$), '|', 1), '42501', 'Anzeige null: 42501');
select is(split_part(tests.qa7_err(format($$ select send_message(%L, null) $$, :'c1')), '|', 1), '22023', 'send_message Text null: 22023');
-- Gesperrtes Konto ohne Zustimmung: „aktiv“ wird vor dem Legal-Gate geprüft
select tests.as_postgres();
update profiles set is_blocked = true where user_id = :'s';
select tests.authenticate_as(:'s');
select is(split_part(tests.qa7_err(format($$ select start_conversation(%L, 'Hallo') $$, :'la')), '|', 1), '42501', 'Gesperrt und ohne Zustimmung: 42501 vor RV001');
select is(tests.qa7_err(format($$ select mark_conversation_read(%L) $$, gen_random_uuid())), tests.qa7_err(format($$ select mark_conversation_read(%L) $$, :'c1')),
  'mark_conversation_read: fremd = unbekannt (gleicher Text)');
select tests.as_postgres();

-- ---------------------------------------------------------------------------
-- 2. Orakel: fremd = unbekannt, mit vollem Fehlertext
-- ---------------------------------------------------------------------------
select tests.authenticate_as(:'f');
select is(tests.qa7_err(format($$ select send_message(%L, 'x') $$, :'c1')), tests.qa7_err(format($$ select send_message(%L, 'x') $$, gen_random_uuid())),
  'send_message: fremd = unbekannt (Code, Text, Hint)');
select is(tests.qa7_err(format($$ select block_in_conversation(%L) $$, :'c1')), tests.qa7_err(format($$ select block_in_conversation(%L) $$, gen_random_uuid())),
  'block_in_conversation: fremd = unbekannt');
select is(tests.qa7_err(format($$ select unblock_in_conversation(%L) $$, :'c1')), tests.qa7_err(format($$ select unblock_in_conversation(%L) $$, gen_random_uuid())),
  'unblock_in_conversation: fremd = unbekannt');
select is(tests.qa7_err(format($$ select conversation_messages(%L) $$, :'c1')), tests.qa7_err(format($$ select conversation_messages(%L) $$, gen_random_uuid())),
  'conversation_messages: fremd = unbekannt');
select is(tests.qa7_err(format($$ select start_conversation(%L, 'x') $$, :'ld')), tests.qa7_err(format($$ select start_conversation(%L, 'x') $$, gen_random_uuid())),
  'start_conversation: Entwurf = unbekannte Anzeige');
select is((select count(*)::int from conversations where id = :'c1'), 0, 'Tabelle conversations: fremde Zeile unsichtbar');
select is((select count(*)::int from messages where conversation_id = :'c1'), 0, 'Tabelle messages: fremde Zeilen unsichtbar');
select is(conversation_info(:'c1'), null, 'conversation_info fremd: null');
select is((select count(*)::int from jsonb_array_elements(my_conversations() -> 'items') e where e ->> 'id' = :'c1'), 0, 'my_conversations ohne fremde');

-- ---------------------------------------------------------------------------
-- 3. Rate-Limit vor der Teilnahme: gleiche Antwort für fremd und unbekannt (kein Orakel über fremde Zähler)
-- ---------------------------------------------------------------------------
select tests.as_postgres();
update private.app_settings set value = '1' where key = 'chat_messages_per_10min_new';
select tests.authenticate_as(:'f');
select ok(tests.qa7_err(format($$ select send_message(%L, 'x') $$, :'c1')) like 'RV002|%chat_messages%', 'An der Grenze: RV002 auch für fremde Unterhaltungen');
select is(tests.qa7_err(format($$ select send_message(%L, 'x') $$, :'c1')), tests.qa7_err(format($$ select send_message(%L, 'x') $$, gen_random_uuid())),
  'RV002 fremd = unbekannt (gleiches retry_after)');
select tests.as_postgres();
update private.app_settings set value = '1000' where key = 'chat_messages_per_10min_new';
update private.app_settings set value = '1000' where key = 'chat_unanswered_max';

-- ---------------------------------------------------------------------------
-- 4. Direkte Schreibwege und read_at
-- ---------------------------------------------------------------------------
select tests.authenticate_as(:'i');
select is(split_part(tests.qa7_err(format($$ delete from messages where conversation_id = %L $$, :'c1')), '|', 1), '42501', 'Kein DELETE auf messages');
select is(split_part(tests.qa7_err(format($$ update conversations set listing_id = %L where id = %L $$, :'lb', :'c1')), '|', 1), '42501', 'Kein UPDATE auf conversations');
select is(split_part(tests.qa7_err(format($$ insert into conversations (listing_id, interested_id) values (%L, auth.uid()) $$, :'lb')), '|', 1), '42501',
  'Kein INSERT auf conversations');
select is(split_part(tests.qa7_err(format($$ insert into messages (conversation_id, sender_id, body) values (%L, auth.uid(), 'x') $$, :'c1')), '|', 1), '42501',
  'Kein INSERT auf messages');
select is(mark_conversation_read(:'c1'), 0, 'Absender markiert die eigenen Nachrichten nicht als gelesen');
select tests.as_postgres();
select is((select count(*)::int from messages where conversation_id = :'c1' and read_at is not null), 0, '… read_at der eigenen Nachrichten bleibt null');

-- ---------------------------------------------------------------------------
-- 5. Sperren: Entsperren nur durch den Blockierenden; Sperre nur im eigenen Chat erkennbar
-- ---------------------------------------------------------------------------
select tests.authenticate_as(:'o');
select block_in_conversation(:'c1');
select tests.authenticate_as(:'i');
select lives_ok(format($$ select unblock_in_conversation(%L) $$, :'c1'), 'Blockierte Person ruft unblock auf (kein Fehler) …');
select is(split_part(tests.qa7_err(format($$ delete from blocks where blocker_id = %L $$, :'o')), '|', 1), 'ok', '… und DELETE auf blocks (läuft ins Leere) …');
select tests.as_postgres();
select is((select count(*)::int from blocks where blocker_id = :'o' and blocked_id = :'i'), 1, '… die Sperre bleibt');
select tests.authenticate_as(:'i');
select is(split_part(tests.qa7_err(format($$ select send_message(%L, 'Hallo?') $$, :'c1')), '|', 1), '42501', 'Blockierte Person schreibt weiterhin nicht');
select is(split_part(tests.qa7_err(format($$ select start_conversation(%L, 'Hallo?') $$, :'la')), '|', 1), '42501', 'Auch nicht über start_conversation');
select is((select count(*)::int from blocks), 0, 'Blockierte Person sieht keine Zeile in blocks');
select is((select count(*)::int from my_blocks()), 0, 'my_blocks der blockierten Person ist leer');
select is(tests.qa7_err(format($$ select start_conversation(%L, 'x') $$, :'lb')), tests.qa7_err(format($$ select start_conversation(%L, 'x') $$, :'ld')),
  'Neue Anzeige des Blockierenden: gleiche Antwort wie ein Entwurf (H1: erkennbar, aber ohne eigenen Text)');
select tests.authenticate_as(:'f');
select is((select count(*)::int from my_blocks()), 0, 'Unbeteiligte sehen fremde Sperren nicht');
select tests.as_postgres();
delete from blocks where blocker_id = :'o';

-- ---------------------------------------------------------------------------
-- 6. realtime.messages: kein Schreiben, keine Presence, kein fremdes Topic
-- ---------------------------------------------------------------------------
insert into realtime.messages (topic, extension, event, payload, private)
values ('user:' || :'o', 'presence', 'presence', '{"x": 1}', true);
select tests.authenticate_as(:'o');
select set_config('realtime.topic', 'user:' || :'o', true);
select is((select count(*)::int from realtime.messages where extension = 'presence'), 0, 'Presence-Zeilen sind nicht lesbar (nur broadcast)');
select is(split_part(tests.qa7_err($$ insert into realtime.messages (topic, extension, event, payload, private)
  values (realtime.topic(), 'broadcast', 'message.new', '{}', true) $$), '|', 1), '42501', 'Kein Client-Broadcast in den eigenen Kanal');
select set_config('realtime.topic', 'user:' || upper(:'o'), true);
select is((select count(*)::int from realtime.messages), 0, 'Topic in Großbuchstaben: nichts (kein Cast, exakter Vergleich)');
select tests.as_anon();
select set_config('realtime.topic', 'user:' || :'o', true);
select is((select count(*)::int from realtime.messages), 0, 'anon liest keinen Nutzerkanal');
select is(split_part(tests.qa7_err($$ insert into realtime.messages (topic, extension, event, payload, private)
  values ('user:x', 'broadcast', 'message.new', '{}', false) $$), '|', 1), '42501', 'anon schreibt nicht');
select tests.as_postgres();
select is((select array_agg(distinct k order by k) from realtime.messages m, jsonb_object_keys(m.payload) k
           where m.topic = 'user:' || :'o' and m.event = 'message.new'),
  array['conversation_id', 'created_at', 'id', 'message_id', 'sender_id'], 'message.new: nur IDs und Zeitpunkt (id setzt realtime.send)');
select is((select count(*)::int from realtime.messages where payload::text like '%Q7 %'), 0, 'Kein Nachrichtentext im Kanal');

-- ---------------------------------------------------------------------------
-- 7. Melden: nur fremde Nachrichten der eigenen Unterhaltung; Kopie überdauert beide Kontolöschungen
-- ---------------------------------------------------------------------------
select tests.authenticate_as(:'f');
select is(split_part(tests.qa7_err(format($$ insert into reports (target_type, target_id, reason) values ('message', %L, 'scam') $$, :'m_or')), '|', 1),
  split_part(tests.qa7_err(format($$ insert into reports (target_type, target_id, reason) values ('message', %L, 'scam') $$, gen_random_uuid())), '|', 1),
  'Nachricht aus fremder Unterhaltung: wie unbekannt');
select tests.authenticate_as(:'r');
select lives_ok(format($$ insert into reports (target_type, target_id, reason, note) values ('message', %L, 'scam', '<script>x</script>') $$, :'m_or'),
  'Mona meldet die Nachricht des Besitzers');
select tests.as_postgres();
select id as rep from reports where target_id = :'m_or' \gset
select is((select body || '|' || sender_id::text || '|' || conversation_id::text from private.reported_message_snapshots where report_id = :'rep'),
  'Q7 Antwort an Mona|' || :'o' || '|' || :'cr', 'Kopie mit Text, Absender, Unterhaltung');
select ok(not has_table_privilege('service_role', 'private.reported_message_snapshots', 'select')
          and not has_table_privilege('authenticated', 'private.reported_message_snapshots', 'select')
          and not has_table_privilege('anon', 'private.reported_message_snapshots', 'select'), 'Kopien: keine Rechte für API-Rollen (auch nicht service_role)');
select ok(not has_table_privilege('service_role', 'private.chat_notifications', 'select')
          and not has_table_privilege('authenticated', 'private.chat_notifications', 'select'), 'chat_notifications: keine Rechte für API-Rollen');
delete from auth.users where id = :'r';
select is((select count(*)::int from private.reported_message_snapshots where report_id = :'rep'), 1, 'Melder löscht sein Konto: Kopie bleibt (reporter_id → null)');

-- ---------------------------------------------------------------------------
-- 8. Benachrichtigung: Abmeldung ohne vorherige Mail, gesperrter oder gelöschter Empfänger, Titel, Inhalt
-- ---------------------------------------------------------------------------
create function tests.qa7_claimed(result jsonb, uid uuid) returns int language sql as $$
  select coalesce((select jsonb_array_length(e -> 'conversations') from jsonb_array_elements(result) e where (e ->> 'recipient_id')::uuid = uid), 0);
$$;
create function tests.qa7_pass(minutes int) returns void language plpgsql as $$
begin
  alter table public.messages disable trigger messages_guard_update;
  update public.messages set created_at = created_at - make_interval(mins => minutes)
  where recipient_id in (select user_id from public.profiles where display_name like 'Q7 %');
  alter table public.messages enable trigger messages_guard_update;
  update private.chat_notifications set last_sent_at = last_sent_at - make_interval(mins => minutes),
    previous_sent_at = previous_sent_at - make_interval(mins => minutes)
  where recipient_id in (select user_id from public.profiles where display_name like 'Q7 %');
end;
$$;

-- Nur der Besitzer hat ungelesene Nachrichten (von Ina, Fred). Abgemeldet ohne vorherige Mail: nichts.
update profiles set notify_chat_email = false where user_id = :'o';
select tests.qa7_pass(3);
select is(tests.qa7_claimed(claim_chat_notifications(:'secret'), :'o'), 0, 'Abgemeldet, noch nie gemailt: keine Mail');
update profiles set notify_chat_email = true, is_blocked = true where user_id = :'o';
select is(tests.qa7_claimed(claim_chat_notifications(:'secret'), :'o'), 0, 'Gesperrter Empfänger: keine Mail');
update profiles set is_blocked = false, deleted_at = now() where user_id = :'o';
select is(tests.qa7_claimed(claim_chat_notifications(:'secret'), :'o'), 0, 'Gelöschter Empfänger: keine Mail');
update profiles set deleted_at = null where user_id = :'o';
select claim_chat_notifications(:'secret') as claim1 \gset
select is(tests.qa7_claimed(:'claim1', :'o'), 2, 'Wieder aktiv und angemeldet: eine Mail mit zwei Unterhaltungen (Abmeldung war nicht nur von der 15-min-Grenze verdeckt)');
select is((select array_agg(distinct k order by k) from jsonb_array_elements(:'claim1'::jsonb) e, jsonb_array_elements(e -> 'conversations') c, jsonb_object_keys(c) k),
  array['conversation_id', 'listing_title', 'sender_name'], 'Claim je Unterhaltung nur ID, Name, Titel (kein Text)');

-- Interessent bekommt den Titel nur, solange die Anzeige öffentlich ist
update listings set status = 'paused' where id = :'la';
select tests.authenticate_as(:'o');
select send_message(:'c1', 'Q7 Antwort an Ina');
select tests.as_postgres();
select tests.qa7_pass(3);
select claim_chat_notifications(:'secret') as claim2 \gset
select is((select c -> 'listing_title' from jsonb_array_elements(:'claim2'::jsonb) e, jsonb_array_elements(e -> 'conversations') c
           where (e ->> 'recipient_id')::uuid = :'i'), 'null'::jsonb, 'Pausierte Anzeige: kein Titel an den Interessenten');
select is((select c ->> 'sender_name' from jsonb_array_elements(:'claim2'::jsonb) e, jsonb_array_elements(e -> 'conversations') c
           where (e ->> 'recipient_id')::uuid = :'i'), 'Q7 Olaf', 'Name des Absenders');
update listings set status = 'active' where id = :'la';

-- Release: falsches Geheimnis, Fremde ohne Claim
select is(split_part(tests.qa7_err($$ select release_chat_notifications('falsch', array[gen_random_uuid()]) $$), '|', 1), '42501', 'Release mit falschem Geheimnis: 42501');
select is(release_chat_notifications(:'secret', array[:'f'::uuid]), 0, 'Release für Empfänger ohne Claim: nichts');

-- F4 (Versuche): attempts wird nach einem erfolgreichen Versand nicht zurückgesetzt. Ein früherer Fehlschlag kürzt die
-- drei Versuche einer späteren Mail.
-- Fenster 1 (Ina): Fehlschlag, dann Erfolg
select tests.qa7_pass(20);
select tests.authenticate_as(:'o');
select send_message(:'c1', 'Q7 Zweite Antwort');
select tests.as_postgres();
select tests.qa7_pass(3);
select tests.qa7_claimed(claim_chat_notifications(:'secret'), :'i');
select release_chat_notifications(:'secret', array[:'i'::uuid]);
select tests.qa7_claimed(claim_chat_notifications(:'secret'), :'i');
-- Fenster 2: neue Nachricht, zwei Fehlschläge – der dritte Versuch muss noch kommen
select tests.qa7_pass(20);
select tests.authenticate_as(:'o');
select send_message(:'c1', 'Q7 Dritte Antwort');
select tests.as_postgres();
select tests.qa7_pass(3);
select tests.qa7_claimed(claim_chat_notifications(:'secret'), :'i');
select release_chat_notifications(:'secret', array[:'i'::uuid]);
select tests.qa7_claimed(claim_chat_notifications(:'secret'), :'i');
select release_chat_notifications(:'secret', array[:'i'::uuid]);
select todo('F4: attempts wird nach Erfolg nicht zurückgesetzt', 1);
select is(tests.qa7_claimed(claim_chat_notifications(:'secret'), :'i'), 1, 'Dritter Versuch der neuen Mail nach zwei Fehlschlägen');

-- ---------------------------------------------------------------------------
-- 9. pg_cron und pg_net: ohne URL kein Aufruf, mit URL genau ein POST mit Geheimnis
-- ---------------------------------------------------------------------------
select is((select schedule || ' ' || command from cron.job where jobname = 'chat-notifications'),
  '* * * * * select private.trigger_chat_notifications()', 'Cron-Job jede Minute');
select count(*) as q0 from net.http_request_queue \gset
select private.trigger_chat_notifications();
select is((select count(*)::int from net.http_request_queue), :'q0'::int, 'Ohne URL im Vault: kein Aufruf');
select vault.create_secret('http://kong:8000/functions/v1/send-chat-notifications', 'chat_notifications_url');
select private.trigger_chat_notifications();
select is((select count(*)::int from net.http_request_queue q where q.url = 'http://kong:8000/functions/v1/send-chat-notifications'
             and q.method = 'POST' and q.headers ->> 'x-chat-notify-secret' = :'secret'), 1, 'Mit URL: ein POST mit dem Geheimnis im Header');

select * from finish();
rollback;
