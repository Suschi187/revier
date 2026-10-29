begin;
\ir _helpers.psql
select plan(13);

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

-- Ortsnamen (QA M3 F2): keine Notiztexte; dieselben Muster prüft generate.py vor dem Schreiben.
select is((select count(*)::int from postal_code_places
  where place_name ~ 'u\.\s?a\.' or place_name ~ '^[a-zäöü]' or place_name ~ '\d' or place_name ~ '\.\.'
     or char_length(place_name) > 60
     or (place_name ~ ' ' and place_name ~* '\m(ist|wurde|aber|gehört|weiterhin|is|the|aufgelöst|incl|inkl)\M')), 0,
  'Keine Ortsnamen mit Notiztext, Ziffern oder „u.a.“');
select is((select count(*)::int from postal_codes c
  where not exists (select 1 from postal_code_places n where (n.country, n.code) = (c.country, c.code))), 0,
  'Jede PLZ hat mindestens einen Ortsnamen');
select set_eq($$ select place_name from postal_code_places where country = 'DE' and code = '99976' $$,
  array['Anrode', 'Dünwald', 'Faulungen', 'Rodeberg', 'Südeichsfeld'], '99976: nur Orte, keine Sätze aus der OSM-Notiz');

select tests.as_anon();
select ok((select count(*) from postal_codes) > 10000, 'anon liest das Verzeichnis');
select tests.authenticate_as(:'a_id');
select throws_ok($$ insert into postal_codes (country, code) values ('DE', '99999') $$, '42501', null, 'Nutzer schreiben nicht ins Verzeichnis');
select throws_ok($$ delete from postal_code_regions $$, '42501', null, 'Nutzer löschen keine Zuordnungen');

select * from finish();
rollback;
