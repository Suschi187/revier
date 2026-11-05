begin;
\ir _helpers.psql
select plan(31);

-- M7 Lesen (ADR 017, Plan M7 4.4, Review A5, A10): Liste mit Keyset, Kopf, Nachrichten vor/nach, Zähler,
-- Sichtbarkeit nach RLS, gleiche Antwort für fremd und unbekannt.

create function tests.chat_err2(statement text) returns text language plpgsql as $$
declare s text;
begin
  execute statement;
  return 'ok';
exception when others then
  get stacked diagnostics s = returned_sqlstate;
  return s;
end;
$$;
grant execute on function tests.chat_err2(text) to authenticated;

select tests.create_user('r-owner@test.local', 'Olga') as o \gset
select tests.create_user('r-int@test.local', 'Ingo') as i \gset
select tests.create_user('r-int2@test.local', 'Jana') as j \gset
select tests.create_user('r-fremd@test.local') as f \gset
select id as district from regions where code = 'DE-09162' \gset
insert into listings (owner_id, kind, direction, title, content_language, region_id, status, expires_at) values
  (:'o', 'helper', 'wanted', 'Lesen A', 'de', :'district', 'active', now() + interval '30 days'),
  (:'o', 'helper', 'wanted', 'Lesen B', 'de', :'district', 'active', now() + interval '30 days'),
  (:'o', 'helper', 'wanted', 'Lesen C', 'de', :'district', 'active', now() + interval '30 days');
select id as la from listings where title = 'Lesen A' \gset
select id as lb from listings where title = 'Lesen B' \gset
select id as lc from listings where title = 'Lesen C' \gset

select tests.authenticate_as(:'i');
select start_conversation(:'la', 'A1') as ca \gset
select start_conversation(:'lb', 'B1') as cb \gset
select start_conversation(:'lc', 'C1') as cc \gset
select tests.authenticate_as(:'j');
select start_conversation(:'la', 'Von Jana') as cj \gset
-- Feste Zeitpunkte für die Reihenfolge
select tests.as_postgres();
update conversations set last_message_at = now() - interval '3 minutes' where id = :'ca';
update conversations set last_message_at = now() - interval '2 minutes' where id = :'cb';
update conversations set last_message_at = now() - interval '1 minutes' where id = :'cc';

-- 1. Liste und Keyset
select tests.authenticate_as(:'i');
select my_conversations(null, 2) as p1 \gset
select is(jsonb_array_length(:'p1'::jsonb -> 'items'), 2, 'Seite 1: zwei Einträge');
select is(array(select e ->> 'id' from jsonb_array_elements(:'p1'::jsonb -> 'items') e), array[:'cc', :'cb'], 'Neueste zuerst');
select ok((:'p1'::jsonb ->> 'next_cursor') !~ E'\\s', 'Cursor ohne Zeilenumbruch');
select my_conversations(:'p1'::jsonb ->> 'next_cursor', 2) as p2 \gset
select is(array(select e ->> 'id' from jsonb_array_elements(:'p2'::jsonb -> 'items') e), array[:'ca'], 'Seite 2: der Rest, ohne Doppel');
select is(:'p2'::jsonb -> 'next_cursor', 'null'::jsonb, 'Letzte Seite ohne Cursor');
select is(tests.chat_err2($$ select my_conversations('kaputt', 2) $$), '22023', 'Ungültiger Cursor: 22023');

-- 2. Inhalt eines Eintrags
select (select e from jsonb_array_elements(:'p1'::jsonb -> 'items') e where e ->> 'id' = :'cc') as item \gset
select is(:'item'::jsonb ->> 'role', 'interested', 'Rolle aus Sicht des Nutzers');
select is(:'item'::jsonb -> 'listing' ->> 'title', 'Lesen C', 'Titel der öffentlichen Anzeige');
select is(:'item'::jsonb -> 'listing' -> 'status', 'null'::jsonb, 'Status nur für den Besitzer');
select is(:'item'::jsonb -> 'counterpart' -> 'profile' ->> 'display_name', 'Olga', 'Name des Gegenübers');
select is(:'item'::jsonb -> 'last_message' ->> 'body', 'C1', 'Vorschau der letzten Nachricht');
select is((:'item'::jsonb ->> 'can_write')::boolean, true, 'Schreiben möglich');

-- 3. Zähler beim Besitzer, gelesen
select tests.authenticate_as(:'o');
select is(unread_count(), 4, 'Besitzer: vier ungelesene');
select is((select (e ->> 'unread')::int from jsonb_array_elements(my_conversations() -> 'items') e where e ->> 'id' = :'ca'), 1, 'Ungelesen je Unterhaltung');
select mark_conversation_read(:'ca');
select is(unread_count(), 3, 'Nach dem Lesen drei');
select is((conversation_info(:'ca') ->> 'role'), 'owner', 'Kopf aus Sicht des Besitzers');

-- 4. Nicht mehr öffentliche Anzeige
select tests.as_postgres();
update listings set status = 'paused' where id = :'lb';
select tests.authenticate_as(:'i');
select is(conversation_info(:'cb') -> 'listing', 'null'::jsonb, 'Interessent: pausierte Anzeige ohne Titel (nicht mehr verfügbar)');
select tests.authenticate_as(:'o');
select is(conversation_info(:'cb') -> 'listing' ->> 'status', 'paused', 'Besitzer: Titel und Status');

-- 5. Sperre und inaktives Gegenüber (A10)
insert into blocks (blocked_id) values (:'j');
select is(unread_count(), 2, 'Blockiertes Gegenüber zählt nicht mit');
select is((conversation_info(:'cj') ->> 'blocked_by_me')::boolean, true, 'Eigene Sperre erkennbar');
select is((conversation_info(:'cj') ->> 'can_write')::boolean, false, 'Gesperrt: kein Schreiben');
select tests.authenticate_as(:'j');
select is(conversation_info(:'cj') ->> 'blocked_by_me', 'false', 'Gegenüber: Sperre nicht als eigene');
select is((conversation_info(:'cj') ->> 'can_write')::boolean, false, 'Gegenüber: kein Schreiben, ohne Hinweis wer');
select tests.as_postgres();
update profiles set deleted_at = now() where user_id = :'i';
select tests.authenticate_as(:'o');
select is(conversation_info(:'ca') -> 'counterpart' -> 'profile', 'null'::jsonb, 'Gelöschtes Gegenüber: Rückfall ohne Namen');
select is(unread_count(), 0, 'Inaktive Absender zählen nicht mit');

-- 6. Nachrichten blättern
select tests.as_postgres();
update profiles set deleted_at = null where user_id = :'i';
update private.app_settings set value = '1000' where key in ('chat_unanswered_max', 'chat_messages_per_10min_new');
select tests.authenticate_as(:'i');
select send_message(:'ca', 'A' || n) from generate_series(2, 5) n;
-- In einer Transaktion ist now() gleich: Zeitpunkte nach dem Text staffeln.
select tests.as_postgres();
alter table messages disable trigger messages_guard_update;
update messages set created_at = now() - make_interval(secs => 10 - substr(body, 2)::int) where conversation_id = :'ca';
alter table messages enable trigger messages_guard_update;
select tests.authenticate_as(:'i');
select conversation_messages(:'ca', null, null, null, null, 2) as m1 \gset
select is(array(select e ->> 'body' from jsonb_array_elements(:'m1'::jsonb -> 'items') e), array['A4', 'A5'], 'Neueste zwei, aufsteigend');
select (:'m1'::jsonb -> 'items' -> 0) as first \gset
select is(array(select e ->> 'body' from jsonb_array_elements(conversation_messages(:'ca', (:'first'::jsonb ->> 'created_at')::timestamptz, (:'first'::jsonb ->> 'id')::uuid, null, null, 10) -> 'items') e),
  array['A1', 'A2', 'A3'], 'Ältere vor der Grenze');
select is(array(select e ->> 'body' from jsonb_array_elements(conversation_messages(:'ca', null, null, (:'first'::jsonb ->> 'created_at')::timestamptz, (:'first'::jsonb ->> 'id')::uuid, 10) -> 'items') e),
  array['A5'], 'Neuere nach der Grenze (Lücke nach dem Wiederverbinden)');
select is(tests.chat_err2(format($$ select conversation_messages(%L, now(), null) $$, :'ca')), '22023', 'Halbe Grenze: 22023');

-- 7. Fremd = unbekannt
select tests.authenticate_as(:'f');
select is(conversation_info(:'ca'), null, 'Fremder Kopf: null wie unbekannt');
select is(tests.chat_err2(format($$ select conversation_messages(%L) $$, :'ca')), tests.chat_err2(format($$ select conversation_messages(%L) $$, gen_random_uuid())),
  'Fremde Nachrichten: gleicher Fehler wie unbekannt');

select * from finish();
rollback;
