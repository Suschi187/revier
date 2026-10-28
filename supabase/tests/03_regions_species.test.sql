begin;
\ir _helpers.psql
select plan(14);

-- Vollständigkeit (ADR 007)
select results_eq(
  $$ select country::text, level::text, count(*)::int from regions group by 1, 2 order by 1, 2 $$,
  $$ values ('AT', 'district', 94), ('AT', 'state', 9), ('DE', 'district', 401), ('DE', 'state', 16) $$,
  'DE: 16 Länder, 401 Kreise; AT: 9 Länder, 94 Bezirke'
);
select is((select count(*)::int from regions d join regions s on s.id = d.parent_id
  where d.level = 'district' and (s.level <> 'state' or s.country <> d.country)), 0,
  'Jeder Kreis hängt an einem Land desselben Staates');
select is((select count(*)::int from regions where country = 'DE' and not
  (extensions.st_x(centroid::extensions.geometry) between 5.8 and 15.1 and extensions.st_y(centroid::extensions.geometry) between 47.2 and 55.1)), 0,
  'Alle DE-Punkte liegen in Deutschland (Bounding Box)');
select is((select count(*)::int from regions where country = 'AT' and not
  (extensions.st_x(centroid::extensions.geometry) between 9.5 and 17.2 and extensions.st_y(centroid::extensions.geometry) between 46.3 and 49.1)), 0,
  'Alle AT-Punkte liegen in Österreich (Bounding Box)');
select is((select count(*)::int from regions d join regions s on s.id = d.parent_id
  where extensions.st_distance(d.centroid, s.centroid) > 350000), 0,
  'Kein Kreis liegt mehr als 350 km vom Punkt seines Landes entfernt');
select results_eq(
  $$ select code, name_de from regions where code in ('DE-09162', 'DE-09184', 'AT-900') order by code $$,
  $$ values ('AT-900', 'Wien'), ('DE-09162', 'München (Stadt)'), ('DE-09184', 'München (Landkreis)') $$,
  'Gleichnamige Kreise sind unterscheidbar, Wien ist ein Bezirk'
);
select is((select count(*)::int from regions where code ~ '^AT-9(0[1-9]|1[0-9]|2[0-3])$'), 0, 'Keine Wiener Gemeindebezirke');

-- Wildarten
select is((select count(*)::int from game_species), 14, '14 Wildarten');

-- Rechte: alle lesen, niemand über die API schreiben
select tests.create_user('a@test.local') as a_id \gset
select tests.as_anon();
select is((select count(*)::int from regions), 520, 'anon liest alle Regionen');
select is((select count(*)::int from game_species), 14, 'anon liest alle Wildarten');
select throws_ok($$ insert into regions (code, country, level, slug, name_de, name_en, name_cs, name_pl, centroid)
  values ('DE-X', 'DE', 'state', 'x', 'x', 'x', 'x', 'x', 'SRID=4326;POINT(10 50)') $$, '42501', null, 'anon legt keine Regionen an');
select tests.authenticate_as(:'a_id', 'aal2');
select throws_ok($$ update regions set name_de = 'x' $$, '42501', null, 'Nutzer ändert keine Regionen');
select throws_ok($$ delete from game_species $$, '42501', null, 'Nutzer löscht keine Wildarten');

-- Regionen mit Unterregionen lassen sich nicht löschen
select tests.as_postgres();
select throws_ok($$ delete from regions where code = 'DE-BY' $$, '23503', null, 'Land mit Kreisen ist nicht löschbar (restrict)');

select * from finish();
rollback;
