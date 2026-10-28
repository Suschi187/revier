# ADR 009: RLS-Tests und Supabase-CI

Status: angenommen (M1)

## Kontext
CLAUDE.md: Jede Tabelle hat RLS, und Policies werden mit Tests abgesichert. Die Tests müssen lokal und in CI ohne Cloud laufen.

## Entscheidung
- pgTAP über `supabase test db`. Jede Testdatei läuft in einer Transaktion und wird zurückgerollt.
- Rollen werden in Tests mit `set local role anon|authenticated` und `set local request.jwt.claims = '{"sub": …, "role": …, "aal": …}'` gewechselt. Die Helfer liegen in `supabase/tests/00000_helpers.sql` (Schema `tests`) und brauchen keine zusätzliche Abhängigkeit.
- Prüfmatrix je Tabelle: anon, Nutzer A, Nutzer B, Admin ohne 2FA (aal1) und Admin mit 2FA (aal2), jeweils für SELECT, INSERT, UPDATE und DELETE.
- Meta-Test: Jede Tabelle in `public` hat RLS aktiv und mindestens eine Policy oder ist bewusst ohne Policy gesperrt. Gesperrte Tabellen stehen auf einer Allowlist im Test.
- CI: Workflow `supabase.yml` bei Änderungen unter `supabase/**`. Die CLI ist auf 2.122 gepinnt. Der Workflow startet mit `supabase start` ohne Studio und nicht benötigte Dienste und führt dann `supabase db reset`, `supabase test db` und `supabase db lint --level warning` aus.

## Alternativen
JS-Tests gegen die lokale API sind näher am Client, aber langsamer und nicht transaktional. Sie folgen ab M2 für Storage- und Auth-Flows.

## Folgen
Die Supabase-CI braucht einige Minuten. Sie läuft nur, wenn `supabase/` sich ändert.
