begin;
\ir _helpers.psql
select plan(19);

-- M7 Benachrichtigung (ADR 017, Review B2, A6): fällig nach 2 Minuten, nur Nachrichten seit der letzten Mail,
-- je Empfänger höchstens eine Mail in 15 Minuten, Rücksetzen nach Fehler (höchstens 3 Versuche), Ausnahmen.

select s.decrypted_secret as secret from vault.decrypted_secrets s where s.name = 'chat_notifications_secret' \gset
update private.app_settings set value = '2' where key = 'chat_email_delay_minutes';
update private.app_settings set value = '15' where key = 'chat_email_min_interval_minutes';
update private.app_settings set value = '1000' where key in ('chat_unanswered_max', 'chat_messages_per_10min_new');
-- Fremde Zeilen anderer Läufe nicht mitzählen: alles Bisherige gilt als gemailt.
delete from private.chat_notifications;
insert into private.chat_notifications (conversation_id, recipient_id, channel, last_sent_at)
select distinct conversation_id, recipient_id, 'email', now() from messages where read_at is null;

select tests.create_user('n-owner@test.local', 'Nora') as o \gset
select tests.create_user('n-int@test.local', 'Nils') as i \gset
select tests.create_user('n-int2@test.local', 'Nina') as j \gset
select id as district from regions where code = 'DE-09162' \gset
insert into listings (owner_id, kind, direction, title, content_language, region_id, status, expires_at) values
  (:'o', 'helper', 'wanted', 'Mail A', 'de', :'district', 'active', now() + interval '30 days'),
  (:'o', 'helper', 'wanted', 'Mail B', 'de', :'district', 'active', now() + interval '30 days');
select id as la from listings where title = 'Mail A' \gset
select id as lb from listings where title = 'Mail B' \gset
select tests.authenticate_as(:'i');
select start_conversation(:'la', 'Geheime Frage 1') as ca \gset
select start_conversation(:'lb', 'Geheime Frage 2') as cb \gset
select tests.authenticate_as(:'j');
select start_conversation(:'la', 'Frage von Nina') as cj \gset
select tests.as_postgres();

create function tests.backdate(minutes int) returns void language plpgsql as $$
begin
  alter table public.messages disable trigger messages_guard_update;
  update public.messages set created_at = created_at - make_interval(mins => minutes)
  where recipient_id in (select user_id from public.profiles where display_name in ('Nora', 'Nils', 'Nina'));
  alter table public.messages enable trigger messages_guard_update;
end;
$$;
create function tests.claimed(result jsonb, uid uuid) returns int language sql as $$
  select coalesce((select jsonb_array_length(e -> 'conversations') from jsonb_array_elements(result) e where (e ->> 'recipient_id')::uuid = uid), 0);
$$;
-- Zeit vergeht: Nachrichten und letzte Mails gemeinsam zurückdatieren (Reihenfolge bleibt).
create function tests.pass(minutes int) returns void language plpgsql as $$
begin
  perform tests.backdate(minutes);
  update private.chat_notifications set last_sent_at = last_sent_at - make_interval(mins => minutes),
    previous_sent_at = previous_sent_at - make_interval(mins => minutes)
  where recipient_id in (select user_id from public.profiles where display_name in ('Nora', 'Nils', 'Nina'));
end;
$$;
-- Letzte Mail an einen Empfänger vor so vielen Minuten (für die Grenze je Empfänger).
create function tests.sent_ago(uid uuid, minutes int) returns void language sql as $$
  update private.chat_notifications set last_sent_at = now() - make_interval(mins => minutes)
  where recipient_id = uid and last_sent_at is not null;
$$;

-- 1. Zugang
select throws_ok($$ select claim_chat_notifications('falsch') $$, '42501', null, 'Falsches Geheimnis: 42501');
select tests.authenticate_as(:'o');
select throws_ok(format($$ select claim_chat_notifications(%L) $$, :'secret'), '42501', null, 'Nutzer rufen claim nicht auf');
select tests.as_postgres();

-- 2. Erst nach 2 Minuten
select is(tests.claimed(claim_chat_notifications(:'secret'), :'o'), 0, 'Frische Nachrichten: noch keine Mail');
select tests.backdate(3);
select claim_chat_notifications(:'secret') as r1 \gset
select is(tests.claimed(:'r1', :'o'), 3, 'Nach 3 Minuten: eine Mail an den Besitzer mit drei Unterhaltungen');
select is((select count(*)::int from jsonb_array_elements(:'r1'::jsonb) e where (e ->> 'recipient_id')::uuid = :'o'), 1, 'Eine Mail je Empfänger');
select ok(:'r1'::text not like '%Geheime Frage%', 'Kein Nachrichtentext im Claim');
select is((select e ->> 'language' from jsonb_array_elements(:'r1'::jsonb) e where (e ->> 'recipient_id')::uuid = :'o'), 'de', 'Sprache des Empfängers');
select ok(:'r1'::text like '%Mail A%' and :'r1'::text like '%Nils%', 'Titel der öffentlichen Anzeige und Name des Absenders');

-- 3. Keine zweite Mail ohne neue Nachricht, auch nach dem Intervall
select is(tests.claimed(claim_chat_notifications(:'secret'), :'o'), 0, 'Sofort danach: nichts');
select tests.pass(30);
select is(tests.claimed(claim_chat_notifications(:'secret'), :'o'), 0, 'Nach dem Intervall ohne neue Nachricht: nichts (B2)');

-- 4. Neue Nachricht, aber Intervall je Empfänger
select tests.authenticate_as(:'i');
select send_message(:'ca', 'Noch etwas');
select tests.as_postgres();
select tests.backdate(3);
select tests.sent_ago(:'o', 5);
select is(tests.claimed(claim_chat_notifications(:'secret'), :'o'), 0, 'Letzte Mail vor weniger als 15 Minuten: warten');
select tests.sent_ago(:'o', 20);
select is(tests.claimed(claim_chat_notifications(:'secret'), :'o'), 1, 'Nach 15 Minuten: Mail nur zur Unterhaltung mit der neuen Nachricht');

-- 5. Rücksetzen nach Fehler, höchstens 3 Versuche
select tests.authenticate_as(:'i');
select send_message(:'cb', 'Fehlerfall');
select tests.as_postgres();
select tests.pass(20);
select is(tests.claimed(claim_chat_notifications(:'secret'), :'o'), 1, 'Claim (nur die Unterhaltung mit der neuen Nachricht)');
select is(release_chat_notifications(:'secret', array[:'o'::uuid]) > 0, true, 'Release nach Fehler');
select is(tests.claimed(claim_chat_notifications(:'secret'), :'o'), 1, 'Nach Release erneut fällig (2. Versuch)');
select release_chat_notifications(:'secret', array[:'o'::uuid]);
select tests.claimed(claim_chat_notifications(:'secret'), :'o');
select release_chat_notifications(:'secret', array[:'o'::uuid]);
select is(tests.claimed(claim_chat_notifications(:'secret'), :'o'), 0, 'Nach dem 3. Fehlschlag aufgegeben (at-most-once)');

-- 6. Ausnahmen: gelesen, abgemeldet, Sperre, gesperrter Absender
select tests.authenticate_as(:'o');
select send_message(:'ca', 'Antwort an Nils') ;
select send_message(:'cj', 'Antwort an Nina');
select tests.as_postgres();
select tests.backdate(3);
update profiles set notify_chat_email = false where user_id = :'i';
select is(tests.claimed(claim_chat_notifications(:'secret'), :'i'), 0, 'Abgemeldet: keine Mail');
update profiles set is_blocked = true where user_id = :'o';
select is(tests.claimed(claim_chat_notifications(:'secret'), :'j'), 0, 'Gesperrter Absender: keine Mail');
update profiles set is_blocked = false where user_id = :'o';
insert into blocks (blocker_id, blocked_id) values (:'j', :'o');
select is(tests.claimed(claim_chat_notifications(:'secret'), :'j'), 0, 'Blockiertes Paar: keine Mail');

select * from finish();
rollback;
