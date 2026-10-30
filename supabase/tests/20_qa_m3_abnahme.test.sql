begin;
\ir _helpers.psql
select plan(8);

-- QA M3 Abnahme (docs/QA-REPORT.md, „M3 – Abnahme“): Bereitschaftsprüfung gegen Leerraum.
-- Die DB kürzt mit btrim() nur Leerzeichen (U+0020); Zod im Web kürzt mit trim() jeden Leerraum.
-- TODO-Tests schlagen den Lauf nicht fehl. Nach der Behebung meldet pg_prove sie als „unexpectedly
-- succeeded“; dann todo_start/todo_end entfernen.
set constraints all immediate;

create function tests.qa_sqlstate(statement text) returns text language plpgsql as $$
begin
  execute statement;
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;
grant execute on function tests.qa_sqlstate(text) to authenticated;

select tests.create_user('qa-ws@test.local') as a_id \gset
select id as dd from regions where code = 'DE-14612' \gset

select tests.authenticate_as(:'a_id');
insert into listings (kind, direction, title, content_language, region_id)
values ('helper', 'wanted', 'Leerraum eins', 'de', :'dd') returning id as l_nl \gset
insert into listings (kind, direction, title, content_language, region_id)
values ('helper', 'wanted', 'Leerraum zwei', 'de', :'dd') returning id as l_nbsp \gset
insert into listings (kind, direction, title, content_language, region_id)
values ('helper', 'wanted', 'Leerraum drei', 'de', :'dd') returning id as l_ok \gset

-- Positivkontrollen: Leerzeichen zählen nicht, echte 30 Zeichen reichen.
select is(tests.qa_sqlstate(format($$ update listings set description = repeat(' ', 40), status = 'pending_review' where id = %L $$, :'l_ok')),
  '23514', 'Kontrolle: 40 Leerzeichen sind keine Beschreibung');
select is(tests.qa_sqlstate(format($$ update listings set description = 'Ich suche Hilfe beim Ansitzbau im Frühjahr.', status = 'pending_review' where id = %L $$, :'l_ok')),
  'ok', 'Kontrolle: echte Beschreibung mit 30+ Zeichen geht durch');
select is(tests.qa_sqlstate($$ insert into listings (kind, direction, title, content_language, region_id)
  select 'helper', 'wanted', '   ', 'de', id from regions where code = 'DE-14612' $$),
  '23514', 'Kontrolle: Titel aus Leerzeichen abgelehnt');

select todo_start('QA M3 F2: Leerraum außer U+0020 zählt als Inhalt');
select is(tests.qa_sqlstate(format($$ update listings set description = repeat(E'\n', 30), status = 'pending_review' where id = %L $$, :'l_nl')),
  '23514', 'Beschreibung aus 30 Zeilenumbrüchen wird beim Absenden abgelehnt');
select is(tests.qa_sqlstate(format($$ update listings set description = repeat(E'\t', 15) || repeat(E'\r\n', 8), status = 'pending_review' where id = %L $$, :'l_nl')),
  '23514', 'Beschreibung aus Tabs und CRLF wird beim Absenden abgelehnt');
select is(tests.qa_sqlstate(format($$ update listings set description = repeat(U&'\00A0', 30), status = 'pending_review' where id = %L $$, :'l_nbsp')),
  '23514', 'Beschreibung aus geschützten Leerzeichen (U+00A0) wird beim Absenden abgelehnt');
select is(tests.qa_sqlstate($$ insert into listings (kind, direction, title, content_language, region_id)
  select 'helper', 'wanted', E'\t\t\t', 'de', id from regions where code = 'DE-14612' $$),
  '23514', 'Titel aus drei Tabs wird abgelehnt');
select is(tests.qa_sqlstate($$ insert into listings (kind, direction, title, content_language, region_id)
  select 'helper', 'wanted', E'\n　\n', 'de', id from regions where code = 'DE-14612' $$),
  '23514', 'Titel aus Zeilenumbruch und ideografischem Leerzeichen wird abgelehnt');
select todo_end();

select * from finish();
rollback;
