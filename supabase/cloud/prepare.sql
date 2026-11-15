-- Vor dem ersten `supabase db push --remote` in einem neuen Cloud-Projekt ausführen (docs/CLOUD-SETUP.md 1.2).
-- Die Cloud vergibt in `public` für neue Tabellen, Sequenzen und Funktionen automatisch Rechte an anon,
-- authenticated und service_role („Automatically expose new tables“). Lokal ist das aus (config.toml
-- `auto_expose_new_tables = false`, ADR 005, 009): Rechte gibt es nur ausdrücklich per GRANT in den Migrationen.
-- Diese Anweisungen stellen die Cloud-Standards auf den lokalen Stand; ohne sie scheitern die Rechte-Tests
-- (u. a. 01, 03, 05) und anon/authenticated hätten Lese- und Schreibrechte auf jeder Tabelle (RLS bliebe die
-- einzige Schranke). Wiederholbar.
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete, truncate, references, trigger on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke select, usage on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated, service_role;
