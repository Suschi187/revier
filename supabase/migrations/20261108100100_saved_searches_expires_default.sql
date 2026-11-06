-- M8 Commit 2, Nachtrag zu 20261108100000: expires_at bekommt einen Standardwert, damit Clients (Typen,
-- PostgREST) die Spalte beim Anlegen nicht angeben müssen; sie dürfen es auch nicht (kein Grant). Für Nutzer
-- setzt ohnehin der Trigger saved_searches_a_guard den Wert, der Standard gilt für Server-Inserts ohne Angabe.
alter table public.saved_searches
  alter column expires_at set default now() + make_interval(days => private.setting_int('saved_search_days'));
