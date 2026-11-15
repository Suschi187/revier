begin;
\ir _helpers.psql
select plan(3);

-- M10 (ADR 015 Cloud-Checkliste): Abfragen über die API brechen nach kurzer Zeit ab, damit teure Suchen die
-- Datenbank nicht blockieren. Supabase setzt die Werte je Rolle; der Test weist sie lokal, in der CI und gegen
-- Stage/Prod nach. Werden sie in der Cloud geändert, muss dieser Test mitgehen.
select is(
  (select setting from pg_roles r, unnest(r.rolconfig) setting where r.rolname = 'anon' and setting like 'statement_timeout=%'),
  'statement_timeout=3s', 'anon: 3 s');
select is(
  (select setting from pg_roles r, unnest(r.rolconfig) setting where r.rolname = 'authenticated' and setting like 'statement_timeout=%'),
  'statement_timeout=8s', 'authenticated: 8 s');
select is(
  (select setting from pg_roles r, unnest(r.rolconfig) setting where r.rolname = 'authenticator' and setting like 'statement_timeout=%'),
  'statement_timeout=8s', 'authenticator (PostgREST-Anmeldung): 8 s');

-- Die Wirkung selbst (Abbruch mit 57014) lässt sich in pgTAP nicht prüfen: query_canceled bricht auch die
-- umgebende Testanweisung ab und wird von throws_ok nicht abgefangen.

select * from finish();
rollback;
