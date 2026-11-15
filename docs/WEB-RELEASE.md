# Web-Release-Checkliste (M10)

Akzeptanz von M10 (SPEC 6): alle Punkte abgehakt, je Punkt mit Nachweis (Befehl, Testlauf, Datum, Person). Plan: `docs/plans/M10-plan.md`. Stand: angelegt 2026-11-15, nichts abgehakt.

## A. Voraussetzungen (Mensch)
- [ ] Inhaber der Konten festgelegt (privat oder Firma) und alle AVVs abgeschlossen (Hoster, Supabase, Mail, Monitoring)
- [ ] Markenrecherche *Huntery* abgeschlossen, Domain registriert (SPEC 7.1)
- [x] Hosting-Art gewählt: EU-Server mit Docker (2026-11-15, SPEC 7.9)
- [ ] Server-Anbieter gewählt (z. B. Hetzner, Scaleway), AVV abgeschlossen
- [x] Mail-Anbieter gewählt: United Domains (2026-11-15, SPEC 7.11)
- [ ] United Domains: AVV abgeschlossen, Versandlimit je Stunde/Tag bekannt, Absenderadresse angelegt
- [ ] Rechtstexte (AGB, Datenschutz, Impressum, Richtlinien) vom Anwalt geliefert und eingesetzt; offene Fragen aus SPEC 7.2 beantwortet, inkl. Melden ohne Konto (ADR 020)
- [ ] cs/pl-Texte von Muttersprachlern geprüft (Claim, Unterzeile, Glossar)
- [ ] Markenfotos/Illustrationen: Rechte geklärt (DESIGN.md 7), Rechtevermerk für `design/` (QA F8)

## B. Supabase Stage und Prod (Runbook `docs/CLOUD-SETUP.md`)
- [ ] Projekte in eu-central-1, Plan mit täglichen Backups
- [ ] Migrationen eingespielt, `supabase db lint` ohne Fehler, pgTAP-Suite gegen Stage grün
- [ ] Custom Access Token Hook an, nur Schema `public` exponiert, GraphQL aus, „Expose new tables“ aus (ADR 005)
- [ ] TOTP-MFA an, asymmetrische Signing Keys, Session-Timeouts gesetzt, `enable_confirmations` (ADR 005, 010)
- [ ] Auth: Site-URL und Redirect-URLs je Umgebung, Mail-Vorlagen und Betreff aus `supabase/config.toml` übernommen, SMTP von United Domains (Absender „Huntery“)
- [ ] Vault-Secrets und URLs für Chat-, Suchauftrags-, Lösch- und Wartungs-Jobs (ADR 017–019), Jobs laufen
- [ ] Function-Secrets für den Versand: `SMTP_HOST`, `SMTP_PORT=465`, `SMTP_TLS=true`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` (ADR 017 Nachtrag M10)
- [ ] Realtime nur private Kanäle, Grenze gleichzeitiger Verbindungen geprüft (ADR 017)
- [ ] Statement-Timeout für `anon` (ADR 015), kein Logging von Statement-Parametern (ADR 006)
- [ ] Fotoverarbeitung: Speicher-/Zeitgrenzen in eu-central-1 nachgemessen (ADR 011)
- [ ] Löschkaskade, MFA-Faktoren und `amr`-Allowlist mit echtem Login nachgewiesen (ADR 014, 019)
- [ ] Erster Admin per Runbook angelegt (ADR 005), Runbook „Admin kompromittiert“ bekannt

## C. Web Stage und Prod
- [ ] Deploy reproduzierbar mit `deploy/docker-compose.yml` (je Umgebung ein Build aus demselben Commit, weil `NEXT_PUBLIC_*` und CSP beim Build eingesetzt werden), Env mit Zod validiert, kein Secret im Bundle (CI-Guard)
- [ ] `SITE_INDEXABLE=true` nur in Prod; Stage mit Zugangsschutz und `noindex`
- [ ] Domain, TLS, Weiterleitung http→https und Nebendomains→Hauptdomain; HSTS gesetzt, Entscheidung zu `preload` (ADR 022)
- [ ] Sicherheits-Header gegen Prod geprüft (`curl -I` auf Start, Detail, `/admin`, `/static/*`), CSP ohne Verstöße; Entscheidung zu CSP-Berichten (ADR 022)
- [ ] Kartendatei in Prod: Range, stabiler ETag, `immutable`, EU mit AVV, Logs ohne IP oder ≤ 7 Tage (ADR 016)
- [ ] Rate-Limit bzw. WAF für Suche, Foto-Route, `/api/map`, Kachelpfad (ADR 015, 016)
- [ ] Access-Logs des Hosters: ohne IP oder kurze Frist, Abbestell-Token nicht dauerhaft gespeichert (ADR 018)
- [ ] Sign in with Apple nur, wenn Apple-Konto steht; sonst `NEXT_PUBLIC_AUTH_APPLE_ENABLED=false`

## D. E-Mail
- [ ] SMTPS-Adapter (United Domains, Port 465) hinter `Mailer`, aus einer Cloud-Function erfolgreich gesendet; Klartext-SMTP nur für Mailpit (ADR 017)
- [ ] SPF, DKIM, DMARC; DKIM signiert `List-Unsubscribe` und `List-Unsubscribe-Post` (ADR 018)
- [ ] Öffnungs- und Klick-Tracking beim Anbieter aus
- [ ] Je Sprache Anmeldung, Chat-, Suchauftrags-, Moderations- und Konto-Mail auf Stage empfangen, Absender „Huntery“

## E. Fehlerseiten, Monitoring, Backups
- [ ] 404 und 500 lokalisiert, ohne Fehlerdetails, auch ohne JavaScript lesbar (E2E)
- [ ] `/api/health` vom Uptime-Check überwacht, Alarm an eine feste Person
- [ ] Fehler-Monitoring ohne IP und ohne Nutzerdaten (EU), Alarm bei neuen Fehlern
- [ ] Backups aktiv; Wiederherstellung einmal auf Stage geübt und dokumentiert; Fristen in der Datenschutzerklärung (ADR 019)

## F. Qualität
- [ ] Komplette E2E-Suite gegen Stage grün (`BASE_URL`), inkl. Cookie-Inventar mit Hosting- und CDN-Cookies (ADR 021)
- [ ] Barrierefreiheit: axe-Suite grün; VoiceOver-Durchgang von Hand nach DESIGN.md 10, Ergebnis in `docs/QA-REPORT.md`
- [ ] Core Web Vitals gegen Stage mobil: Lighthouse ≥ 90 auf Start, Liste, Detail; LCP < 2,5 s, CLS < 0,1, INP < 200 ms
- [ ] Staging-Test mit echten Testnutzern (alle 4 Sprachen): registrieren, inserieren, suchen, Chat, melden, Account löschen; Funde abgearbeitet
- [ ] SEO: Sitemap und robots.txt in Prod, hreflang/Canonical stichprobenartig, Search Console eingerichtet
- [ ] Ähnlichkeitsprüfung Start/Liste/Detail gegen fremde Portale durch einen Menschen (SPEC M10a)

## G. Freigabe
- [ ] Architekt hat Runbook und Deploy geprüft
- [ ] QA-Abnahme in `docs/QA-REPORT.md`
- [ ] Mensch gibt Prod frei
