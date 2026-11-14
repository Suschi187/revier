begin;
\ir _helpers.psql
select plan(10);

-- ADR 022 S3: Die Ablehnungsgründe stehen nur noch in der Domain public.listing_reject_code. Tabelle, Mail-Kopie und
-- resolve_reports nutzen sie; resolve_reports meldet einen unbekannten Code weiter als Feldfehler „code“.
set constraints all immediate;

create function tests.error_of_60(statement text) returns text language plpgsql as $$
declare
  hint text;
begin
  execute statement;
  return 'ok';
exception when others then
  get stacked diagnostics hint = pg_exception_hint;
  return sqlstate || ' ' || sqlerrm || ' ' || coalesce(hint, '');
end;
$$;
grant execute on function tests.error_of_60(text) to authenticated;

-- Eine Quelle
select is((select format_type(atttypid, atttypmod) from pg_attribute where attrelid = 'public.listings'::regclass and attname = 'reject_code'),
  'listing_reject_code', 'listings.reject_code nutzt die Domain');
select is((select format_type(atttypid, atttypmod) from pg_attribute where attrelid = 'private.moderation_notifications'::regclass and attname = 'reject_code'),
  'listing_reject_code', 'moderation_notifications.reject_code nutzt die Domain');
select is((select count(*)::int from pg_constraint where conrelid = 'public.listings'::regclass and pg_get_constraintdef(oid) like '%implausible%'),
  0, 'Kein zweiter Check mit Code-Liste an der Tabelle');
select ok(pg_get_functiondef('public.resolve_reports(report_target, uuid, text, text, text, text)'::regprocedure) not like '%''implausible''%'
  and pg_get_functiondef('public.resolve_reports(report_target, uuid, text, text, text, text)'::regprocedure) like '%listing_reject_code%',
  'resolve_reports enthält keine eigene Code-Liste, sondern prüft gegen die Domain');
select is((select array_agg(v order by v) from regexp_matches(pg_get_constraintdef((select oid from pg_constraint where contypid = 'public.listing_reject_code'::regtype)), '''([a-z_]+)''', 'g') m(a), unnest(m.a) v),
  array['contact_in_text', 'duplicate', 'implausible', 'incomplete', 'killed_game', 'other', 'prohibited_content', 'weapons', 'wrong_category'],
  'Domain enthält genau die 9 Codes');

-- Verhalten
select tests.create_user('owner60@test.local') as owner_id \gset
select tests.create_user('mod60@test.local') as mod_id \gset
select tests.create_user('reporter60@test.local') as reporter_id \gset
select tests.make_admin(:'mod_id');
select id as dd from regions where code = 'DE-14612' \gset
select tests.as_postgres();
insert into public.listings (owner_id, kind, direction, title, content_language, region_id, status, expires_at)
values (:'owner_id', 'helper', 'offer', 'Q60 Öffentliche Anzeige', 'de', :'dd', 'active', now() + interval '30 days') returning id as l1 \gset
select tests.make_ready(:'l1');
select matches(tests.error_of_60($$ update public.listings set status = 'removed', reject_code = 'nonsense' where id = '$$ || :'l1' || $$' $$),
  '^23514 .*listing_reject_code', 'Unbekannter Code an der Anzeige verboten');

select tests.authenticate_as(:'reporter_id');
insert into reports (target_type, target_id, reason) values ('listing', :'l1', 'other');
select tests.authenticate_as(:'mod_id', 'aal2');
select admin_report_target('listing', :'l1') -> 'listing' ->> 'version' as v1 \gset
select is(tests.error_of_60(format($$ select resolve_reports('listing', %L, 'content_removed', 'nonsense', 'Q60', %L) $$, :'l1', :'v1')),
  '23514 Grund fehlt {"fields":["code"]}', 'resolve_reports: unbekannter Code ergibt Feldfehler code');
select is(tests.error_of_60(format($$ select resolve_reports('listing', %L, 'content_removed', null, 'Q60', %L) $$, :'l1', :'v1')),
  '23514 Grund fehlt {"fields":["code"]}', 'resolve_reports: fehlender Code ergibt Feldfehler code');
select is(resolve_reports('listing', :'l1', 'content_removed', 'duplicate', 'Q60 doppelt', :'v1'), 'content_removed',
  'resolve_reports: gültiger Code entfernt die Anzeige');
select tests.as_postgres();
select is((select (status, reject_code)::text from listings where id = :'l1'), '(removed,duplicate)', 'Code gespeichert');

select * from finish();
rollback;
