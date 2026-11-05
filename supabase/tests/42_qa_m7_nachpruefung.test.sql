begin;
\ir _helpers.psql
select plan(16);

-- QA M7 Nachprüfung (docs/QA-REPORT.md „M7 – Nachprüfung“), F4: confirm_chat_notifications nur für service_role mit
-- Geheimnis, keine Wirkung auf Zeitpunkte, kein erneutes Öffnen einer versandten Mail, Zusammenspiel mit release,
-- keine endlosen Wiederholungen.

create function tests.qa7n_err(statement text) returns text language plpgsql as $$
declare s text;
begin
  execute statement;
  return 'ok';
exception when others then
  get stacked diagnostics s = returned_sqlstate;
  return s;
end;
$$;
grant usage on schema tests to service_role;
grant execute on function tests.qa7n_err(text) to anon, authenticated, service_role;

update private.app_settings set value = '2' where key = 'chat_email_delay_minutes';
update private.app_settings set value = '15' where key = 'chat_email_min_interval_minutes';
update private.app_settings set value = '1000' where key in ('chat_unanswered_max', 'chat_messages_per_10min_new', 'chat_new_conversations_daily_new');
select s.decrypted_secret as secret from vault.decrypted_secrets s where s.name = 'chat_notifications_secret' \gset
delete from private.chat_notifications;
insert into private.chat_notifications (conversation_id, recipient_id, channel, last_sent_at)
select distinct conversation_id, recipient_id, 'email', now() from messages where read_at is null;

select tests.create_user('q7n-owner@test.local', 'Q7N Olli') as o \gset
select tests.create_user('q7n-int@test.local', 'Q7N Iris') as i \gset
select id as district from regions where code = 'DE-09162' \gset
insert into listings (owner_id, kind, direction, title, content_language, region_id, status, expires_at, published_at) values
  (:'o', 'helper', 'wanted', 'Q7N Aktiv', 'de', :'district', 'active', now() + interval '30 days', now());
select id as la from listings where title = 'Q7N Aktiv' \gset
select tests.authenticate_as(:'i');
select start_conversation(:'la', 'Q7N Frage') as c1 \gset
select tests.as_postgres();

create function tests.qa7n_claimed(result jsonb, uid uuid) returns int language sql as $$
  select coalesce((select jsonb_array_length(e -> 'conversations') from jsonb_array_elements(result) e where (e ->> 'recipient_id')::uuid = uid), 0);
$$;
create function tests.qa7n_pass(minutes int) returns void language plpgsql as $$
begin
  alter table public.messages disable trigger messages_guard_update;
  update public.messages set created_at = created_at - make_interval(mins => minutes)
  where recipient_id in (select user_id from public.profiles where display_name like 'Q7N %');
  alter table public.messages enable trigger messages_guard_update;
  update private.chat_notifications set last_sent_at = last_sent_at - make_interval(mins => minutes),
    previous_sent_at = previous_sent_at - make_interval(mins => minutes)
  where recipient_id in (select user_id from public.profiles where display_name like 'Q7N %');
end;
$$;

-- 1. Rechte: nur service_role, Definer mit leerem search_path
select ok(not has_function_privilege('anon', 'public.confirm_chat_notifications(text, uuid[])', 'execute'), 'anon: kein execute auf confirm');
select ok(not has_function_privilege('authenticated', 'public.confirm_chat_notifications(text, uuid[])', 'execute'), 'authenticated: kein execute auf confirm');
select ok(has_function_privilege('service_role', 'public.confirm_chat_notifications(text, uuid[])', 'execute'), 'service_role: execute auf confirm');
select is((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid = 'public.confirm_chat_notifications(text, uuid[])'::regprocedure),
  true, 'confirm: security definer mit search_path leer');

-- Aufrufer ohne Recht scheitern auch mit dem richtigen Geheimnis
select tests.authenticate_as(:'o');
select is(tests.qa7n_err(format($$ select confirm_chat_notifications(%L, array[%L::uuid]) $$, :'secret', :'o')), '42501', 'authenticated mit richtigem Geheimnis: 42501');
select tests.as_anon();
select is(tests.qa7n_err(format($$ select confirm_chat_notifications(%L, array[%L::uuid]) $$, :'secret', :'o')), '42501', 'anon mit richtigem Geheimnis: 42501');
select tests.as_postgres();
set local role service_role;
select is(tests.qa7n_err(format($$ select confirm_chat_notifications(null, array[%L::uuid]) $$, :'o')), '42501', 'service_role ohne Geheimnis (null): 42501');
select is(tests.qa7n_err(format($$ select confirm_chat_notifications('', array[%L::uuid]) $$, :'o')), '42501', 'service_role mit leerem Geheimnis: 42501');
reset role;

-- 2. Erfolg nach einem Fehlschlag: confirm setzt nur attempts, nicht die Zeitpunkte, und öffnet die Mail nicht neu
select tests.qa7n_pass(3);
select tests.qa7n_claimed(claim_chat_notifications(:'secret'), :'o');
select release_chat_notifications(:'secret', array[:'o'::uuid]);
select is(tests.qa7n_claimed(claim_chat_notifications(:'secret'), :'o'), 1, 'Nach einem Fehlschlag: zweiter Versuch');
select last_sent_at::text || '|' || coalesce(previous_sent_at::text, 'null') as times_before from private.chat_notifications where recipient_id = :'o' \gset
select is(confirm_chat_notifications(:'secret', array[:'o'::uuid, gen_random_uuid()]), 1, 'confirm: eine Zeile (Empfänger mit attempts > 0), fremde ID ohne Wirkung');
select is((select attempts || '|' || last_sent_at::text || '|' || coalesce(previous_sent_at::text, 'null') from private.chat_notifications where recipient_id = :'o'),
  '0|' || :'times_before', 'confirm: attempts 0, last_sent_at/previous_sent_at unverändert');
select is(tests.qa7n_claimed(claim_chat_notifications(:'secret'), :'o'), 0, 'Nach confirm keine zweite Mail für dieselbe Nachricht');
select is(confirm_chat_notifications(:'secret', array[:'o'::uuid]), 0, 'confirm wiederholt: nichts mehr zu tun');
select is(confirm_chat_notifications(:'secret', '{}'::uuid[]), 0, 'confirm mit leerer Liste: 0');

-- 3. Keine endlosen Wiederholungen: Eine Mail, die immer scheitert, endet nach 3 Versuchen (auch nach einem früheren confirm)
select tests.qa7n_pass(20);
select tests.authenticate_as(:'i');
select send_message(:'c1', 'Q7N Nachfrage');
select tests.as_postgres();
select tests.qa7n_pass(3);
select tests.qa7n_claimed(claim_chat_notifications(:'secret'), :'o');
select release_chat_notifications(:'secret', array[:'o'::uuid]);
select tests.qa7n_claimed(claim_chat_notifications(:'secret'), :'o');
select release_chat_notifications(:'secret', array[:'o'::uuid]);
select tests.qa7n_claimed(claim_chat_notifications(:'secret'), :'o');
select release_chat_notifications(:'secret', array[:'o'::uuid]);
select is(tests.qa7n_claimed(claim_chat_notifications(:'secret'), :'o'), 0, 'Nach 3 Fehlschlägen kein vierter Versuch (at-most-once bleibt)');
-- Ein verspätetes confirm nach dem Aufgeben öffnet die Mail nicht wieder
select confirm_chat_notifications(:'secret', array[:'o'::uuid]);
select is(tests.qa7n_claimed(claim_chat_notifications(:'secret'), :'o'), 0, 'confirm nach dem Aufgeben: kein weiterer Versuch');

select * from finish();
rollback;
