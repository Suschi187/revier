# ADR 009: RLS-Tests und Supabase-CI

Status: angenommen (M1)

## Kontext
CLAUDE.md: Jede Tabelle hat RLS, und Policies werden mit Tests abgesichert. Die Tests müssen lokal und in CI ohne Cloud laufen.

## Entscheidung
- pgTAP über `supabase test db`. Jede Testdatei läuft in einer Transaktion und wird zurückgerollt.
- Rollen werden in Tests mit `set local role anon|authenticated` und `set local request.jwt.claims = '{"sub": …, "role": …, "aal": …}'` gewechselt. Die Helfer liegen in `supabase/tests/_helpers.psql` (Schema `tests`). Jede Testdatei bindet sie per `\ir` ein; eine Datei mit Endung `.sql` würde selbst als Test laufen. Zusätzliche Abhängigkeiten gibt es nicht.
- Prüfmatrix: Für jede Tabelle werden mindestens anon, Besitzer und ein fremder Nutzer geprüft. Wo Admin-Rechte bestehen, kommt Admin mit und ohne 2FA dazu. Geprüft werden die erlaubten und die verbotenen Operationen.
- Den Server-Kontext prüfen die Tests als `service_role` (`09_grants`), nicht als `postgres`, weil `postgres` RLS und Grants umgeht.
- Hinweis: Policies, die eine Zeile ausfiltern, lösen keinen Fehler aus. Ein UPDATE trifft dann 0 Zeilen, deshalb prüfen die Tests danach den unveränderten Zustand.
- Meta-Test (`00_meta`): Jede Tabelle in `public` hat RLS aktiv und mindestens eine Policy. `private` hat keine Tabellenrechte für API-Rollen. In `public` sind nur RPCs von der Allowlist ausführbar. `09_grants` hält zusätzlich die Rechte von anon als Snapshot fest.
- CI: Workflow `supabase.yml` bei Änderungen unter `supabase/**`. Die CLI ist auf 2.122 gepinnt. Der Workflow startet mit `supabase start` ohne Studio und nicht benötigte Dienste und führt dann `supabase db reset`, `supabase test db` und `supabase db lint --level warning` aus.

## Alternativen
JS-Tests gegen die lokale API sind näher am Client, aber langsamer und nicht transaktional. Seit M2 ergänzen sie pgTAP: `web/integration/` (`npm run test:integration`) prüft Storage, PostgREST, Auth und die Mailvorlagen über die echten APIs und räumt seine Testdaten selbst auf. In der CI laufen sie im Job `e2e` von `web.yml`, wo Supabase mit Auth, Storage und Mailpit läuft. pgTAP-Zählungen über ganze Tabellen vergleichen gegen die Gesamtzahl als `postgres`, damit Reste aus E2E-Läufen sie nicht rot machen.

## Folgen
Die Supabase-CI braucht einige Minuten. Sie läuft nur, wenn `supabase/` sich ändert.
