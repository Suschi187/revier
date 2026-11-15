# Plan M10 Web-Release (Stand 2026-11-15)

SPEC 6 M10: Accessibility-Durchlauf, Performance (Core Web Vitals), Fehlerseiten, Monitoring, Backups, Domain/Deployment, Staging-Test mit echten Testnutzern. *Akzeptanz:* Checkliste `docs/WEB-RELEASE.md` komplett abgehakt.

Technische Namen (Repo `revier`, Container, Paket `revier-web`) bleiben (Entscheidung 2026-11-15). Rechtstexte bleiben Platzhalter, bis der Anwalt liefert; ein öffentlicher Start ohne sie ist nicht vorgesehen (CLAUDE.md).

## 1. Entscheidungen vor dem Deploy (Mensch)

| Nr. | Frage | Vorschlag | blockiert |
|---|---|---|---|
| E1 | Inhaber der Konten (privat oder Firma), Rechnungsadresse | Firma bzw. Die Jagdbrüder, weil AVVs und Impressum daran hängen | alle Cloud-Konten |
| E2 | Domain für *Huntery* (nach Markenrecherche, SPEC 7.1) | `.de` plus `.com`, Weiterleitung auf eine Hauptdomain | Deploy, Mail (DKIM), Apple |
| E3 | Hosting Web-App (SPEC 7.9) | EU-Hoster mit Docker (Next `output: "standalone"` hinter Caddy), z. B. Hetzner oder Scaleway: volle Kontrolle über Logs (ohne IP bzw. ≤ 7 Tage, ADR 016/018), Kartendatei von derselben Origin mit Range und `immutable`, kein US-Anbieter. Alternative Vercel (Region `fra1`, AVV mit SCC; Logs und Kartendatei dann extra lösen) | Stage, Prod |
| E4 | Hosting Kartendatei (1,2 GB, ADR 016) | mit E3: Datei auf dem Server bzw. EU-Objektspeicher desselben Anbieters, ausgeliefert vom Webserver | Karte in Stage/Prod |
| E5 | Mail-Anbieter (SPEC 7.11) mit HTTP-API, EU, AVV, Tracking abschaltbar, DKIM | Brevo, Mailjet (beide FR) oder Scaleway TEM; Edge Functions dürfen in der Cloud kein SMTP (ADR 017) | Login-Mails, alle Benachrichtigungen |
| E6 | Supabase-Plan | Pro (eu-central-1): tägliche Backups 7 Tage, kein Pausieren; PITR optional | Backups |
| E7 | Monitoring | Fehler: Sentry mit EU-Datenregion oder selbst gehostetes GlitchTip, ohne IP und ohne Nutzerdaten; Erreichbarkeit: einfacher Uptime-Check auf `/api/health` | Monitoring-Punkt |
| E8 | Stage | eigenes Supabase-Projekt und eigene Subdomain mit Zugangsschutz, `SITE_INDEXABLE=false` | Staging-Test |
| E9 | Testnutzer für den Staging-Test | 5–10 Jäger aus dem Umfeld der Marke, je Sprache mindestens eine Person | Akzeptanz |

Weiter offen und nicht durch Code lösbar: Anwalt (SPEC 7.2, inkl. Melden ohne Konto und Datenschutzerklärung), Muttersprachler cs/pl, VoiceOver von Hand (DESIGN.md 10).

## 2. Arbeitspakete

**Ohne Anbieterentscheidung (jetzt machbar)**
1. `docs/WEB-RELEASE.md` als Checkliste (dieser Commit).
2. Fehlerseiten: `app/[locale]/error.tsx` und `app/global-error.tsx` (lokalisiert, ohne Fehlerdetails, mit Weg zur Startseite und Suche); 404 ohne JavaScript prüfen (QA-REPORT: leere Hülle bei `next start`). E2E.
3. Gesundheitsprüfung `GET /api/health` (Next läuft, Supabase per anon erreichbar; keine Interna), `Cache-Control: no-store`.
4. Statement-Timeout für `anon` und `authenticated` per Migration (ADR 015), mit pgTAP-Test.
5. Rate-Limit im Proxy für Suche, Foto-Route, `/api/map` und Kachelpfad (ADR 015/016) als Rückfall, falls der Hoster keine WAF hat; Grenzen konfigurierbar. *Wartet auf E3*, falls der Hoster das liefert.
6. Mail-Adapter per HTTP hinter dem bestehenden `Mailer`-Interface, SMTP bleibt für Mailpit. *Code anbieterneutral vorbereitbar, Anbieter aus E5.*
7. Deploy-Artefakt: `output: "standalone"`, Dockerfile, Caddy-Konfiguration (Header, Range für Kacheln, Logs ohne IP). *Nur bei E3 = eigener Server.*
8. Cloud-Runbook `docs/CLOUD-SETUP.md`: alle Cloud-Checklisten aus ADR 002, 005, 010, 011, 015–019, 021, 022 in Reihenfolge, mit Prüfbefehl je Punkt.
9. Performance: Core Web Vitals gegen Stage (Lighthouse mobil ≥ 90 auf Start, Liste, Detail; LCP, INP, CLS), Messwerte ins CHANGELOG.
10. E2E gegen Stage über `BASE_URL`/`QA_BASE_URL`: Cookie-Inventar, Header-Prüfung, Smoke der Kernflows.

**Nach den Entscheidungen**
11. Supabase Stage und Prod anlegen (Runbook 8), Migrationen, Vault-Secrets, Auth-Vorlagen, Redirect-URLs, MFA, Hook.
12. Web Stage und Prod deployen, Domain, TLS, HSTS, Kartendatei.
13. Mail-Anbieter mit DKIM/SPF/DMARC, Tracking aus, List-Unsubscribe signiert.
14. Monitoring und Backups einrichten; Wiederherstellung einmal auf Stage üben.
15. Staging-Test mit Testnutzern, Funde als QA-Bericht, Fehler beheben.
16. Datenschutzerklärung (Platzhalter) um Hoster, Mail-Anbieter, Monitoring, Log- und Backup-Fristen ergänzen; Anwalt prüft.

## 3. Reihenfolge und Commits
Pakete 1–4 und 8 sofort, je ein Commit mit Tests und CHANGELOG. 5–7 nach E3/E5. 9–16 nach dem Anlegen von Stage. Vor Paket 11 prüft der Architekt den Plan samt Runbook.
