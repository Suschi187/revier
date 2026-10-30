begin;
\ir _helpers.psql
select plan(14);

-- QA M3 Abnahme (docs/QA-REPORT.md, „M3 – Abnahme“): Bereitschaftsprüfung gegen Leerraum.
-- Früher kürzte die DB mit btrim() nur Leerzeichen (U+0020), Zod jeden Leerraum (F2). Jetzt kürzen beide
-- dieselben Zeichen (private.trim_all, Migration listing_whitespace).
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

-- Weitere Textfelder der Anzeige
select is(tests.qa_sqlstate(format($$ update listings set attributes = jsonb_build_object('experience_level', E'\n\t ') where id = %L $$, :'l_ok')),
  '23514', 'Textattribut aus Leerraum wird abgelehnt');
select is(tests.qa_sqlstate(format($$ update listings set attributes = jsonb_build_object('experience_level', repeat('🦌', 200)) where id = %L $$, :'l_ok')),
  'ok', 'Längen zählen Codepoints: 200 Emoji passen in ein Feld mit 200 Zeichen');
insert into listing_photos (listing_id, sort_order) values (:'l_ok', 0) returning id as p_ok \gset
select is(tests.qa_sqlstate(format($$ update listing_photos set alt_text = U&'\3000\00A0' where id = %L $$, :'p_ok')),
  '23514', 'Alt-Text aus Leerraum wird abgelehnt');
select is(tests.qa_sqlstate(format($$ select set_listing_location(%L, %L, null, E'\t') $$, :'l_nl', :'dd')),
  'ok', 'Ort aus Leerraum wird angenommen …');
select is((select place_name from listing_places where listing_id = :'l_nl'), null, '… und als leer gespeichert');
select is(private.trim_all(U&'\FEFF\2028 Revier \205F\2009'), 'Revier', 'trim_all entfernt dieselben Zeichen wie String.prototype.trim');

select * from finish();
rollback;
