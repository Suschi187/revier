begin;
\ir _helpers.psql
select plan(9);

-- M7 Realtime (ADR 017, Review A4): Broadcast auf user:<uuid>, ohne Nachrichtentext, Kanal nur für den
-- eigenen Nutzer lesbar (so prüft Realtime beim Join: SELECT auf realtime.messages mit realtime.topic).

select tests.create_user('rt-owner@test.local') as o \gset
select tests.create_user('rt-int@test.local') as i \gset
select tests.create_user('rt-fremd@test.local') as f \gset
select id as district from regions where code = 'DE-09162' \gset
insert into listings (owner_id, kind, direction, title, content_language, region_id, status, expires_at)
values (:'o', 'helper', 'wanted', 'Realtime', 'de', :'district', 'active', now() + interval '30 days') returning id as l \gset

select tests.authenticate_as(:'i');
select start_conversation(:'l', 'Geheimtext Zebraquoll') as c \gset
select tests.as_postgres();
select ok(exists (select 1 from realtime.messages where topic = 'user:' || :'o' and event = 'message.new' and payload ->> 'conversation_id' = :'c'),
  'Empfänger bekommt message.new');
select ok(exists (select 1 from realtime.messages where topic = 'user:' || :'i' and event = 'message.new' and payload ->> 'conversation_id' = :'c'),
  'Absender bekommt message.new (weitere Tabs)');
select ok(exists (select 1 from realtime.messages where topic = 'user:' || :'o' and event = 'unread.changed'), 'Empfänger bekommt unread.changed');
select is((select count(*)::int from realtime.messages where payload::text like '%Zebraquoll%'), 0, 'Kein Nachrichtentext im Kanal');
select ok((select bool_and(private) from realtime.messages where topic like 'user:%'), 'Nur private Kanäle');

-- Gelesen
select tests.authenticate_as(:'o');
select mark_conversation_read(:'c');
select tests.as_postgres();
select ok(exists (select 1 from realtime.messages where topic = 'user:' || :'i' and event = 'message.read' and payload ->> 'conversation_id' = :'c'),
  'Absender erfährt message.read');

-- Autorisierung des Joins
select tests.authenticate_as(:'o');
select set_config('realtime.topic', 'user:' || :'o', true);
select ok((select count(*) from realtime.messages) > 0, 'Eigener Kanal ist lesbar');
select set_config('realtime.topic', 'user:' || :'i', true);
select is((select count(*)::int from realtime.messages), 0, 'Fremder Nutzerkanal ist nicht lesbar');
select tests.authenticate_as(:'f');
select set_config('realtime.topic', 'user:' || :'o', true);
select is((select count(*)::int from realtime.messages), 0, 'Unbeteiligte lesen fremde Kanäle nicht');

select * from finish();
rollback;
