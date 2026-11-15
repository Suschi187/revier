# Plan M10 Web-Release (Stand 2026-11-15)

SPEC 6 M10: Accessibility-Durchlauf, Performance (Core Web Vitals), Fehlerseiten, Monitoring, Backups, Domain/Deployment, Staging-Test mit echten Testnutzern. *Akzeptanz:* Checkliste `docs/WEB-RELEASE.md` komplett abgehakt.

Technische Namen (Repo `revier`, Container, Paket `revier-web`) bleiben (Entscheidung 2026-11-15). Rechtstexte bleiben Platzhalter, bis der Anwalt liefert; ein öffentlicher Start ohne sie ist nicht vorgesehen (CLAUDE.md).

## 1. Entscheidungen vor dem Deploy (Mensch)

| Nr. | Frage | Vorschlag | blockiert |
|---|---|---|---|
| E1 | Inhaber der Konten (privat oder Firma), Rechnungsadresse | Firma bzw. Die Jagdbrüder, weil AVVs und Impressum daran hängen | alle Cloud-Konten |
| E2 | Domain | **entschieden 2026-11-15: `huntery.de`** (Hauptdomain, `www` leitet um) | Deploy, Mail (DKIM), Apple |
| E3 | Hosting Web-App (SPEC 7.9) | **entschieden 2026-11-15: Vercel, Region fra1** (ADR 023; ersetzt „EU-Server mit Docker“) | Stage, Prod |
| E4 | Hosting Kartendatei (1,2 GB, ADR 016) | **folgt aus E3: Supabase Storage** (Frankfurt), `/tiles/` per Rewrite auf `MAP_TILES_ORIGIN` (ADR 023) | Karte in Stage/Prod |
| E5 | Mail-Anbieter (SPEC 7.11) | **entschieden 2026-11-15: United Domains**, Absender `no-reply@huntery.de`. Folgen: Supabase Auth nutzt das SMTP direkt; die Edge Functions senden per SMTPS auf Port 465 (implizites TLS), weil Supabase in der Cloud Port 25 und 587 sperrt (ADR 017). Zu klären: AVV, Versandlimit je Stunde/Tag, DKIM-Signatur inkl. `List-Unsubscribe`, eigene Absenderadresse (z. B. `no-reply@`) | Login-Mails, alle Benachrichtigungen |
| E6 | Supabase-Konto | **vorhanden** (2026-11-15); Plan mit täglichen Backups und Dateigrenze über 1 GB für die Kartendatei prüfen | Backups, Kartendatei |
| E7 | Monitoring | **entschieden 2026-11-15: Sentry** (EU-Datenregion, ohne IP und Nutzerdaten) plus Uptime-Check auf `/api/health` | Monitoring-Punkt |
| E8 | Stage | eigenes Supabase-Projekt und eigene Subdomain mit Zugangsschutz, `SITE_INDEXABLE=false` | Staging-Test |
| E9 | Testnutzer für den Staging-Test | 5–10 Jäger aus dem Umfeld der Marke, je Sprache mindestens eine Person | Akzeptanz |

Weiter offen und nicht durch Code lösbar: Anwalt (SPEC 7.2, inkl. Melden ohne Konto und Datenschutzerklärung), Muttersprachler cs/pl, VoiceOver von Hand (DESIGN.md 10).

## 2. Arbeitspakete

**Ohne Anbieterentscheidung (jetzt machbar)**
1. `docs/WEB-RELEASE.md` als Checkliste (dieser Commit).
2. Fehlerseiten: `app/[locale]/error.tsx` und `app/global-error.tsx` (lokalisiert, ohne Fehlerdetails, mit Weg zur Startseite und Suche); 404 ohne JavaScript prüfen (QA-REPORT: leere Hülle bei `next start`). E2E.
3. Gesundheitsprüfung `GET /api/health` (Next läuft, Supabase per anon erreichbar; keine Interna), `Cache-Control: no-store`.
4. Statement-Timeout für `anon` und `authenticated` per Migration (ADR 015), mit pgTAP-Test.
5. Rate-Limit für Suche, Foto-Route, `/api/map` und `/tiles/` (ADR 015/016) als Regeln der Vercel-Firewall; Werte im Runbook.
6. Mail-Versand über United Domains (E5): SMTPS-Adapter (Port 465, TLS, AUTH LOGIN/PLAIN) hinter dem bestehenden `Mailer`-Interface, Klartext-SMTP bleibt für Mailpit; Zugangsdaten nur als Function-Secrets. Probe aus einer Cloud-Function, ob 465 offen ist; sonst Rückfall auf einen HTTP-Anbieter. Versandlimit in die Taktung der Jobs übernehmen.
7. Vercel (E3, ADR 023): `web/vercel.json` (fra1), Rewrite der Kartendatei auf Supabase Storage, Docker-Variante entfernt (Stand bc3b6f7).
8. Cloud-Runbook `docs/CLOUD-SETUP.md`: alle Cloud-Checklisten aus ADR 002, 005, 010, 011, 015–019, 021, 022 in Reihenfolge, mit Prüfbefehl je Punkt.
9. Performance: Core Web Vitals gegen Stage (Lighthouse mobil ≥ 90 auf Start, Liste, Detail; LCP, INP, CLS), Messwerte ins CHANGELOG.
10. E2E gegen Stage über `QA_BASE_URL`: Cookie-Inventar, Header-Prüfung, Smoke der Kernflows.

**Nach den Entscheidungen**
11. Supabase Stage und Prod anlegen (Runbook 8), Migrationen, Vault-Secrets, Auth-Vorlagen, Redirect-URLs, MFA, Hook.
12. Web Stage und Prod deployen, Domain, TLS, HSTS, Kartendatei.
13. Mail-Anbieter mit DKIM/SPF/DMARC, Tracking aus, List-Unsubscribe signiert.
14. Monitoring und Backups einrichten; Wiederherstellung einmal auf Stage üben.
15. Staging-Test mit Testnutzern, Funde als QA-Bericht, Fehler beheben.
16. Datenschutzerklärung (Platzhalter) um Hoster, Mail-Anbieter, Monitoring, Log- und Backup-Fristen ergänzen; Anwalt prüft.

## 3. Reihenfolge und Commits
Pakete 1–4, 6–8 erledigt (2026-11-15). Sentry (E7) erledigt. Als Nächstes 5 und 9–16 nach dem Anlegen von Stage. Ursprünglich: Pakete 1–4 und 8 sofort, je ein Commit mit Tests und CHANGELOG. 5–7 nach E3/E5. 9–16 nach dem Anlegen von Stage. Vor Paket 11 prüft der Architekt den Plan samt Runbook.
