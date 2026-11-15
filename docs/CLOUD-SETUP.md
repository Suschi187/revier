# Cloud-Einrichtung (Runbook, M10)

Reihenfolge für **Stage** und danach **Prod**, je mit eigenem Supabase-Projekt, eigenem Server und eigener `.env`. Jeder Schritt hat einen Nachweis; Ergebnis in `docs/WEB-RELEASE.md` abhaken. Quellen: ADR 002, 005, 006, 010, 011, 014–022, `docs/plans/M10-plan.md`.

Domain `huntery.de`, Absender `no-reply@huntery.de`. Platzhalter: `<domain>` (Prod `huntery.de`, Stage eigene Preview-Domain), `<ref>` (Supabase-Projekt), `<mail>` = `no-reply@huntery.de`.

## 0. Voraussetzungen
- Inhaber der Konten, AVVs (Supabase, Vercel, United Domains, Sentry), Domain `huntery.de` registriert.
- Lokal: Supabase CLI, Zugriff auf das Repo (Stand = getaggter Commit).

## 1. Supabase-Projekt
1. Projekt in **eu-central-1 (Frankfurt)** anlegen, Plan mit täglichen Backups. Datenbank-Passwort nur im Passwortmanager.
2. Migrationen: `supabase link --project-ref <ref>` und `supabase db push`. Nachweis: `supabase migration list` ohne Abweichung.
3. pgTAP gegen das Projekt (Stage): `supabase test db --linked`. Nachweis: alle Dateien grün, auch `61_statement_timeout`.
4. API (ADR 005, 009): nur Schema `public` exponiert, GraphQL aus, „Automatically expose new tables“ aus. Nachweis: `curl https://<ref>.supabase.co/graphql/v1` liefert keinen Dienst; eine neue Testtabelle ist über REST nicht sichtbar.
5. Auth (ADR 005, 010):
   - Custom Access Token Hook auf `private.custom_access_token_hook` (wie `supabase/config.toml`).
   - TOTP-MFA an; asymmetrische JWT-Signing-Keys an.
   - `enable_confirmations` an, Passwörter aus (ADR 010), Mindestlänge 10 nur für die Checkliste.
   - Sessions: `inactivity_timeout` und `timebox` setzen (Werte mit dem Menschen festlegen).
   - Site-URL `https://<domain>`, Redirect-URLs `https://<domain>/*/auth/confirm` (und Stage entsprechend).
   - Mail-Vorlagen `confirmation` und `magic_link` aus `supabase/templates/`, Betreff wie in `config.toml`.
   - SMTP: United Domains (Host und Port laut Anbieter, implizites TLS), Absender „Huntery“ `<mail>`.
   - Nachweis: Registrierung und Login mit Code auf Stage, je Sprache eine Mail.
6. Logs (ADR 006): kein Logging von Statement-Parametern (`log_statement` nicht `all`).
7. Realtime (ADR 017): nur private Kanäle („Allow public access“ aus). Grenze gleichzeitiger Verbindungen des Plans notieren.
8. Auth-Audit (ADR 019, Review A13): prüfen, ob die Migrationsrolle auf `auth.audit_log_entries`, `auth.flow_state` und `realtime.messages` löschen darf; sonst das Auth-Audit in die Projektdatenbank abschalten.

## 2. Edge Functions
1. Deploy: `supabase functions deploy` für `process-listing-photo`, `send-chat-notifications`, `send-search-notifications`, `delete-account`, `account-maintenance`, `verification-document`.
2. Secrets (`supabase secrets set …`), nie im Repo:
   - Versand (ADR 017 Nachtrag M10): `SMTP_HOST`, `SMTP_PORT=465`, `SMTP_TLS=true`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM=<mail>`, `SITE_URL=https://<domain>`.
3. Vault (ADR 017–019): URLs der Jobs (`chat_notifications_url` usw.) auf `https://<ref>.supabase.co/functions/v1/<name>` setzen; die Geheimnisse legen die Migrationen selbst an. Nachweis: Jobs in `cron.job_run_details` erfolgreich.
4. **Probe Port 465** aus der Cloud: eine Chat-Nachricht auf Stage auslösen, Mail kommt an. Scheitert die Verbindung, Rückfall auf einen HTTP-Anbieter (ADR 017 Nachtrag) und den Menschen fragen.
5. Fotoverarbeitung (ADR 011): 4,9-MP-Testbild hochladen, Laufzeit und Erfolg prüfen; bei Speicherfehlern Auswege laut ADR 011.

## 3. Vercel und Kartendatei (ADR 023)
1. Kartendatei: in Supabase einen öffentlichen Bucket `tiles` anlegen (Dateigrenze über 1,2 GB, Plan prüfen), Datei per TUS hochladen (Name und SHA-256 laut `web/scripts/MAP-SOURCES.md`, `cacheControl` 31536000). Nachweis: `curl -sI -H "Range: bytes=0-99" https://<ref>.supabase.co/storage/v1/object/public/tiles/<datei>` → 206.
2. Vercel-Projekt aus dem Repo, **Root Directory `web`**, Framework Next.js, Region aus `web/vercel.json` (fra1). Analytics, Speed Insights und Toolbar aus.
3. Env je Umgebung (Production und Preview/Stage getrennt): `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (nur anon/publishable), `NEXT_PUBLIC_AUTH_APPLE_ENABLED=false`, `SITE_INDEXABLE` (nur Production `true`), `MAP_TILES_FILE=<datei>`, `MAP_TILES_ORIGIN=https://<ref>.supabase.co/storage/v1/object/public/tiles`.
4. Domain `huntery.de` und `www.huntery.de` (Weiterleitung auf die Hauptdomain); DNS bei United Domains auf die Werte aus Vercel.
5. Stage: Preview-Umgebung mit eigener Supabase und Zugangsschutz (Vercel Deployment Protection), `SITE_INDEXABLE=false`.
6. Nachweis nach dem Deploy:
   - `curl -s https://huntery.de/api/health` → `{"ok":true,"supabase":"ok"}`
   - `curl -sI https://huntery.de/de` → CSP, HSTS, X-Frame-Options
   - `curl -sI -H "Range: bytes=0-99" https://huntery.de/tiles/<datei>` → 206 mit `Content-Range` (Rewrite reicht Range durch)
   - `curl -sI https://www.huntery.de/de` → Weiterleitung auf `https://huntery.de/de`
7. Rate-Limit: Regeln der Vercel-Firewall für `/*/suche*` bzw. Suchpfade, `/api/photos/*`, `/api/map`, `/tiles/*` (Werte mit dem Menschen festlegen).

## 4. Nach dem Deploy
1. Erster Admin nach ADR 005 (SQL im Studio, zurückdatiert), dann `/de/admin` mit TOTP. Runbook „Admin kompromittiert“ bereithalten.
2. Nachweise ADR 014/019: Löschkaskade (MFA-Faktoren, Rollen) mit einem Testkonto; `amr`-Allowlist mit echtem Login (Code und Link).
3. E2E gegen Stage: `cd web && QA_BASE_URL=https://stage.<domain> QA_SUPABASE_URL=https://<ref>.supabase.co npx playwright test e2e/release.spec.ts e2e/cookie-inventory.spec.ts` (nur anonyme Seiten; die übrigen Suiten brauchen lokale Service-Keys und laufen vor dem Deploy lokal und in der CI).
4. Monitoring: Uptime-Check auf `/api/health` (Intervall 1–5 min), Alarm an eine feste Person; Fehler-Monitoring nach Entscheidung E7.
5. Backups: eine Wiederherstellung auf Stage üben und mit Datum in `docs/WEB-RELEASE.md` vermerken.
6. Lighthouse mobil gegen Stage (Start, Liste, Detail ≥ 90) und Werte ins CHANGELOG.
