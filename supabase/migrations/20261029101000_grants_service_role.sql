-- Review M1 (QA F2): Mit auto_expose_new_tables = false fehlten service_role die Tabellenrechte,
-- Edge Functions und Jobs (M4/M8/M9) wären gescheitert. Zugleich hatten anon/authenticated über die
-- Supabase-Defaults TRUNCATE/REFERENCES/TRIGGER; TRUNCATE umgeht RLS. Beides wird hier korrigiert,
-- auch für künftige Tabellen.

grant select, insert, update, delete on all tables in schema public to service_role;
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to service_role;

revoke truncate, references, trigger on all tables in schema public from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger on tables from anon, authenticated, service_role;
