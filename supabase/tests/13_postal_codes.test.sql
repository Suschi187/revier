begin;
\ir _helpers.psql
select plan(10);

-- PLZ-Verzeichnis (ADR 012): Referenzdaten, öffentlich lesbar, nur per Migration schreibbar.
select tests.create_user('a@test.local') as a_id \gset

select ok((select count(*) from postal_codes where country = 'DE') >= 8000, 'DE: mindestens 8000 PLZ');
select ok((select count(*) from postal_codes where country = 'AT') >= 2000, 'AT: mindestens 2000 PLZ');
select is((select count(*)::int from regions r where r.level = 'district'
  and not exists (select 1 from postal_code_regions p where p.region_id = r.id)), 0, 'Jeder Kreis/Bezirk hat mindestens eine PLZ');
select is((select count(*)::int from postal_codes c
  where not exists (select 1 from postal_code_regions p where (p.country, p.code) = (c.country, c.code))), 0, 'Jede PLZ gehört zu mindestens einem Kreis');
select is((select count(*)::int from postal_code_regions p join regions r on r.id = p.region_id where r.level <> 'district'), 0,
  'PLZ gehören nur zu Kreisen, nicht zu Ländern');

-- Stichproben (amtliche Zuordnung bekannt)
select set_eq($$ select r.code from postal_code_regions p join regions r on r.id = p.region_id where p.country = 'DE' and p.code = '80331' $$,
  array['DE-09162'], '80331 liegt in München (Stadt)');
select ok(exists (select 1 from postal_code_regions p join regions r on r.id = p.region_id
  where p.country = 'AT' and p.code = '8940' and r.code = 'AT-612'), '8940 liegt im Bezirk Liezen');

select tests.as_anon();
select ok((select count(*) from postal_codes) > 10000, 'anon liest das Verzeichnis');
select tests.authenticate_as(:'a_id');
select throws_ok($$ insert into postal_codes (country, code) values ('DE', '99999') $$, '42501', null, 'Nutzer schreiben nicht ins Verzeichnis');
select throws_ok($$ delete from postal_code_regions $$, '42501', null, 'Nutzer löschen keine Zuordnungen');

select * from finish();
rollback;
