# Changelog

Pro Backlog-Schritt ein Eintrag: was geändert wurde, wie man es testet, bekannte Lücken.

## Nachtrag M9b: QA-Nachprüfung N1–N4 und H1 – 2026-11-12

Bericht: `docs/QA-REPORT.md`, Abschnitt „M9b – Nachprüfung“. Migration `20261112170000_qa_m9b_recheck.sql`, ADR 020 „Nachträge QA M9b Nachprüfung“.

### Geändert
- **N1:** Admins entfernen den Kartenpunkt nur noch über die Meldungs-Entscheidung mit Grund und Begründung; ein direktes UPDATE ergibt `42501`.
- **N2:** Die Dokument-Route behält `no-referrer` und die Sandbox-CSP der Function (ausgenommen aus der allgemeinen Header-Regel).
- **N3:** Die Admin-Ansicht zeigt nach dem erkannten Typ (Bild eingebettet, PDF als Download) und markiert abweichende Dateien eindeutig; ein Abruf und ein Audit je Ansicht.
- **H1:** Die Dokument-Route lehnt Abrufe von fremden Seiten ab (`Sec-Fetch-Site`).
- **N4:** ADR 020 und CHANGELOG nachgezogen; `verification_doc_link_seconds` entfernt.
- **Tests:** Der Test-Helfer setzt `revier.point_code` für die älteren Tests mit Roh-UPDATE (wie `revier.moderation`); TODO N1 in pgTAP 57 und `test.fail` N2 in `qa-m9b-nachpruefung.spec.ts` sind normale Tests.

### Testen
- `supabase test db`; `cd web && npm test && npx playwright test e2e/verification.spec.ts e2e/qa-m9b.spec.ts e2e/qa-m9b-nachpruefung.spec.ts`

## Nachtrag M9b: QA-Funde F1–F6 – 2026-11-12

Bericht: `docs/QA-REPORT.md`, Abschnitt „M9b – Abnahme“. Migration `20261112160000_qa_m9b_fixes.sql`, ADR 020 „Nachträge QA M9b“.

### Geändert
- **F1 (mittel):** Eine Beschwerde von Meldenden öffnet nur die Meldungen der angefochtenen Bearbeitung wieder (`reports.resolution_id`); vorher scheiterte die Rücknahme nach zwei Meldezyklen an `reports_one_open_idx`.
- **F3 (mittel):** Kartenpunkt entfernen verlangt Grund und Begründung, beides steht im Audit und in „Entscheidungen“, der Besitzer bekommt eine Mail (4 Sprachen).
- **F2:** Die Ausweichregel zählt den Beschwerdeführer nicht mehr als „anderen Admin“.
- **F4:** Nach Wiedereröffnung und neuer Entscheidung bekommen Meldende eine neue Ergebnis-Mail.
- **F5:** Getrennte Auswahl für Anzeigen- und Konto-Gründe, Prüfung je Maßnahme im Web und in der DB.
- **F6:** Verifizierungsdokumente nur noch über die Edge Function `verification-document` (Audit je Abruf, erste Bytes, `no-store`); kein Lesen und Signieren über die Storage-API mehr, auch nicht für Admins.
- **CI:** Deno-Job für `verification-document`.
- **Proben:** Die TODOs F1–F4 in pgTAP 56, `test.fail` F5 in `qa-m9b.spec.ts` und `it.fails` F6 in `qa-m9b.test.ts` sind normale Tests.

### Testen
- `supabase test db`; Deno per Docker in `supabase/functions/verification-document` und `send-search-notifications`
- `cd web && npm test && INTEGRATION_REQUIRED=1 npm run test:integration && npx playwright test e2e/verification.spec.ts e2e/qa-m9b.spec.ts e2e/admin-moderation.spec.ts`
- Lokal: Die neue Function bedient die Edge Runtime erst nach `supabase stop && supabase start`.

## M9b Vertrauen und Moderation (Web) – 2026-11-12

Plan `docs/plans/M9-plan.md` (Architekt-Review Abschnitt 10, Freigabe Abschnitt 11), ADR 020 mit den Abschnitten „Umsetzung“ je Commit, SPEC v0.11. Mit M9b ist M9 vollständig.

### Geändert
- **Verifizierung (ADR 020, Review A6, B3):** Antrag „Zeile zuerst“ (`begin_verification` → Upload genau auf den Serverpfad → `submit_verification`), Zurückziehen, Limit 3 in 30 Tagen in eigenen Zählerzeilen (`RV002`), kein HEIC. Entscheiden und Widerrufen nur per RPC mit aal2, nie über das eigene Konto. Admins sehen ein Dokument nur nach „Dokument anzeigen“ (Audit `verification.document_viewed`) und nur, wenn die ersten Bytes zu JPEG, PNG oder PDF passen; seit dem Nachtrag F6 nur über die Edge Function `verification-document`, nie über die Storage-API. Profilstatus aus den Anträgen abgeleitet, der Cache-Zähler steigt beim Badge-Wechsel. Web: `/account/verification`, `/admin/verifications`, `/admin/verifications/:id`.
- **Melden (Review A9):** Anzeigen und Anbieter über statische Links auf `/account/report/listing/:id` bzw. `/profile/:id` (Ziel im Pfad, damit der Login-Rücksprung es behält), Zusicherung „in gutem Glauben“ als Platzhalter, höchstens eine offene Meldung je Ziel, Eingangsbestätigung in „Meine Meldungen“ (`/account/reports`) mit Stand und Ergebnis. Im Chat zeigt eine zweite Meldung „bereits gemeldet“.
- **Meldungen im Admin:** Warteschlange je Ziel, Zielansicht mit Maßnahmen (keine, Anzeige entfernen, Kartenpunkt entfernen, Konto verwarnen, Konto sperren; `target_gone` automatisch), gemeldete Chat-Nachricht nur nach Klick und auditiert. `moderate_listing` kennt `remove` (Version nur über `admin_report_target`). Eine entfernte Anzeige verlässt `removed` nur nach einer erfolgreichen Beschwerde (Flag `revier.appeal`), auch nicht auf Server-Pfaden.
- **Konten im Admin:** Suche per POST (exakte E-Mail oder ID, gemeinsames Limit, Audit ohne Adresse), Sperren, Entsperren, Verwarnen mit Codes und Begründung; nie das eigene Konto, nie Konten mit Rolle.
- **Entscheidungen und Beschwerden (DSA Art. 17, 20; Platzhalter):** `/account/decisions` mit Grund, Begründung und Frist (183 Tage), Beschwerde unter `/account/decisions/:id/appeal`, auch gesperrt und ohne aktuelle Zustimmung. Admins entscheiden unter `/admin/appeals`; nicht der Admin der ursprünglichen Entscheidung, außer es gibt keinen anderen mit bestätigtem TOTP (markiert). `reversed` nimmt die Maßnahme zurück (Anzeige vorne in die Prüfung, Sperre aufheben, Verifizierung ohne Anrechnung aufs Limit, Meldungen wieder offen).
- **Dienstmails (Review A11):** Warteschlange `private.account_notifications` im selben Lauf wie die Moderations-Mails, Texte in 4 Sprachen für Verifizierung, Sperre, Entsperrung, Verwarnung, Meldungsergebnis (nur Zieltyp und Ergebnis), Beschwerde und verlassene Entwürfe. Die Moderations-Mails aus M8 nennen statt des Kontakt-Platzhalters die Frist zum Anfechten mit Link; Rechtsbehelfe bleiben ein markierter Platzhalter.
- **Server-Pfade (Review A7, Lücke M8):** Audit und Moderations-Mails auch ohne Admin-JWT, wenn das Flag `revier.moderation` bzw. `revier.appeal` gesetzt ist.
- **Aufräumjobs:** Dokumente 30 Tage nach der Entscheidung, Anträge ohne Einreichung und Dateien ohne Antrag nach 24 h, verlassene Entwürfe nach 12 Monaten ohne Bearbeitung mit Hinweis 30 Tage vorher (`listings.edited_at`, `draft_notice_at`), Warteschlange und Zähler nach 30 Tagen, Beschwerden nach 24 Monaten.
- **Export:** `version` 4 mit Verifizierungsspalten, `reports[].outcome`, `decisions` und `appeals`.
- **Doku:** ADR 008 (FK-Tabelle), ADR 019 (Export), ADR 020 (Umsetzung je Commit, Abweichungen), SPEC 3.4, Glossar (Dokumenttypen, Widerruf, Anfechten).

### Testen
- `supabase test db` (53 Verifizierung, 54 Meldungen und Beschwerden, 55 Aufräumjobs; 00, 07, 08, 17, 45, 49, 52 angepasst)
- Edge Functions wie in der CI per Docker: `send-search-notifications` (Dienstmails, Moderations-Mail) und `account-maintenance`
- `cd web && npm test && INTEGRATION_REQUIRED=1 npm run test:integration && npm run test:e2e`
- Integration `verification.test.ts` (Pfadbindung, Review B3 gegen die echte Storage-API), `trust-mails.test.ts` (Mails zu Akzeptanz 2 und 3 über die echte Function in Mailpit)
- E2E `verification.spec.ts`, `reports.spec.ts`, `admin-moderation.spec.ts`; `cookie-inventory.spec.ts` und `admin.spec.ts` decken die neuen Seiten ab (Review A10)

### Akzeptanz (SPEC 6 M9b)
- Upload eines Dokuments → Entscheidung im Admin → Badge „verifiziert“ öffentlich sichtbar, nach Widerruf wieder weg: erfüllt (E2E `verification.spec.ts`).
- Meldung einer Anzeige → Entfernen im Admin → Mail an den Besitzer mit Begründung und an die Meldenden mit dem Ergebnis: erfüllt (E2E `admin-moderation.spec.ts` für den Weg im Admin, Integration `trust-mails.test.ts` für die Mails).
- Sperre eines Kontos → Beschwerde des Betroffenen → Entsperrung durch einen anderen Admin: erfüllt (E2E `admin-moderation.spec.ts`, Mails in `trust-mails.test.ts`; pgTAP 54 für Ausweichregel und Rücknahmen).
- Ein Verifizierungsdokument ist ohne frischen Audit-Eintrag `verification.document_viewed` nicht lesbar, auch nicht für Admins über die Storage-API: erfüllt; seit Nachtrag F6 strenger: kein Lesen über die Storage-API, jeder Abruf über `verification-document` auditiert (Integration `verification.test.ts`, `qa-m9b-nachpruefung.test.ts`, pgTAP 08, 53, 56).

### Bekannte Lücken
- **iOS (I6):** Verifizierung per Kamera (JPEG statt HEIC), Melden, „Meine Meldungen“, Entscheidungen und Beschwerde folgen auf denselben RPCs.
- **Rechtlich zu prüfen (SPEC 7.2, Anwalt):** Wortlaut von Begründung, Rechtsbehelf und Streitbeilegung (Art. 17, 21), Zusicherung „in gutem Glauben“ (Art. 16), Melden ohne Konto (Art. 16; heute Kontaktweg im Impressum), befristete Sperren (Art. 23, Spalte `blocked_until` erst dann), Ausnahme nach Art. 19 und Ausweichregel (Art. 20 Abs. 6), Transparenzbericht (Art. 15/24, Zählwerte vor den Fristjobs sichern), Meldepflicht (Art. 18), Kontaktstellen (Art. 11/12), Fristen (30 Tage Dokumente, 183 Tage Anfechten, 12/24 Monate), Zusage des Badges, EXIF in Fotos von Dokumenten (H1), Codes für Maßnahmen.
- **Hinweis zu verlassenen Entwürfen** nur per Mail; „Meine Anzeigen“ zeigt das Löschdatum noch nicht.
- **Sperrumgehung** durch Löschen und Neuregistrieren (H8) bleibt offen.

## Nachtrag M9a: QA-Funde F1–F7 – 2026-11-11

Bericht: `docs/QA-REPORT.md`, Abschnitt „M9a – Abnahme“.

### Geändert
- **F1 (mittel):** `account_deletion_finalize` vergleicht Nutzer-ID und Adresse nur als vollständigen JSON-Wert. Vorher löschte die Löschung von `anna@…` auch Auth-Audit-Einträge von `johanna@…` (Migration `20261111130000_qa_m9a_fixes`).
- **F2:** Der Export nennt Titel gemerkter Anzeigen nur, wenn sie öffentlich sind (wie `my_favorites`); Export-`version` 2.
- **F3:** `account_deletion_prepare` entfernt Realtime-Ereignisse zu Unterhaltungen des Kontos (`unread.changed` beim Gegenüber). Die Allowlist in ADR 019 nennt bei Kopien gemeldeter Nachrichten jetzt auch `message_id` und `conversation_id`.
- **F4:** `/api/account/photos/:id` ist von der allgemeinen Header-Regel in `next.config.ts` ausgenommen und behält `Referrer-Policy: no-referrer`.
- **F5:** Der waagerecht scrollende Container der Tabelle auf `/cookies` ist per Tastatur erreichbar (`tabIndex`, `role="region"`, Label).
- **F6:** `/account/data` nennt auch Rollen, Bewertungen und Geräte (4 Sprachen).
- **F7:** ADR 019 (Messung großer Konten, Fixture, Einstellungen, `Sec-Fetch-Site`) und ADR 008 (Job für nie bestätigte Konten) nachgezogen; Fixture in `account-deletion.test.ts` um Blockierung und Gerät ergänzt.
- **Proben:** Die TODOs in pgTAP 51 und die erwarteten Fehlschläge F3–F5 in `qa-m9a.test.ts` und `qa-m9a.spec.ts` sind normale Tests. pgTAP 48 prüft, dass Ereignisse des Gegenübers zu anderen Unterhaltungen bleiben.

### Testen
- `supabase test db` (52), `cd web && npm run test:integration && npx playwright test e2e/qa-m9a.spec.ts e2e/account-delete-export.spec.ts e2e/cookie-inventory.spec.ts`

## M9a Konto und Datenschutz (Web) – 2026-11-11

Plan `docs/plans/M9-plan.md` mit Architekt-Review (Abschnitte 10/11), ADR 019 (Löschung, Export, Aufräumjobs), ADR 021 (Cookies und Einwilligung), SPEC v0.11. M9 ist geteilt; M9b „Vertrauen und Moderation“ (ADR 020) folgt, M9 gilt erst danach als abgeschlossen.

### Geändert
- **Cookies und Einwilligung (ADR 021):**
  - Kein Sprach-Cookie mehr (`localeCookie: false`, QA M0 F7). `/` wählt nach `Accept-Language` mit `Vary` und `Cache-Control: private`.
  - Inventar `web/lib/consent/inventory.ts` als eine Quelle für die Seite `/cookies` und die Tests: Session, PKCE-Verifier und die Karte als eigener Dienst ohne Speicher.
  - Gefunden im E2E: auth-js 2.117 legt einen PKCE-Verifier je Anmeldevorgang und einen Index an. Nach einem Login per Code bleiben sie bis zum Abmelden liegen; das Inventar und die Seite nennen das, `signOut` räumt alle ab.
  - Kein Banner, solange nur Notwendiges läuft; ein Guard-Test schlägt fehl, sobald ein Eintrag optional ist und kein Banner existiert.
- **Rechtstexte (Platzhalter, noindex):** Datenschutz und Nutzungsbedingungen mit einer Gliederung der tatsächlichen Verarbeitungen, neue Seite `/guidelines` (verbotene Inhalte). Neue Seite `/sources` (indexierbar) mit allen Pflichtvermerken und dem ODbL-Download der PLZ-Tabelle unter `/api/sources/postal-codes` (ADR 012). Footer mit sechs Links.
- **Account-Löschung (ADR 019):**
  - `request_account_deletion`: frische Anmeldung (höchstens 10 Minuten, `RV007`), bei TOTP-Faktor zusätzlich aal2 (`RV005`), Konten mit Rolle `42501` `admin_role`. Ohne Legal-Gate, auch für gesperrte Konten.
  - `amr` gemessen: Code, Link und Erstbestätigung schreiben `otp`, ein Refresh behält den Zeitstempel.
  - Fester Ablauf in der Edge Function `delete-account`: Storage 1 → prepare → deleteUser → finalize (Auth-Audit, `flow_state`, Realtime) → Storage 2 → complete. Lease je Zeile, Backoff 1 min verdoppelt bis 1 h, die Wiederholung bricht nie ab. Auslöser per pg_net nach dem Antrag und per Cron jede Minute.
  - Es bleiben nur: Audit pseudonymisiert, Meldungen gegen das Konto und Kopien gemeldeter Nachrichten.
  - Web `/account/delete`: erklärt Gelöschtes und Reste, erneute Anmeldung per Code an die Adresse der Session (bei Faktor mit TOTP), Bestätigung per Server Action (auch ohne JS), danach abgemeldet und Hinweis „wird gelöscht“. Die Sperrfrist von GoTrue zwischen zwei Mails wird angezeigt.
- **Datenexport:** `export_my_data` mit Allowlist je Abschnitt, Daten anderer nur als Anzeigename, 3 je 24 h (`RV002`). Web `/account/data` mit `POST /api/account/export` (Origin-Prüfung, Download als JSON) und Foto-Links `GET /api/account/photos/{id}` (Login und Eigentum, 60-s-URL). Im Plan fehlte `reviews`; der Abschnitt ist ergänzt.
- **Erreichbarkeit:** Löschen und Export auch ohne aktuelle Zustimmung (Links auf der Willkommensseite); `guards.test.ts` hält das fest.
- **Aufräumjobs:** nie bestätigte Konten nach 7 Tagen über denselben Löschweg, erledigte Meldungen samt Kopien nach 12 Monaten, Audit nach 24 Monaten, Export-Zähler nach 7 Tagen, Function `account-maintenance` für Foto-Eingang und Fotos ohne Zeile nach 24 h. Admin-Übersicht mit der Anzahl hängender Löschungen.
- **Wächter:** `00_meta` prüft, dass jeder Bucket in der Löschliste steht und jede Spalte mit Nutzerbezug in ADR 008 eingeordnet ist; pgTAP 49, dass jede Tabelle mit Nutzerbezug im Export oder in der Ausschlussliste steht.
- **Doku:** ADR 008 nachgezogen, ADR 014 mit `RV007`, ADR 005 mit dem Runbook „Admin will sein Konto löschen“ (Review A15), Glossar.

### Testen
- `supabase test db` (pgTAP 48 Löschung mit Rest-Inventar, 49 Export, 50 Aufräumjobs; 00, 12 und 15 erweitert)
- Edge Functions wie in der CI per Docker: `deno task check && deno lint && deno task test` in `delete-account` und `account-maintenance`
- `cd web && npm test && INTEGRATION_REQUIRED=1 npm run test:integration && npm run test:e2e`
- Integration `account-deletion.test.ts`: Normalfall, drei Abbrüche, Auslöseweg über pg_net; Gegenprobe über die Storage-API und Inventar über alle Nicht-System-Schemas. `account-maintenance.test.ts`: echte Function und Storage-API.
- E2E `cookie-inventory.spec.ts` (anonym, angemeldet, Admin, Abmelden, Selbsttest; gegen Stage/Prod: `QA_BASE_URL=… QA_SUPABASE_URL=…`), `account-delete-export.spec.ts` (Export mit Foto-Links und Limit, Löschen über die Oberfläche bis zum gelöschten Konto, Admin-Rolle).
- Lokal: Neue Functions bedient die Edge Runtime erst nach `supabase stop && supabase start`.

### Akzeptanz (SPEC 6 M9a)
- a) Ein gelöschter Account verschwindet aus allen Tabellen und Buckets bis auf die Allowlist: erfüllt (Integration `account-deletion.test.ts` gegen GoTrue und die Storage-API, mit Abbrüchen und Auslöseweg; pgTAP 48 als frühe Warnung).
- b) Ohne Einwilligung laufen keine nicht notwendigen Cookies: erfüllt für CI und lokal (E2E `cookie-inventory.spec.ts` mit Selbsttest). Gegen Stage und Produktion steht der Lauf aus (Hosting- und CDN-Cookies, M10).

### Bekannte Lücken
- **iOS (I6):** Löschen, Export, frische Anmeldung (`RV007`/`RV005`) und der `download_url`-Vertrag folgen auf denselben RPCs. Bis dahin hat die iOS-App keinen Lösch- und Exportweg aus M9a (App-Store-Pflicht vor dem Release).
- **Apple:** Der Token-Widerruf bei der Löschung (Apple-Vorgabe) fehlt; Vorbedingung für `NEXT_PUBLIC_AUTH_APPLE_ENABLED`. `amr` für Apple ist lokal nicht gemessen.
- **E-Mail-Adresse ändern** fehlt weiter (seit M2), Vorschlag M10.
- **M9b:** Verifizierung, Melden von Anzeigen und Profilen, Meldungs-Warteschlange, Sperren, Beschwerden, Moderations-Mails für Server-Pfade, verlassene Entwürfe; dazu die Fristen für Verifizierungsdokumente.
- Die Rechtstexte sind Platzhalter (SPEC 7.2), die Texte auf cs und pl ungeprüft (SPEC 7.6).
- Der Hinweis „wird gelöscht“ auf der Startseite braucht JavaScript (die Seite bleibt statisch gecacht).
- `docs/WEB-RELEASE.md` fehlt noch (M10); Pflichtpunkt dort: das Cookie-Inventar gegen Stage und Produktion.

### Anwaltsfragen (SPEC 7.2, neu oder präzisiert)
- Reste nach der Löschung und ihre Aufbewahrung (Art. 17 Abs. 3 DSGVO), auch der Zustimmungsnachweis (`legal_acceptances`).
- Einordnung der Session- und PKCE-Cookies als unbedingt erforderlich (TDDDG und die Umsetzungen in AT, CZ, PL).
- Backups und Logs bei Hoster und Mail-Anbieter (Datenschutzerklärung, M10).
- Für M9b: Kontaktstellen nach Art. 11/12, Ausnahme nach Art. 19, Transparenzbericht (Art. 15/24), Meldepflicht (Art. 18), Melden ohne Konto, Sperrdauer (Art. 23), EXIF in Verifizierungsfotos.

### Cloud-Checkliste (neu, Review A13)
- **Vault:** `account_deletion_url` auf `https://<projekt>.supabase.co/functions/v1/delete-account` und `account_maintenance_url` auf `…/functions/v1/account-maintenance`. Die Secrets legen die Migrationen an. Ohne URL bleiben Löschanträge liegen.
- **Rechte:** Prüfen, ob die Migrationsrolle in der Cloud auf `auth.audit_log_entries`, `auth.flow_state` und `realtime.messages` löschen darf. Sonst das Schreiben des Auth-Audits in die Projektdatenbank abschalten; dann gilt die Frist des Log-Dienstes und gehört in die Datenschutzerklärung.
- **Nach dem Deploy:** Kaskade von MFA-Faktoren und Rollen nachweisen; `amr`-Allowlist mit einem echten Login gegenprüfen; das Cookie-Inventar gegen die Produktions-URL laufen lassen.
- **Cron-Jobs:** `account-deletions` jede Minute, `account-maintenance` stündlich, `unconfirmed-accounts`, `reports-retention`, `audit-retention` und `data-exports-cleanup` täglich.

### Lokal von Hand
- Löschung einschalten: `supabase db query "select vault.create_secret('http://kong:8000/functions/v1/delete-account', 'account_deletion_url')"`
- Storage-Aufräumen: `supabase db query "select vault.create_secret('http://kong:8000/functions/v1/account-maintenance', 'account_maintenance_url')"`

## Nachtrag M8: QA-Funde F1–F3 – 2026-11-07

Bericht: `docs/QA-REPORT.md`, Abschnitt „M8 – Abnahme“.

### Geändert
- **F1:** `claim_search_notifications` bestimmt erst nach der Entdopplung, ob eine Mail tägliche Treffer enthält. Eine Mail nur mit doppelten täglichen Treffern verbraucht den Kalendertag nicht mehr (Migration `20261109100000_qa_m8_fixes`).
- **F2:** `next.config.ts` nimmt `/api/unsubscribe` von der allgemeinen Header-Regel aus. Die Route behält `Referrer-Policy: no-referrer` und ihre eigene CSP.
- **F3:** ADR 018 nennt die Fehlercodes (für I6) und den Datenexport in M9. Die erledigte Lücke zum Cache-Header ist entfernt, die Cloud-Checkliste nennt den Rückstau der Moderations-Mails.
- **Proben:** Der TODO in pgTAP 46 und `test.fail` „F2“ in `qa-m8.spec.ts` sind jetzt normale Tests.
- **Nachprüfung N1:** Auch `/api/unsubscribe/` (mit Schrägstrich) behält die eigene CSP der Route.
- **Nachprüfung N2:** ADR 018 nennt `23514` ohne `hint` (Name, Filtergröße) und weitere `42501`-Fälle; ADR 008 nennt den Datenexport der Suchaufträge.
- **Proben der Nachprüfung:** pgTAP 47, `qa-m8-nachpruefung.spec.ts` (gegen Prod mit `QA_BASE_URL=… QA_PROD=1`).

### Testen
- `supabase test db` (46), `cd web && npx playwright test e2e/qa-m8.spec.ts`

## M8 Suchaufträge (Web) – 2026-11-06

Plan `docs/plans/M8-plan.md` mit Architekt-Review (Abschnitte 10/11), ADR 018, SPEC v0.10. Abgenommen durch den Nutzer am 2026-11-08 (QA-Abnahme und Nachprüfung in `docs/QA-REPORT.md`).

### Geändert
- **Suchauftrag:**
  - Takt „sofort“ oder „täglich“, Laufzeit 6 Wochen.
  - Pausieren, Fortsetzen und Verlängern per RPC; Verlängern nur in den letzten 14 Tagen oder nach dem Ablauf, sonst `RV006` mit `extend_from`. Pausieren hält die Laufzeit nicht an.
  - Die Filter sind nach dem Anlegen fest. Ein Trigger prüft sie wie die Suche (auch einen zu langen Suchbegriff) und entfernt `sort`.
  - Höchstens 25 je Konto mit Lock, abgelaufene zählen mit. Abgelaufene werden 30 Tage nach dem Ablauf gelöscht.
- **Abgleich bei der ersten Freigabe:**
  - Ein AFTER-Trigger reiht die Anzeige ein, wenn `published_at` erstmals gesetzt wird.
  - Der Abgleich läuft über die bestehende `search_conditions`, je gleichem Filter einmal, mit Vorfilter. Ein fehlerhafter Auftrag wird übersprungen und gezählt.
  - Kein Treffer bei eigener Anzeige oder Sperre, bei pausiertem oder abgelaufenem Auftrag, bei abgeschalteter E-Mail, oder wenn der Auftrag erst nach der Freigabe angelegt wurde.
- **Genau eine Mail:**
  - Entdoppelt wird je Empfänger und Anzeige; „sofort“ gewinnt vor „täglich“.
  - Bei „sofort“ geht die Mail 2 Minuten nach der Freigabe, höchstens alle 10 Minuten. „Täglich“ geht ab 07:00 Uhr Europe/Berlin.
  - Buchführung über `claim_id` (höchstens einmal, 3 Versuche). Beim Claim werden alle Bedingungen erneut geprüft.
  - Mailinhalt nur über eine Liste erlaubter Felder (Titel, Kreis/Bundesland, Preis, Link), nie Koordinaten.
- **Moderations-Mails:**
  - Bei Freigabe, Änderungswunsch, Ablehnung und Entfernung durch einen Admin.
  - Mit Grund, ohne Identität des Admins, als Dienstmail ohne Abbestellen. Der Hinweis auf den Kontaktweg ist als Platzhalter markiert.
- **Abbestellen per Klick (RFC 8058)** für Suchauftrags- und Chat-Mails:
  - Token aus 32 zufälligen Bytes, gespeichert nur als SHA-256, gültig 90 Tage.
  - Header `List-Unsubscribe` auf `POST /api/unsubscribe` (ohne Cookies, immer 200) und `List-Unsubscribe-Post`.
  - Der Link im Text führt auf die Bestätigungsseite `/{lang}/unsubscribe` (noindex, no-referrer, beim Aufruf kein DB-Zugriff).
- **Edge Function** `send-search-notifications` mit Suchauftrags- und Moderations-Mails in getrennten Schritten. Der Mailer liegt jetzt unter `functions/_shared/mail/`, `SITE_URL` wird geprüft. URL-Wörter und Preisformat prüfen gemeinsame Fixtures in Deno und Vitest.
- **Web:**
  - „Suche speichern“ auf der Suchseite (Liste und Karte, mit Kartenausschnitt).
  - Konto-Seite „Suchaufträge“: Takt, E-Mail, Pausieren und Fortsetzen, Verlängern, Umbenennen, Löschen in zwei Schritten, „Ergebnisse ansehen“.
  - Funktioniert auch ohne JavaScript. Texte in 4 Sprachen.
- **Nebenbei behoben:**
  - Die M7-Probe „falsches Geheimnis“ schlug in etwa jedem 16. Lauf fehl.
  - Die Chat-E2E-Tests sehen nach einem Seitenwechsel die versteckt gehaltene vorige Seite nicht mehr.

### Testen
- `supabase test db` (pgTAP 43 Suchauftrag, 44 Abgleich, 45 Moderations-Mails und Abbestellen; 05 angepasst)
- Edge Functions wie in der CI per Docker: `deno task check && deno lint && deno task test` in `send-search-notifications` (dazu `deno lint ../_shared/mail`) und `send-chat-notifications`
- `cd web && npm test && INTEGRATION_REQUIRED=1 npm run test:integration && npm run test:e2e`
- Integration `saved-searches.test.ts`: Freigabe mit zweitem Admin, Function, Mailpit, genau eine Mail, erneute Prüfung, zwei Aufträge, täglicher Takt, parallele Läufe, Release, Pause, One-Click, Chat- und Moderations-Mails.
- E2E `saved-searches.spec.ts`: Speichern (Liste, Karte, ohne JS), Konto-Seite, Verlängern, Limit, Abbestellseite, One-Click-POST ohne Cookies an die Header-URL, axe, 360 px in 4 Sprachen.
- Lokal neu: Die neue Function bedient der Edge Runtime erst nach `supabase stop && supabase start`.

### Akzeptanz (SPEC 6 M8)
- Neue passende Anzeige löst genau eine E-Mail aus: erfüllt (Integration `saved-searches.test.ts`: genau eine Mail, keine weitere bei späteren Läufen, erneuter Prüfung und erneuter Freigabe, bei zwei Aufträgen desselben Nutzers und bei parallelen Läufen; pgTAP 44). Technisch höchstens eine, im Normalfall genau eine: Bricht der Versand nach dem Claim ab, geht die Mail verloren (ADR 018).

### Messung (Review A4)
- Lokal, 25 000 Aufträge (1000 Konten × 25) und 50 Anzeigen: 801 verschiedene Filter, rund 120 000 Treffer.
- Abgleich 3,4–7,7 s, ohne Gruppierung waren es 14,6 s.
- Claim für 50 Empfänger 1,4–1,9 s.
- Beides liegt unter dem pg_net-Timeout von 20 s.

### Bekannte Lücken
- **iOS:** Suchaufträge und Push folgen in I6, auf denselben RPCs (`pause/resume/extend_saved_search`), mit demselben Takt und derselben Entdopplung. `notify_push` bleibt bis dahin ungenutzt.
- Moderations-Mails entstehen nur bei Entscheidungen mit Admin-JWT. Ein späterer Pfad als service_role (zum Beispiel M9) braucht einen eigenen Auslöser.
- Der Widerspruchs- und Beschwerdeweg (DSA Art. 20) fehlt noch, der Hinweis in der Mail ist ein Platzhalter (SPEC 7.2, M9).
- Die Suchauftrags-Mail nennt Art und Richtung der Anzeige nicht, nur Titel, Region und Preis.
- Der Sprachumschalter auf der Abbestellseite verliert den Token; die Seite bittet dann, den Link aus der Mail erneut zu öffnen.
- Der Request-Logger von `next dev` schreibt Pfade samt Query, also auch Token. Das betrifft nur den Dev-Modus; die Logs des Hosters klärt M10.
- Die Texte auf cs und pl, auch die Mailtexte, sind ungeprüft (SPEC 7.6).
- Der Test zum täglichen Takt kann rund um Mitternacht (Europe/Berlin) am Tageswechsel wackeln.
- In der CI läuft während der Integrationstests kein Web-Server; den One-Click-POST deckt dort das E2E ab.
- Die Datenschutzerklärung (Platzhalter) nennt Suchaufträge, Benachrichtigungen und Abbestell-Token noch nicht (M9).

### Cloud-Checkliste (neu)
- **Deploy-Reihenfolge:** erst die Migrationen, dann die Functions. Die Chat-Function erwartet den `unsubscribe_token`.
- **Vault:** `search_notifications_url` auf `https://<projekt>.supabase.co/functions/v1/send-search-notifications` setzen. Ohne URL ruft der Job nichts auf. `search_notifications_secret` legt die Migration an.
- **Function-Secrets:** `SITE_URL` (`https://…`, ohne Pfad), sonst antworten beide Mail-Functions mit 503. Dazu `MAIL_FROM`.
- **DKIM** muss `List-Unsubscribe` und `List-Unsubscribe-Post` signieren (Bulk-Sender-Regeln). Die Access-Logs des Hosters höchstens 7 Tage aufbewahren (Token in der Query).
- **Cron-Jobs:** `search-notifications` jede Minute, `search-notifications-retention` und `saved-searches-retention` täglich.
- Wird `search_notifications_url` erst später gesetzt, gehen im ersten Lauf alle offenen Moderations-Mails der letzten 30 Tage auf einmal hinaus (QA M8 H4). Vor dem Setzen prüfen oder alte Einträge erledigen.

### Lokal von Hand: Suchauftrags-Mails
- Einmalig: `supabase db query "select vault.create_secret('http://kong:8000/functions/v1/send-search-notifications', 'search_notifications_url')"`
- Dann eine Suche speichern und mit einem zweiten Admin-Konto eine passende Anzeige freigeben. Etwa 2 Minuten später liegt die Mail in Mailpit (http://127.0.0.1:54324). Die Moderations-Mail an den Besitzer kommt im selben Lauf.
- Wieder aus: `supabase db query "delete from vault.secrets where name = 'search_notifications_url'"`

## Nachtrag M7: QA-Funde F1–F5 – 2026-11-05

Bericht: `docs/QA-REPORT.md`, Abschnitte „M7 – Abnahme“ und „M7 – Nachprüfung“.

### Geändert
- **F1:** Unterhaltungsliste und Chat-Ansicht verlangen nur die Anmeldung, nicht die aktuelle Zustimmung. Ohne Zustimmung zeigt die Chat-Ansicht statt der Eingabe den Weg zur Zustimmung; Lesen, Blockieren und Melden bleiben möglich, auch für gesperrte Konten. Schreiben verhindert weiter die DB (`RV001`).
- **F2:** Der Zähler in der Navigation wird beim Zurückkehren in den Tab neu gelesen (erste Rückkehr sofort, dann höchstens alle 30 Sekunden; nicht im Chat, nicht abgemeldet).
- **F3:** Verlässt die Seite den Chat, schließt sie ohne weitere Kanäle die WebSocket.
- **F4:** `confirm_chat_notifications` setzt nach einem erfolgreichen Versand die Versuche auf 0; die Function meldet Erfolge zurück.
- **F5, N2:** ADR 017, SPEC 3.1 (Ausnahme vom Onboarding für Chat-Seiten) und die Lücken hier ergänzt.
- **N1:** Die Function loggt Fehler beim Zurückmelden (`release`/`confirm`) als Zahl.
- **Proben:** `test.fail`/TODO der Abnahme sind normale Tests; neu `42_qa_m7_nachpruefung`, `qa-m7-nachpruefung` (Integration und E2E).

### Testen
- `supabase test db`, `cd web && npm test && INTEGRATION_REQUIRED=1 npm run test:integration && npm run test:e2e`
- Von Hand: Konto mit Unterhaltung, Zustimmung entfernen (`delete from legal_acceptances where user_id = …`), Chat öffnen → Hinweis statt Eingabe, „Aktionen“ → Blockieren geht.

### Cloud-Checkliste (neu)
- Migrationen vor den Edge Functions ausrollen (sonst fehlt `confirm_chat_notifications`; die Function loggt das als `bookkeepingErrors`).

## M7 Chat (Web) – 2026-11-05

Plan `docs/plans/M7-plan.md` mit Architekt-Review (Abschnitte 10/11), ADR 017, SPEC v0.9.

### Geändert
- **Schreibwege nur per RPC:** `start_conversation`, `send_message`, `mark_conversation_read` (Definer, feste Prüfreihenfolge: angemeldet, aktiv, `RV001`, `22023 body`, `RV002`, dann `42501`). Keine Unterhaltung ohne Nachricht. `recipient_id` vom Server, `read_at` nur `null → now()`.
- **Textregeln:** getrimmt, CRLF → LF, keine Steuer- und Bidi-Zeichen, 1–2000 Zeichen; Zod gleich der DB (Fixture `chat_rules.json`).
- **Rate-Limits (`RV002` mit `scope`):** 10 neue Unterhaltungen je 24 h (neue Konten 3), 30 Nachrichten je 10 min (15), 5 ohne Antwort.
- **Lesen per RPC:** Liste mit Keyset, Kopf, Nachrichten vor und nach einer Grenze, Ungelesen-Zähler; Gegenüber mit Rückfall, wenn gesperrt oder gelöscht.
- **Realtime:** privater Broadcast-Kanal `user:<uuid>` ohne Inhalte; nur unter `/account/messages`. Die Seite lädt bei Ereignissen ihren Serverstand neu (keine Lücke), im verborgenen Tab erst beim Sichtbarwerden.
- **Web:** „Nachricht schreiben“ aus dem Detail (Login-Rücksprung mit der Anzeigen-ID im Pfad), Unterhaltungsliste, Chat-Ansicht, Zähler in der Navigation, Senden mit und ohne JavaScript, Nonce-CSP für die Chat-Routen, Sicherheitshinweise.
- **Blockieren und Melden:** aus der Unterhaltung, auch ohne Zustimmung und für gesperrte Konten; Liste blockierter Personen; Melden fremder Nachrichten und des Profils, mit privater Kopie gemeldeter Nachrichten.
- **Hinweise vor dem Senden (SPEC 7.8):** Kontaktdaten für alle, genaue Lage nur für den Besitzer; Senden bleibt möglich.
- **E-Mail-Benachrichtigung:** pg_cron und Edge Function `send-chat-notifications`, nur Nachrichten seit der letzten Mail, je Empfänger höchstens alle 15 Minuten, kein Nachrichtentext, Sprache des Empfängers, Abmeldung im Profil.

### Testen
- `supabase db reset && supabase test db` (pgTAP 06, 36–40 für den Chat)
- `cd web && npm test` (Textregeln, Kontakthinweise), `INTEGRATION_REQUIRED=1 npm run test:integration` (RPCs, Realtime mit zwei Clients, Textregeln gegen die RPC, Mail über Mailpit)
- `npm run test:e2e` (`chat.spec.ts`, `chat-realtime.spec.ts` = Akzeptanz a, `chat-block.spec.ts` = Akzeptanz b, `chat-a11y.spec.ts`)
- Edge Function: `deno task check && deno lint && deno task test` in `supabase/functions/send-chat-notifications` (wie in der CI per Docker)
- Von Hand: zwei Browser (einer privat), zwei Konten. Konto A öffnet eine Anzeige von B und schreibt; B sieht die Nachricht ohne Neuladen, der Zähler steigt. B blockiert A im Menü „Aktionen“; A kann nicht mehr schreiben.

### Akzeptanz (SPEC 6 M7)
- a) Zwei Browser-Sitzungen tauschen Nachrichten in Echtzeit: erfüllt (`chat-realtime.spec.ts`, in beide Richtungen, mit „Gelesen“).
- b) Ein blockierter Nutzer kann nicht mehr schreiben: erfüllt (`chat-block.spec.ts`, in beide Richtungen, auch per API; pgTAP 06/36).

### Bekannte Lücken
- **iOS:** Chat und Push folgen in I5, auf denselben RPCs, Kanälen und Fixtures (ADR 017).
- Meldungs-Warteschlange und Einsicht gesicherter Nachrichten im Admin: M9.
- Abmelden per Klick aus der Mail (RFC 8058): M8–M10. Bis dahin in den Profileinstellungen.
- Mail-Anbieter für die Cloud (HTTP-API, EU): M10. Lokal und in der CI über Mailpit.
- Spam-Erkennung über gleiche Texte: M9/M10.
- Ohne JavaScript geht beim Senden ein Entwurf verloren, wenn die Nachricht ungültig ist oder ein Limit greift (Fehlercode in der URL, nie der Text; Next.js 16.4, ADR 017).
- Profilseite ohne JavaScript: Ihre Abschnitte (auch die neue Einstellung „E-Mail bei neuen Nachrichten“) erscheinen nur mit JavaScript, weil die Seite seit M2 per Suspense streamt. Für M10 (Barrierefreiheit) vorgemerkt.

### Cloud-Checkliste (neu)
- Realtime: „nur private Kanäle“ (öffentlichen Zugriff aus); Grenze gleichzeitiger Verbindungen prüfen (ADR 017).
- Chat-Mails: Vault-Secret `chat_notifications_url` auf `https://<projekt>.supabase.co/functions/v1/send-chat-notifications` setzen (ohne URL ruft der Job nichts auf). `chat_notifications_secret` legt die Migration an. Function-Secrets `MAIL_FROM` und `SITE_URL`; Versand ab M10 über den HTTP-Adapter eines EU-Anbieters (SMTP aus Edge Functions in der Cloud nicht möglich), Öffnungs- und Klick-Tracking aus.
- pg_cron und pg_net aktiv (Migration `chat_notifications`); Job `chat-notifications` jede Minute.

### Lokal von Hand: Chat-Mails
- Ohne Weiteres verschickt lokal nichts automatisch (keine URL im Vault). Zum Ausprobieren einmalig:
  `supabase db query "select vault.create_secret('http://kong:8000/functions/v1/send-chat-notifications', 'chat_notifications_url')"`
  Danach kommt etwa 2 Minuten nach einer ungelesenen Nachricht eine Mail in Mailpit (http://127.0.0.1:54324).
- Wieder aus: `supabase db query "delete from vault.secrets where name = 'chat_notifications_url'"`

## Werkzeuge: Supabase-CLI v3 – 2026-11-05

### Geändert
- Supabase-CLI 2.122.0 → 3.0.0, lokal (Homebrew) und in beiden CI-Workflows gepinnt.
- v3 zielt ohne `--remote` immer auf den lokalen Stack. `--local` ist überflüssig (Warnung, fällt in v4 weg) und wurde aus `admin:local`, den Integrationstests, `gen:types` und der CI entfernt. `admin:local` bricht mit einer CLI unter v3 ab.
- `config.toml`: `[auth.email] enabled = true` und `[auth.sms] enabled = false` statt des veralteten `enable_signup` (gleiche Wirkung). `[local_smtp]` und `project_id` waren schon gesetzt, die lokale Datenbank bleibt beim Wechsel erhalten.
- Die JSON-Ausgaben von `db query` und `status` sind kompatibel; `status` nennt nur noch `MAILPIT_URL`.

### Testen
- `supabase stop && brew upgrade supabase && supabase start`, danach `supabase test db` und `supabase db lint -s public,private --level warning --fail-on warning`
- `cd web && npm run gen:types` erzeugt keine Änderung; `npm run admin:local -- <e-mail>` wie bisher

## Nachtrag M6: QA-Funde F1–F7 – 2026-11-04

Bericht: `docs/QA-REPORT.md`, Abschnitt „M6 – Abnahme“.

### Geändert
- **F1 Nachladen:** Die Karte lädt die Punkte nach jedem Verschieben und Zoomen neu (300 ms entprellt) und bei neuen Filtern. Ältere Abrufe werden abgebrochen. Liste und Karte zeigen nach „In diesem Bereich suchen“ dieselbe Menge.
- **F2 Bereich über 30°:** `viewBbox` rundet erst nach außen und kappt dann auf dem 4-Stellen-Raster auf 30° um die Mitte. Dabei aufgefallen: Zod verwarf gültige Bereiche, deren Differenz in Gleitkomma knapp über 30 lag (89.403 − 59.403). Die Grenze hat jetzt eine Toleranz von 1e-9 wie die exakte Rechnung der DB; der Fall steht in der gemeinsamen Fixture.
- **F3 Steuerelemente:** Zoom-Buttons, Attribution, Marker und Popup von MapLibre sind in de/en/cs/pl beschriftet (`Map.controls`).
- **F4 Genauigkeit:** `map_listings`, `my_favorites` und `provider_listings` laufen mit `extra_float_digits = 3`. Punkte kommen bitgenau wie gespeichert (wichtig für iOS).
- **F5:** `set_listing_location(…, 'set')` ohne `p_lat` oder `p_lng` ergibt `22023 point`, statt den Punkt still zu entfernen.
- **F6:** Beträge in `bbox`, die float8 nicht darstellt (`1e-400`), ergeben `22023 bbox` statt `22003`; `/api/map` antwortet 400 statt 502.
- **F7:** Entfernt ein Moderator den Punkt einer fremden Anzeige, bleibt der Status (aktiv bleibt aktiv, mit Kreismittelpunkt). Audit-Eintrag `listing.point_removed`. Admin-Aktion und Benachrichtigung kommen mit M9.
- **Hinweise aus dem Bericht:** Kein Marker-Layer mehr ohne Hinweis ab 300 Elementen („Bitte hineinzoomen“). `416` der Kachel-Route mit `no-store` statt `immutable`. ADR 016 ergänzt: Dichte im Ring, Lage im Chat geteilt (Hinweis für M7), gleicher Punkt, Hint-Format der Regel für kleine Kreise.
- **Proben:** TODOs in pgTAP `34_qa_m6_abnahme` und `test.fail`/`it.fails` in `e2e/qa-m6.spec.ts` und `lib/qa-m6.test.ts` sind normale Tests; `/api/map` wird bitgenau verglichen. Neu: F7 (Status, Audit, kein Eintrag beim Besitzer), Zufallstest für `viewBbox`.

- **Nachprüfung N1–N4** (QA-REPORT „M6 – Nachprüfung“):
  - **N1:** Zod prüft die 30°-Grenze exakt dezimal wie die DB (statt Toleranz 1e-9). Zwei neue Fälle in der gemeinsamen Fixture (knapp über 30°, Exponentschreibweise).
  - **N2:** Entfernt die Moderation den Punkt einer aktiven oder pausierten Anzeige, gilt die Freigabe ohne Punkt weiter. Fortsetzen nach einer Pause führt nicht mehr in die Prüfung.
  - **N3:** `listing.point_removed` ist im Admin-Audit-Log filterbar und in vier Sprachen benannt, der Status im Detail übersetzt.
  - **N4:** Verschwindet beim Neuzeichnen ein fokussierter Marker oder Cluster (zum Beispiel nach Enter auf einem Cluster), geht der Fokus an den nächstgelegenen neuen Marker, ohne Marker an die Kartenfläche.

### Testen
- `supabase db reset && supabase test db` (828 mit der Nachprüfung)
- `npm test`, `npm run test:integration`, `npm run test:e2e` (Karte: `e2e/map*.spec.ts`, `e2e/qa-m6.spec.ts`)
- Von Hand: `/de/suche?view=map`, verschieben und zoomen → Zahl der Anzeigen auf der Karte ändert sich; weit herauszoomen, „In diesem Bereich suchen“ → „Gefiltert nach Kartenbereich.“

### Offen (nicht in diesem Nachtrag)
- Schriften unter `/static/map/fonts/` ohne Version im Pfad (bei einem Wechsel der Glyphen mitziehen).
- Ausschnitt der Karte mit `bbox` in der URL ist wegen des Rands größer als der Filter.
- `regionGeo()` cacht bei einem DB-Fehler ein leeres Ergebnis.
- Kachel-Route ohne `Range` streamt die ganze Datei (M10, mit WAF und Bandbreite).
- Wortwahl „Lage im Landkreis“ für österreichische Bezirke und kreisfreie Städte mit dem Glossar abstimmen.

## M6 Karte (Web) – 2026-11-02

Plan `docs/plans/M6-plan.md` mit Architekt-Review (Abschnitte 10/11), ADR 016, SPEC v0.8.

### Geändert
- **Migrationen:**
  - `regions_area`, `regions_area_data` (generiert mit `generate.py --areas-out`): Fläche je Region aus VG250 und Statistik Austria, ohne Polygone.
  - `map_point`: Kartenpunkt `map_point` (verfremdeter Punkt oder Kreismittelpunkt), gesetzt vom letzten BEFORE-Trigger nach der Verfremdung, mit Teil-Index. `bbox` im Filterformat v1. Gemeinsame Bedingungsfunktion `private.search_conditions` für Suche und Karte.
  - `map_listings`: Karten-RPC (höchstens 2000 Punkte, ohne `owner_id`, PLZ und Präfix), `point` und `approx` in den Trefferkarten, Cache-Zähler beim Entfernen eines Punkts.
  - `set_listing_location_point`: Punkt über `set_listing_location` mit `p_point` (`keep | set | clear`), kein Punkt in Kreisen unter 400 km². Fehler als Feldcodes (`place.point.small_district`, `place.point.too_far`), nie mit Koordinaten.
  - `region_geo`: Mittelpunkt und Fläche je Region für den Startausschnitt.
- **Web:**
  - Kartengrund: MapLibre mit selbst gehosteten Kacheln (PMTiles von der eigenen Origin, `/tiles/<name>`), Stil je Sprache ohne fremde URLs und ohne Sprites. Schriften (Noto, OFL) und Worker als eigene Datei, CSP mit `worker-src 'self'`. Attribution immer sichtbar.
  - Listen: Umschalter Liste/Karte (`view=map`) und „In diesem Bereich suchen“ (`bbox=`). Cluster und Einzelpunkte sind Buttons, gleiche Koordinaten öffnen eine Kurzkarte mit allen Anzeigen dort. `GET /api/map` liefert GeoJSON, ohne Cache und ohne CORS.
  - Detail: Abschnitt „Lage“ mit Hinweis zur Verfremdung, kleine Karte erst auf Klick.
  - Assistent, Schritt „Ort“: optionale Punktwahl per Klick oder Fadenkreuz und Button (Tastatur). Der gespeicherte Punkt erscheint nur als „So erscheint die Lage öffentlich“, nie als Eingabe. Hinweise bei weiteren Punkten im Kreis und zum Kreiswechsel. In Kreisen unter 400 km² keine Punktwahl.
  - Skripte: `map:download` (Kartenausschnitt mit pmtiles-CLI, fester Version und SHA-256), `map:style`, `map:worker` (vor `dev` und `build`).
- **Neue Abhängigkeiten**, alle BSD-3-Clause mit fester Version:
  - `maplibre-gl` 6.15.0: Karte, wie die SPEC verlangt.
  - `pmtiles` 4.5.0: Kacheln aus einer Datei per Range-Request.
  - `@protomaps/basemaps` 5.7.2: nur devDependency, erzeugt den Stil.

  Transitive Lizenzen der drei Pakete (28 insgesamt): BSD-3-Clause 5, ISC 8, BSD-2-Clause 2, MIT 13. Nichts außer MIT, BSD und ISC.
- **Doku:** ADR 016 mit Bedrohungsmodell und Zahlen, ADR 006 (Nachtrag), ADR 003, SPEC v0.8 (7.10 entschieden, Karte in M9, ODbL in 7.2), Glossar „Karte“, `web/scripts/MAP-SOURCES.md`, `supabase/data/regions/SOURCES.md` (Flächen).
- **Tests:**
  - pgTAP `31_map_point`, `32_map_listings`, `33_set_location_point`, Meta-Test zur Trigger-Reihenfolge.
  - Integration: Karte und Suche liefern für jede gültige Fixture dieselben Anzeigen; kleiner Kreis über die API.
  - Vitest: Range, Bereich, Punkt aus dem Formular, keine Koordinaten in Logs und URLs, Stil, Schriften, Worker, CSP.
  - E2E `map-smoke`, `map` und `map-picker`.

### Testen
- Einmalig `cd web && npm run map:download -- --fixture` (7 MB) und für die Entwicklung `npm run map:download` (1,2 GB). Der Dev-Server findet die Dateien in `web/.cache/map/` selbst.
- `supabase db reset && supabase test db` (767), `cd web && npm test` (442), `npm run test:integration` (176), `npm run test:e2e`
- Manuell:
  1. `/de/jagdpacht?view=map` öffnen, Cluster anklicken, Punkt anklicken, zum Detail.
  2. Ausschnitt verschieben, „In diesem Bereich suchen“ wählen.
  3. Im Assistenten (Schritt „Ort“, Kreis über 400 km²) einen Punkt setzen und speichern. Der öffentliche Marker liegt 3–5 km daneben.

### Messung
- `map_listings` mit 10.000 synthetischen Anzeigen, als anon, lokal, Transaktion mit Rollback:

  | Fall | Laufzeit |
  |---|---|
  | DE+AT (2000, gekappt) | 472 ms |
  | Bayern | 114 ms |
  | kleiner Ausschnitt (40 Punkte) | 218 ms |
  | mit Volltext | 288 ms |

  Die Bereichsabfrage selbst nutzt `listings_map_point_idx` (0,04 ms). Den Rest kostet die Sichtbarkeitsprüfung je Zeile (`listing_is_public`). Das liegt unter 1 s, bei mehr Daten zuerst diese Prüfung angehen (z. B. mit einem Join statt Funktionsaufruf je Zeile).
- **Bundle:** Die Karte lädt nur, wenn sie geöffnet wird. Start, Liste ohne Karte und Detail vor dem Klick laden kein MapLibre (E2E). Mit Karte, gzip:

  | Teil | Größe |
  |---|---|
  | MapLibre | 293 KB |
  | pmtiles und Kartenkomponenten | etwa 38 KB |
  | CSS | 10 KB |
  | Worker | 147 KB |
  | Stil | 3 KB |

  LCP und INP auf einem Mittelklasse-Telefon misst M10.
- **Cache Storage:** Über das pmtiles-Protokoll legt MapLibre keine Kacheln im Cache Storage des Browsers ab (E2E prüft `caches.keys()`). Die Datenschutzerklärung (M9) nennt die Karte, aber keinen Browser-Speicher.

### Akzeptanz (SPEC 6 M6)
- [x] Die Karte zeigt nur verfremdete Positionen: Kartendaten gleich `display_location` bzw. Kreismittelpunkt, der Eingabepunkt in keiner Antwort (pgTAP `31`, E2E „Akzeptanz a“)
- [x] Klick öffnet das Detail, auch bei gestapelten Anzeigen (E2E „Akzeptanz b“)

### Bekannte Lücken
- **iOS (I3, I4):** nutzt `map_listings` und `set_listing_location` mit `p_point` unverändert (MapKit, keine Kacheln von uns); noch nicht umgesetzt.
- **Produktions-Hosting** der Kartendatei (M10):
  - EU-Objektspeicher oder CDN mit Range und stabilem ETag
  - AVV
  - Logs ohne IP oder höchstens 7 Tage
  - Rate-Limit bzw. WAF für `/tiles/` und `/api/map`
  - `MAP_TILES_FILE` setzen
- Über 2000 Anzeigen im Ausschnitt: Hinweis „hineinzoomen“ statt Zählung je Rasterzelle (Review H1, spätestens bei 1000 Anzeigen nachziehen).
- Startausschnitt aus Mittelpunkt und Fläche, nicht aus den echten Grenzen (Review H3).
- In der CI laufen alle Kartentests gegen den Produktions-Build mit Software-WebGL, aber ohne Kartendatei (neutraler Grund). Nur der Test der Kachel-Route wird dort übersprungen; er läuft lokal mit der Fixture.

## Nachtrag M5: QA-Funde F1–F11 – 2026-11-01

Bericht: `docs/QA-REPORT.md`, Abschnitt „M5 – Abnahme“.

### Geändert
- **F1 Relevanz-Paging:** `search_listings` läuft mit `extra_float_digits = 3`. Der Rang steht verlustfrei im Cursor, die nächste Seite wiederholt keine Treffer mehr.
- **F2 Suchtext:** Die Grenze von 32 Knoten gilt je Sprachfassung, nicht für den verknüpften tsquery. Sechs und mehr Wörter funktionieren. Ist der Text trotzdem zu lang, zeigt das Web „Suchbegriff zu lang“ statt „Filter ungültig“.
- **F3 Favoriten:**
  - Neue RPCs `my_favorites` (Karten und Zahl der nicht verfügbaren in einer Abfrage) und `remove_unavailable_favorites` (die DB bestimmt die Menge selbst).
  - Keine ID-Liste mehr in der URL (414 ab etwa 220 IDs) und kein N+1.
  - Schlägt das Laden fehl, gilt nichts als „nicht verfügbar“, und es wird nichts entfernt.
- **F4:** Die Policy `favorites_insert_own` lässt nur öffentliche, fremde Anzeigen zu. Vorhandene Favoriten auf eigene Anzeigen werden entfernt.
- **F5 360 px:** Listenkarten dürfen im Grid schrumpfen (`minmax(0,1fr)`, `min-w-0`). Lange Wörter in Titel, Anbieterzeile und Überschriften brechen um (`overflow-wrap: anywhere`, Silbentrennung per `lang`).
- **F6:** Leere Kategorie- und Regionsseiten sind `noindex` ohne Canonical und hreflang.
- **F7:** „Auf Anfrage“ hat nie eine Währung (Check `price_consistent` verschärft, Bestand bereinigt). Solche Anzeigen erscheinen nicht mehr im Währungsfilter.
- **F8:** Unterpfade statischer Seiten ohne Unterseiten (`LEAF_SECTIONS`) ergeben 404 aus dem Proxy, auch im Produktions-Build. Ein Vitest gleicht die Liste mit dem Dateisystem ab.
- **F9:** Der Rücksprung nach dem Merken behält den Suchtext (nur per POST). Login-Link und Umleitungen zu Login oder Onboarding enthalten ihn nie (mit N2).
- **F10:** `SITE_INDEXABLE` wirkt zur Laufzeit: Der Proxy setzt `X-Robots-Tag`, `robots.txt` wird zur Anfrage erzeugt. Ein Build gilt damit für Stage und Prod.
- **F11:** Der Cache-Zähler steht im Schlüssel der Sitemap. Entfernte Anzeigen und gelöschte Konten fallen sofort heraus, neue Anzeigen erscheinen nach bis zu 1 h.
- **Nachprüfung N1–N3** (QA-REPORT „M5 – Nachprüfung“):
  - **N1:** Der Proxy läuft auf allen Pfaden außer `_next/` und reicht Dateien, Sitemaps, `robots.txt` und APIs nur durch. Außerhalb von Prod trägt damit jede Antwort `X-Robots-Tag: noindex`, auch die 308 für den Schrägstrich am Ende (die entfernt der Proxy jetzt selbst).
  - **N2:** Leitet „Merken“ zu Login oder Onboarding um (Sitzung abgelaufen, Zustimmung fehlt), steht der Suchtext nicht in der URL.
  - **N3:** Gültige Unterpfade je statischem Bereich stehen in `STATIC_ROUTES` (Abgleich mit dem Dateisystem per Vitest). Unbekannte Pfade unter `account`, `admin` und `auth` ergeben auch im Produktions-Build 404.
- **Hinweis aus dem Bericht:** Fällt die Abfrage des Cache-Zählers aus, gilt ein fester Schlüssel statt eines neuen je Anfrage.
- **Proben:** Die TODO-Proben in pgTAP `28_qa_m5_abnahme` und die `test.fail` in `e2e/qa-m5.spec.ts` sind jetzt normale Tests. Neu ist pgTAP `29_qa_m5_fixes` (300 Favoriten, Entfernen nur der nicht verfügbaren, fremde Konten unberührt).

### Testen
- `supabase db reset && supabase test db` (713 mit den Proben der Nachprüfung), nach allen E2E-Läufen ohne Reset noch einmal grün, keine `@test.local`-Konten übrig
- `cd web && npm test` (396), `npm run test:integration` (160), `npm run test:e2e` (92, ohne `test.fail`)
- Produktions-Build:
  - `npm run build && npx next start -p 3456`, dann `QA_BASE_URL=http://localhost:3456 npx playwright test e2e/qa-m5-nachpruefung.spec.ts e2e/qa-m5.spec.ts e2e/qa-m4.spec.ts e2e/public.spec.ts` (67)
  - `curl -s -o /dev/null -w '%{http_code}' localhost:3456/de/imprint/x` und `/de/auth/x` geben 404, `curl -sI localhost:3456/sitemap/de.xml` trägt `X-Robots-Tag: noindex`
  - Mit `SITE_INDEXABLE=true npx next start` gestartet: `robots.txt` erlaubt alles, kein `X-Robots-Tag`

### Bekannte Lücken
- Review A12: „Weitere laden“ mit Fokus auf den ersten neuen Treffer gibt es nicht, die Listen blättern über Seitenlinks (ohne JavaScript bedienbar).
- Die übrigen Hinweise des Berichts bleiben offen, unter anderem die Übersetzungen aller Namespaces im RSC-Payload (Performance, M10) und die 410-Seite ohne Sprachumschalter.

## M5 Öffentliche Seiten, Suche, Detail (Web) – 2026-11-01

Plan `docs/plans/M5-plan.md` mit Architekt-Review (Abschnitte 10/11), ADR 015, SPEC v0.7.

### Geändert
- **Migrationen:**
  - `publication_fields`: `published_at` (erste Freigabe, nie zurückgesetzt) und `approved_at` (jede Freigabe), Trigger auf allen Pfaden, Check „aktiv nur mit published_at“, Backfill, nicht im Inhalts-Hash. Bundesland-Slugs global eindeutig, Kreis-Slugs je Bundesland. Favoriten höchstens 500 je Konto (Advisory-Lock, `23514`).
  - `search_listings`: eine Sichtbarkeitsdefinition `private.listing_is_public` für Policy, `public_profiles` und alle RPCs (Review B1). `search_listings` mit Filterformat v1, Fehler `22023` mit dem Schlüssel als `hint`, Keyset-Cursor an Filter und Sortierung gebunden, Gesamtzahl bis 1000. `listing_region_counts` für Regionslinks.
  - `public_page_state`: Zustand `public`, `gone` oder `null` (nie „entfernt“), `provider_listings`. Cache-Zähler `public_cache_epoch`, den Trigger bei Entfernen, Sperren und Konto-Löschung auf allen Pfaden erhöhen.
- **Web:**
  - Pfad-Parser `lib/public/paths.ts` mit URL-Wörtern je Sprache. Ihn nutzen Proxy, Seiten, Sprachumschalter, hreflang, Sitemap und `safeNextPath`. Regions-Slugs kommen aus `lib/public/reference-data.json` (`npm run gen:reference`, Abgleich per Integrationstest).
  - Proxy:
    - 308 auf die kanonische Form für alle Pfade, 404 für unbekannte Formen.
    - Für Detail und Anbieter ungecacht 404 bzw. 410, nur bei Dokumentanfragen, fail-open. Die 410-Seite liefert der Proxy selbst, weil Next den Status eines Rewrites sonst nicht übernimmt.
    - `X-Robots-Tag: noindex, follow` für Suche und Listen mit Query.
  - Seiten:
    - Startseite (Suchfeld, Kategorien, Länder, neueste Anzeigen)
    - Kategorie, Bundesland, Kreis und Suche mit allen Filtern aus SPEC 4.3 als GET-Formular
    - Anzeigen-Detail (Galerie, Eckdaten, Anbieterbadge, Kontakt nur nach Login)
    - Anbieterprofil (Privatpersonen `noindex`)
    - Favoriten (`/account/favorites`)
    - Alle ohne Suspense, damit sie ohne JavaScript vollständig im HTML stehen.
  - Öffentliche Daten nur über den Anon-Client mit festen Spalten (Test `public-boundary`). Cache-Profil `publicListings` (5 min), Tags in den Actions, Cache-Zähler in jedem Cache-Schlüssel.
  - Foto-Route `/api/photos/{id}/{thumb|full}`: Der Bucket bleibt privat, jeder Abruf prüft die Sichtbarkeit (`no-cache` + ETag, 304).
  - Merken nur per POST, ohne Login zum Login mit Rücksprung; nicht mehr verfügbare Favoriten lassen sich gesammelt entfernen.
  - SEO: Canonical und hreflang mit übersetzten Pfaden; JSON-LD `BreadcrumbList` und auf der Startseite `WebSite`, maskiert über `jsonLdString`. Sitemaps je Sprache unter `/sitemap/{locale}.xml`, zur Anfrage erzeugt. `robots.txt` und `X-Robots-Tag: noindex` außer Prod (`SITE_INDEXABLE=true`).
- **Neue Abhängigkeit (nur dev):** `@axe-core/playwright` 4.14.0, für die automatische WCAG-Prüfung laut Review A12.
- **Doku:** ADR 015, ADR 003 (Slugs, Matcher), SPEC v0.7 (`published_at`/`approved_at`, Sichtbarkeit, Anbieterprofil, zwei Rechtsfragen in 7.2), Glossar (URL-Wörter, Begriffe).
- **Tests:**
  - pgTAP `25_publication_fields`, `26_search_listings` (dieselbe Menge für anon, Besitzer, Admin, gesperrten Besitzer und `service_role`), `27_public_page_state`
  - Integration `search.test.ts` (Filter-Fixture gegen die RPC) und `reference-data.test.ts`
  - Vitest für Parser, Filter (gleiche Fixture wie die DB), `safeNextPath`, JSON-LD, robots und 410-Seite
  - E2E `public.spec.ts`

### Testen
- `supabase db reset && supabase test db` (641), danach E2E und ohne Reset noch einmal `supabase test db`: grün, keine `@test.local`-Konten übrig
- `cd web && npm test` (345), `npm run test:integration` (160), `npm run test:e2e` (52)
- Manuell:
  1. Eine Anzeige freigeben (M4). Danach erscheint sie unter `/de`, `/de/jagdpacht` und `/de/jagdpacht/bayern/…` und in der Suche.
  2. `curl -I /de/anzeige/<id>` gibt 200. Nach `update listings set status='paused'` gibt es 410. Ein Entwurf gibt 404.
  3. Sprachumschalter auf `/de/jagdpacht/bayern` führt zu `/en/hunting-lease/bayern`.
  4. `/sitemap/de.xml` und `/robots.txt` lesen (lokal `Disallow: /`).

### Messung (Review A2)
10.000 synthetische Anzeigen (200 Konten), als anon, lokal, Transaktion mit Rollback:

| Fall | Laufzeit `search_listings` |
|---|---|
| neueste | 39 ms |
| Art und Land | 140 ms |
| Bundesland | 38 ms |
| Volltext | 86 ms |
| Preis mit Währung | 47 ms |
| Wildart | 158 ms |

Die Hauptabfrage nutzt `listings_published_idx` (1–2 ms). Den Rest kosten die Gesamtzahl bis 1001 Zeilen (mit `is_active_user` je Zeile) und die Karten. Das liegt unter 1 s (SPEC 8). Bei mehr Daten zuerst die Zählung prüfen.

### Akzeptanz (SPEC 6 M5)
- [x] Filtern nach Land, Region, Art und Preis liefert korrekte Ergebnisse (pgTAP `26`, E2E „Akzeptanz a“)
- [x] Preise in Originalwährung mit passender Locale, ohne Umrechnung (E2E „Akzeptanz b“ gegen `Intl` derselben Laufzeit, de/en/cs/pl × EUR/CZK)
- [x] Nicht freigegebene Anzeigen sind weder abrufbar (404, auch für den eingeloggten Besitzer) noch indexierbar (`noindex`, nicht in Sitemap und Suche), E2E „Akzeptanz c“
- [x] Nutzer-Ergänzung: Entfernen, Sperren und Konto-Löschung wirken sofort in Listen, Detail und Fotos (E2E „Sofortige Wirkung“), normale Änderungen nach höchstens 5 Minuten

### Bekannte Lücken
- **iOS (I2):** nutzt `search_listings`, `provider_listings` und `public_page_state` unverändert und lädt Fotos über die Storage-API mit Anon-Key; noch nicht umgesetzt.
- Karte (M6), Kontakt per Chat (M7; der Button weist bis dahin darauf hin), Suchaufträge (M8, übernehmen Filter v1), Melden (M9), statische Seiten „Über uns“, „So funktioniert es“, FAQ, Richtlinien (M9/M10).
- Neue und bearbeitete Anzeigen erscheinen in gecachten Listen nach bis zu 5 Minuten (ADR 015). Auf mehreren Instanzen beschleunigen die Tags nur die eigene; die Garantie geben Cache-Dauer und Cache-Zähler.
- Pausierte Anzeigen antworten mit 410 und werden nach dem Fortsetzen langsamer neu indexiert (ADR 015).
- Volltext ohne Zerlegung von Komposita und ohne Diakritika-Faltung für cs/pl (ADR 015).
- URL-Wörter in cs/pl sind ungeprüft (Glossar). Rechtsfragen zu Anbieterangaben (DSA) und Begründung per E-Mail stehen in SPEC 7.2.
- Cloud-Checkliste (M10): Statement-Timeout für `anon`, Rate-Limit oder WAF für Suche und Foto-Route, `SITE_INDEXABLE=true` nur in Prod.

## Nachtrag M4: QA-Funde F1–F6 – 2026-10-30

Bericht: `docs/QA-REPORT.md`, Abschnitt „M4 – Abnahme“.

### Geändert
- **F1 Pfade und Status:** Der Proxy entscheidet über die kanonische Form des Pfads (`canonicalPath`: vollständig dekodiert, Schrägstriche normalisiert). Geschützte Pfade in anderer Schreibweise (`/de/%61dmin`, `/de//admin`, `/de%2Fadmin`) leiten per 308 auf die kanonische Form, ungültige Kodierung gibt 400. Damit gelten Rollenprüfung, 403, Login-Redirect, Nonce-CSP und `X-Robots-Tag` auf jedem Weg. **Korrektur:** `export const instant = false` macht das Rendern nicht blockierend, es nimmt die Seite nur aus der Instant-Navigation-Prüfung. Den Status setzt allein der Proxy, die Prüfung in der Seite autorisiert nur (ADR 014 mit Quelle, Kommentare in allen Seiten). Das gilt auch für den Eintrag zu M3 F1 unten: Entscheidend war dort das Entfernen der Suspense-Grenzen.
- **F2 TOTP:** Ein falscher Code bei der Ersteinrichtung behält Faktor, QR-Code und Schlüssel; die Meldung steht am Feld. Ohne JavaScript ist der Knopf gesperrt, `<noscript>` nennt den Grund (Secret gibt es nur einmal, Next rendert den Action-Zustand ohne JS nicht, Cookie/URL schließt Review B3 aus). Die Code-Eingabe für einen bestehenden Faktor geht weiter ohne JS.
- **F3 Ernennen:** `grant_admin` verlangt eine eigene Kontosuche per E-Mail für dasselbe Konto in der letzten Stunde (`42501`, Hint `lookup_required`); `?candidate=<id>` allein zeigt kein Formular mehr (Migration `grant_requires_lookup`).
- **F4 Prüfansicht:** Fremde Entwürfe ergeben 404, entschiedene Anzeigen zeigen nur Titel und Status. Version und Waffenbegriff-Hinweise gibt es für Admins nur bei `pending_review` (Migration `review_only_pending`).
- **F5 Kontosuchen:** `private.admin_lookups` mit Fremdschlüssel auf `auth.users` (Kaskade) und Bereinigung älter als 1 Stunde bei jeder Suche (Migration `admin_lookups_cleanup`).
- **F6 Oberfläche:** Übersicht zählt ohne eigene Anzeigen wie die Warteschlange; Karenz und Limits kommen aus `private.app_settings` (RPC `admin_role_rules`, Migration `admin_role_rules`); Audit-Details mit übersetzten Schlüsseln, Status, Grund-Vorlagen und Weg; Code-Felder zum Entziehen mit Namen im Label; Entscheidungsfehler per `aria-describedby` am Feld.
- **Aufräumen:** `e2e/auth.spec.ts` löscht seine Testkonten.

### Testen
- `supabase db reset && supabase test db` (553), danach `npm run test:e2e` und ohne Reset noch einmal `supabase test db`: grün, keine `@test.local`-Konten übrig
- `cd web && npm test` (178), `npm run test:integration` (117), `npm run test:e2e` (38, ohne `test.fail`)
- Produktions-Build: `npm run build && npx next start -p 3456`, dann `QA_BASE_URL=http://localhost:3456 npx playwright test e2e/admin.spec.ts e2e/qa-m4.spec.ts` (19)
- manuell: `curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://localhost:3456/de/%61dmin` → `308 …/de/admin`

### Bekannte Lücken
- TOTP-Einrichtung braucht JavaScript (siehe F2, ADR 014).
- Fällt die Rolle in den Millisekunden zwischen Proxy und Seite weg, sieht der Nutzer „Kein Zugriff“ mit `noindex`, aber Status 200 (keine Daten).

## M4 Admin-Bereich (Freigabe) – 2026-10-30

Plan `docs/plans/M4-plan.md` mit Architekt-Review (Abschnitte 10/11), ADR 014.

### Geändert
- **Migrationen:**
  - `moderation_fields`: `reject_code` (Grund-Vorlage) plus optionaler Freitext mit Constraints, `submitted_at` mit Index für die Warteschlange, Trigger für Grund und Zeitpunkt auf allen Pfaden, Inhalts-Hash ohne diese Spalten. Moderation nur noch über die RPC (Flag im Guard), Moderatoren ändern keine fremden Inhalte (außer Kartenpunkt entfernen), `is_admin` nur für aktive Konten.
  - `moderate_listing`: RPC (security invoker) für Freigeben, Bearbeitung anfordern, Ablehnen, mit Zeilensperre und Versionsvergleich (`RV003` bereits entschieden, `RV004` inzwischen geändert); `admin_listing_version`, `admin_review_queue`; Waffenbegriff-Hinweise auch für Admins.
  - `admin_roles`: `grant_admin`, `revoke_admin` mit Step-up (frischer TOTP-Code laut Claim `amr`, `RV005`), 3 je Admin und 10 insgesamt in 24 h, 7 Tage Karenz, letzter Admin geschützt; Audit per Trigger auf `private.user_roles`; `admin_find_user` (exakte E-Mail, Rate-Limit, Audit), `admin_list_admins`, `admin_access`.
- **Supabase:** TOTP-MFA lokal an (`config.toml`).
- **Web:**
  - Zugang: Proxy prüft `/admin` per RPC (403-Rewrite ohne Rolle) und setzt eine Nonce-CSP; jede Seite und Action prüft `requireAdmin()` mit `getUser()` und ruft sonst `forbidden()`. (Korrigiert nach QA M4 F1: Den Status setzt nur der Proxy, `instant = false` macht das Rendern nicht blockierend.)
  - `/admin/mfa`: TOTP einrichten nur per POST, Code-Eingabe ohne JS.
  - `/admin/listings`: Warteschlange; `/admin/listings/[id]`: Prüfansicht mit Fotos (signierte URLs, 10 min) und Entscheidung.
  - `/admin/audit`: Audit-Log mit Filter; `/admin/admins`: Admins ernennen und entziehen mit frischem Code.
  - „Meine Anzeigen“ und Assistent zeigen den Grund in der Sprache des Besitzers plus Freitext.
  - `ListingSummary` aus der Vorschau ausgelagert (Besitzer und Moderation sehen dasselbe).
- **Doku:** ADR 014; ADR 005 (Ernennung per UI, Runbooks erster und kompromittierter Admin), ADR 010 (Nonce-CSP für `/admin`), ADR 013 (Hash-Ausschlüsse, Moderation); SPEC v0.6; Glossar (Moderation, Grund-Vorlagen).
- **Tests:** pgTAP `21_moderation_fields`, `22_moderate_listing`, `23_admin_roles`; API-Tests `admin.test.ts` mit echtem aal2; E2E `admin.spec.ts` (auch gegen den Produktions-Build lauffähig); TOTP-Helfer `integration/totp.ts` ohne neue Abhängigkeit.

### Testen
- `supabase stop && supabase start` (TOTP in `config.toml`), dann `supabase db reset && supabase test db` (506)
- `cd web && npm test` (161), `npm run test:integration` (117), `npm run test:e2e` (25)
- Manuell:
  1. Konto anmelden, per Runbook (ADR 005) zum Admin machen: `supabase db query --local "insert into private.user_roles (user_id, role, created_at) select id, 'admin', now() - interval '7 days' from auth.users where email = '<deine Adresse>'"`
  2. `/de/admin` öffnen, Authenticator einrichten (QR-Code oder Schlüssel), Code eingeben.
  3. Mit einem zweiten Konto eine Anzeige absenden; als Admin unter „Zur Warteschlange“ freigeben, zurückgeben oder ablehnen; das zweite Konto sieht Status und Grund in „Meine Anzeigen“.
  4. Ein Konto ohne Rolle bekommt auf `/de/admin` die Seite „Kein Zugriff“ (HTTP 403).

### Akzeptanz (SPEC 6 M4)
- [x] Freigegebene Anzeige wird sichtbar: `active` mit Ablaufdatum, für anon lesbar (`admin.test.ts`, `22_moderate_listing`, E2E); öffentliche Seiten folgen in M5
- [x] Abgelehnte Anzeige zeigt den Grund im Dashboard („Meine Anzeigen“, in der Sprache des Besitzers; E2E auf Polnisch)
- [x] Nicht-Admins erhalten 403 (echter HTTP-Status auf allen Admin-Seiten, E2E auch gegen den Produktions-Build)

### Bekannte Lücken
- **iOS (I4):** Den Grund zeigt die App erst ab I4; die Grund-Codes gehören dann mit denselben Glossar-Begriffen in den String Catalog. Admin bleibt reines Web (SPEC 5).
- **Eigene Anzeigen von Admins:** Kein Admin moderiert die eigene Anzeige (Vier-Augen-Prinzip), die Warteschlange zeigt sie ihm nicht. Gibt es nur einen Admin, bleibt dessen eigene Anzeige liegen, bis ein zweiter ernannt ist.
- **Nicht im Umfang:** Verifizierungen, Meldungen, Nutzer sperren, Anzeigen entfernen (spätere Schritte); Benachrichtigung des Besitzers per Mail/Push (M8).
- **Tests:** Ein E2E-POST auf eine Admin-Server-Action als Nicht-Admin fehlt; dass jede Action `requireAdmin()` aufruft, sichert `guards.test.ts`. Gleichzeitiges Entziehen durch zwei Admins ist nur über die Sperre im Code abgesichert, nicht parallel getestet. Der letzte Admin ist per pgTAP geprüft, nicht per E2E. Ein eigener Commit „E2E“ entfiel, die Tests entstanden mit den Commits 6–10.
- **Rechtliches:** Begründung nach DSA Art. 17 (AGB-Bezug, Rechtsbehelf) klärt der Anwalt; Grund-Texte bleiben vorläufig, cs/pl ungeprüft.
- **Restrisiko:** TOTP-Codes lassen sich mit einer `aal1`-Session raten; Schutz sind die Supabase-Limits (ADR 014).

### Cloud-Checkliste (neu)
- TOTP enroll/verify aktiv und nach dem Deploy geprüft; `max_enrolled_factors`; Rate-Limits für Token- und MFA-Prüfungen
- Custom Access Token Hook aktiv (sonst kein Link „Admin“ im Kopf; Rechte hängen nicht daran)
- Session-Timeouts (`inactivity_timeout`, `timebox`) setzen, sonst gilt aal2 so lange wie das Refresh-Token
- Erster Admin per Runbook (ADR 005); beim Account löschen (M9) nachweisen, dass MFA-Faktoren und Rollen mitgelöscht werden

## Nachtrag M3: QA-Funde F1–F10 – 2026-10-30

Bericht: `docs/QA-REPORT.md`, Abschnitt „M3 – Abnahme“.

### Geändert
- **F1 Ohne JavaScript:** Konto, „Meine Anzeigen“, „Neu“ und „Bearbeiten“ rendern blockierend (`export const instant = false`, keine Suspense-Grenze um den Inhalt). Vorher kam der Inhalt gestreamt in `<div hidden>` und erschien nur mit JS. Die Fotoauswahl ist ohne JS gesperrt, `<noscript>` nennt den Grund. **Regel für M5:** Öffentliche Seiten dürfen ihren Hauptinhalt nicht hinter einer Suspense-Grenze streamen, die erst ein Skript einsetzt.
- **F2 Leerraum:** neue Funktion `private.trim_all` (dieselben Zeichen wie `String.prototype.trim`) für Titel, Alt-Text, Textattribute, PLZ/Ort und die Pflichtlänge der Beschreibung (Migration `listing_whitespace`). Zod zählt Längen in Codepoints wie `char_length`. Neue gemeinsame Fälle in `listing_rules.json`, ADR 013 mit Zeichenliste (auch für iOS).
- **F3 Preis:** Ohne gespeicherten Preis ist keine Option vorgewählt. Ein eingetragener Betrag ohne gewählte Option gilt als Betrag, bei „Keine Angabe“/„Auf Anfrage“ mit Betrag gibt es den Fehler `price_conflict`. Die Option heißt „Betrag angeben“.
- **F4 Aufräumen:** `e2e/cleanup.ts` löscht Testkonten samt Dateien (`listings.spec.ts`, `qa-m3.spec.ts`); `08_storage` zählt nur Dateien der eigenen Testnutzer.
- **F5 Art und Richtung:** In Prüfung, aktiv und pausiert stehen sie fest (gesperrt mit Hinweis). Für eine andere Art gibt man eine neue Anzeige auf.
- **F6 Entwurf löschen:** Fotodateien werden nur entfernt, wenn die Anzeige beim Lesen noch ein Entwurf ist.
- **F7 Barrierefreiheit/Fotos:** Hinweis auf übersprungene Fotos bleibt stehen; Ersatz-Alt-Text „Titel, Foto n von m“; Alt-Text-Felder nennen die Fotonummer; Originale über 40 MB oder 50 MP werden vor dem Dekodieren abgelehnt; kein `aria-invalid` auf `fieldset`.
- **F8 Doku:** SPEC v0.5 (3.1 Fotospalten, `listing_places`, `postal_prefix`, PLZ-Tabellen; 3.2 Attribute und Pflichtangaben, `species_targeted[]` entfällt; 3.3 Versatz nach ADR 006 v2), Glossar mit Attributen, Auswahlwerten und Preiseinheiten, ADR 011 (CORS `*` begründet, Aufräumen, Client-Grenzen).
- **F9 Wildart:** cs „Ostatní dravá zvěř“ ist laut Produkt korrekt und bleibt. Wildarten und Kreise sind im Web mit `cacheLife("days")` gecacht (siehe Cloud-Checkliste unten).
- **F10 Tests:** Fehlerzuordnung der DB in `lib/listing-errors.ts` mit Vitest; E2E für die Meldung „Tageslimit erreicht“; Integrationstests überspringen ohne Supabase, statt abzubrechen; ADR 013 warnt vor `seed.sql` auf Preview-Branches.

### Testen
- `supabase db reset && supabase test db` (424)
- `cd web && npm test` (153), `npm run test:integration` (111), `npm run test:e2e` (19)
- danach ohne Reset noch einmal `supabase test db`: bleibt grün (F4)
- manuell: Browser mit abgeschaltetem JavaScript, `/de/account/listings/new` → Assistent bis „Zur Prüfung absenden“

### Cloud-Checkliste (neu)
- Nach einer Migration mit Referenzdaten (Wildarten, Kreise, PLZ) den Web-Cache leeren bzw. neu deployen; sonst erscheinen Änderungen erst nach Tagen.
- Vor Supabase Branching den Seed für Preview-Branches abschalten (ADR 013, Rate-Limit).

### Bekannte Lücken
- Dieselbe Leerraum-Regel fehlt noch für Profilnamen, gespeicherte Suchen, Chatnachrichten und Moderationsgründe (`btrim`); sie folgt mit M6/M7/M4.
- `maxLength` im Browser zählt UTF-16-Einheiten: Titel aus vielen Emoji kürzt der Browser früher als die DB erlaubt (harmlos, strenger).
- `/account/profile`, `/welcome`, `/login` und `/auth/confirm` (M2) streamen ihren Inhalt weiter und sind ohne JavaScript leer. Sie gehören nicht zu M3; Umstellung wie bei F1, sobald sie angefasst werden.

## Nachtrag M3: Dev-Server und Wildart – 2026-10-30

### Geändert
- **Web:** `allowedDevOrigins: ["127.0.0.1"]` in `next.config.ts`; vorher blieb `next dev` unter `127.0.0.1` in einer HMR-Schleife („Compiling“)
- **Migration `species_other_predators`:** neue Wildart `other_predators` („Sonstiges Raubwild“, en/cs/pl im Glossar, cs/pl ungeprüft)

### Testen
- `supabase db reset && supabase test db` (Wildartenzahl jetzt 15)
- Dev-Server neu starten (Wildarten sind einige Tage gecacht), dann Assistent → „Details“: „Sonstiges Raubwild“ steht in der Liste
- `http://127.0.0.1:3000/de` lädt ohne Reload-Schleife

## M3 Anzeigen erstellen (Web) – 2026-10-30

### Geändert
- **Doku:** Plan `docs/plans/M3-plan.md` mit Architekt-Reviews; ADR 006 (Standortverfremdung v2), ADR 011 (Fotoverarbeitung), ADR 012 (Postleitzahlen), ADR 013 (Anzeigenregeln, Vertrag für Web und iOS); SPEC 3.3 und 7; Glossar (Arten, Richtungen, Status)
- **Migrationen:**
  - `listing_location_v2`: verfremdeter Punkt je Besitzer und Kreis (HMAC, Secret im Vault, Fingerprint)
  - `listing_photo_processing`, `photo_processing_function`: privater Eingang nur für JPEG, verarbeitete Bilder nur vom Server, Tageslimit, höchstens 3 Verarbeitungsversuche
  - `postal_codes`, `postal_codes_data`: PLZ DE (OpenStreetMap, VG250) und AT (Statistik Austria), Generator mit Prüfsummen unter `supabase/data/postal_codes/`
  - `listing_places`: PLZ und Ort je Anzeige, nie öffentlich; öffentlich nur `postal_prefix`; RPC `set_listing_location`
  - `listing_rules`: Attribute je Art, Preisgrenzen, Bereitschaftsprüfung am Ende der Transaktion, Legal-Gate `RV001`, Rate-Limit `RV002` (3 bzw. 10 in 24 h), Freigabe-Hash, Admin an der eigenen Anzeige = Besitzer
  - `listing_content_hints`: Hinweis auf Waffen- und Munitionsbegriffe in 4 Sprachen
  - `reorder_listing_photos`: Reihenfolge der Fotos in einem Schritt
- **Edge Function `process-listing-photo`:**
  - vendored JPEG-Codec aus imagescript 1.3.0
  - strenger Header-Parser, Grenzen 8 MP Baseline und 5 MP progressiv
  - entfernt alle Metadaten, `deno.lock`, CI-Job `functions`
- **Web:**
  - „Meine Anzeigen“ (`/account/listings`) mit Status, Ablehnungsgrund, Zurückziehen, Pausieren, Fortsetzen und Entwurf löschen
  - Assistent `/account/listings/new` und `/[id]/edit` mit 6 Schritten: Grunddaten, Ort, Details, Fotos, Preis und Zeitraum, Vorschau und Absenden
  - Fotos werden im Browser nach JPEG gewandelt und verkleinert; HEIC wird abgelehnt
  - Services `listings`, `regions`, `photos`; Zod-Regeln mit gemeinsamen Fixtures (`supabase/tests/fixtures/listing_rules.json`); Preisumrechnung ohne Gleitkomma
- `supabase/seed.sql` hebt das Anzeigen-Limit nur lokal an (API- und E2E-Tests)
- **Neue Abhängigkeiten,** nur in der Edge Function:
  - JPEG-Codec (WASM) aus imagescript 1.3.0, vendored, MIT
  - `@supabase/supabase-js` 2.117.3
  - Begründung in ADR 011
- Im Web keine neuen Abhängigkeiten.

### Wie testen
```sh
supabase stop && supabase start      # Neustart nötig: config.toml (Edge Function) geändert
supabase db reset && supabase test db   # 410 Tests
# Deno-Tests der Function (Deno aus Docker, keine Installation nötig)
docker run --rm -v "$PWD/supabase/functions:/fn" -w /fn/process-listing-photo denoland/deno:2.1.4 \
  sh -c "deno task check && deno lint && deno task test"   # 24 Tests
cd web
npm run lint && npm run typecheck && npm test   # 143 Vitest-Tests
npm run test:integration             # 104 API-Tests, u. a. Fotoverarbeitung, Regeln, Parität DB/Zod
npm run test:e2e                     # 10 Kernflows, davon 3 Inserieren
```
Manuell: `npm run dev`, anmelden, „Mein Konto“ → „Meine Anzeigen“ → „Anzeige aufgeben“. Freigeben kann nur die Moderation, ab M4 im Admin-Bereich. Bis dahin geht es lokal so: `update listings set status = 'active', expires_at = now() + interval '30 days' where id = '…'` in Studio.

### Akzeptanz
- [x] Assistent für alle 5 Arten (E2E: Pacht vollständig mit Foto, die anderen 4 über die Pflichtfeld-Prüfung)
- [x] Foto-Upload: Verkleinerung im Browser, höchstens 8 Fotos, Metadaten serverseitig entfernt (Deno-Tests, `photo-processing.test.ts`; über den ganzen Weg mit JPEG/GPS und WebP/EXIF in `qa-m3.spec.ts`, Spike-Auflage 5 damit erfüllt)
- [x] Preisfeld mit Währung, Umrechnung in `price_minor` ohne Gleitkomma (Vitest, Grenzen wie in der DB)
- [x] Entwurf wird nach jedem Schritt gespeichert; Absenden setzt `pending_review` (E2E, `listings.test.ts`)
- [x] Anzeige erscheint in „Meine Anzeigen“ mit Status, ohne Aktion zum Freischalten (E2E)
- [x] Pflichtfelder je Art werden validiert: in DB und Zod mit denselben Feldcodes (`17_listing_rules`, `listing-rules-parity.test.ts`, E2E)
- [x] Pflichtpunkte des Plans: Standort nicht herausmittelbar (`12_location`, `location.test.ts`); der Nutzer setzt nie selbst `active` (Statusmatrix in `17_listing_rules`, `listings.test.ts`)
- [x] Texte in 4 Sprachen. cs/pl sind ungeprüft (Glossar).

### Bekannte Lücken
- **iOS (I4):** Inserieren fehlt in der App. Der Vertrag steht in ADR 011, 012 und 013.
- **Freigabe:** Der Admin-Bereich folgt in M4. Dort kommen auch die Moderations-Detailansicht mit PLZ und die Markierung über die Waffenbegriffe.
- **Fotoverarbeitung in der Cloud:** Die Messung in eu-central-1 steht noch aus (Spike-Auflage 3). Sie ist Blocker für den Go-live.
- **Aufräumjob (M9):**
  - verwaiste Eingangsdateien nach Abbrüchen
  - Dateien ohne Zeile
  - Entwürfe nach 12 Monaten Inaktivität, mit Hinweis vorab (SPEC 7.3)
- **Seite „Datenquellen“** mit ODbL-Download der PLZ-Tabelle folgt mit M5/M9. Die Namensnennung steht bereits am PLZ-Feld.
- **Karte:** M3 nutzt nur den Kreis. Die Verfremdung des Punkts ist gebaut und getestet, eine Kartenauswahl gibt es noch nicht (SPEC 7.10).
- **Märkte CH, CZ, PL:** Dort gibt es noch keine Kreise und PLZ, deshalb ist das Inserieren nur in DE und AT möglich.
- **Ohne JavaScript:** Fotos lassen sich nur mit JavaScript hochladen. Alle anderen Schritte gehen ohne (seit dem QA-Nachtrag tatsächlich, siehe dort F1).
- **Pflichtangaben je Art:** Der Anwalt prüft sie noch (SPEC 7.2).

## M2 Auth und Profil (Web) – 2026-10-29

### Geändert
- SPEC v0.4, ADR 010 (Anmeldung, Session, AGB-Zustimmung, CSP), ADR 002 (Cloud verschoben), Glossar „Konto und Anmeldung“
- Migration `legal_acceptances`:
  - RPCs `accept_legal` und `legal_status`
  - DB-Gate `private.has_accepted_current_legal()`
  - Versionen in `app_settings`
- `supabase/config.toml`:
  - Bestätigung aktiv, OTP 10 Minuten
  - Redirect-URLs nur für `/*/auth/confirm` und `/*/auth/callback`
- Mailvorlagen `confirmation` und `magic_link` in 4 Sprachen (Link und Code)
- Web:
  - Session-Refresh im Proxy, geschützte Pfade, geprüfte Rücksprungziele
  - Login per Code und Link: Code anfordern und prüfen im Browser, Link bestätigt erst per Button
  - Logout
  - Onboarding `/welcome` mit Profil und AGB-Häkchen
  - `/account`, `/account/profile`
  - Sign in with Apple hinter `NEXT_PUBLIC_AUTH_APPLE_ENABLED`
  - Platzhalterseiten Nutzungsbedingungen und Datenschutz (`noindex`)
  - feste CSP
- Service-Schicht `web/lib/services/{auth,profile,legal,gate}.ts`, Zod-Schemas in `web/lib/validation/`
- Neue devDependency `@playwright/test` 1.64.1, CI-Job `e2e` in `web.yml`

### Wie testen
```sh
supabase stop && supabase start      # Neustart nötig: config.toml und Mailvorlagen wurden geändert
supabase db reset && supabase test db   # 240 Tests
cd web
npm run lint && npm run typecheck && npm test   # 68 Vitest-Tests
npm run test:integration             # 40 API-Tests gegen die lokale Supabase (Storage, PostgREST, Auth, Mails)
npx playwright install chromium      # einmalig
npm run test:e2e                     # 7 Kernflows; nutzt einen laufenden Dev-Server oder startet einen
```
Manuell: `npm run dev`, dann http://localhost:3000/de/account öffnen. Die Seite leitet auf den Login um. Die Mail kommt in Mailpit unter http://127.0.0.1:54324 an.

### Akzeptanz
- [x] Registrieren (per Link und per Code), ausloggen, wieder einloggen (per Code und per Link): `e2e/auth.spec.ts`
- [x] Profil bearbeiten, inklusive gewerblich mit Firmenname und Wechsel zurück auf privat (E2E, Vitest, `02_profiles`)
- [x] Geschützte Seiten leiten auf den Login um und kehren danach zum Ziel zurück, fremde Ziele werden ignoriert (E2E, Vitest)
- [x] AGB-Zustimmung ist Pflicht und je Version gespeichert, eine neue Version verlangt erneute Zustimmung (`10_legal`, API-Tests; im UI von der QA manuell geprüft, kein E2E)
- [x] Session-Handling mit `@supabase/ssr`: Refresh im Proxy, `getClaims` per JWKS (ES256)
- [x] Texte in 4 Sprachen. cs/pl sind ungeprüft (Glossar).

### Bekannte Lücken
- **Sign in with Apple** ist eingebaut, aber aus. Es fehlt ein Apple-Developer-Account (SPEC 7.1), deshalb ist es nicht E2E-getestet.
- **Account löschen**, E-Mail ändern, Datenexport und Benachrichtigungen folgen in M9. Bis dahin ist die UGC-Pflicht „Account löschen“ im Web offen.
- **Captcha** fehlt noch, bis dahin schützen nur die Rate-Limits von Supabase. Die Captcha ist harter Punkt der Release-Checkliste vor dem Go-live.
- **Cloud-Projekt** noch nicht verbunden (ADR 002). Checklisten in ADR 005 und 010.
  - Lokal gilt ein Mail-Abstand von 5 s, in der Cloud 60 s.
  - Die Cloud braucht eigenes SMTP über einen EU-Anbieter (SPEC 7.11).
- **iOS (I1):** Login per Code, `accept_legal(…, 'ios')` und Onboarding fehlen noch und werden in I1 nachgezogen.
- `script-src 'unsafe-inline'` bis zur Nonce-CSP in M4 (`/admin`) bzw. M10.
- Rechtstexte sind Platzhalter, bis der Anwalt liefert.
- Die Sprache in Kopfzeile und Formularen folgt der URL. Die Profilsprache steuert nur die Mails (Cookie für die Locale: QA M0 F7, M9).

### Nachtrag nach QA und Architekten-Review (2026-10-29)
Berichte: `docs/QA-REPORT.md` (M2) und `docs/reviews/M2-architekt.md`.
- **Keine Passwörter (QA F1, hoch):** Supabase Auth nahm trotz passwortloser App Passwörter an, mit Folge Kontoübernahme vor der Registrierung. Der Trigger `discard_password` leert jetzt jeden Passwort-Hash in `auth.users`.
- **Mailvorlagen (Architekt 1):** Die Sprache im Link ist je Zweig fest. Ein API-Test prüft über Mailpit die Kodierung.
- **Anmeldeprüfung (Architekt 2):** Ein Vitest erzwingt sie in jeder geschützten Seite und Server Action.
- **Session-Erneuerung (Architekt 3):** Ein E2E prüft das abgelaufene Access-Token und die rotierten Cookies auf dem Redirect.
- **XSS-Hygiene (Architekt 4):** ADR 010 nennt jetzt, dass das Refresh-Token per JS lesbar ist. ESLint verbietet `dangerouslySetInnerHTML`.
- **Fehlercode `RV001` (Architekt 9):** Er meldet die fehlende Zustimmung (`private.require_current_legal()`), damit Web und iOS ihn ab M3 auswerten können.
- **Footer (QA F3, Architekt 11):** Impressum (Platzhalter), Datenschutz und Nutzungsbedingungen sind auf jeder Seite verlinkt, beim Login steht ein Datenschutz-Hinweis.
- **API-Tests (Auflage M1, QA F6):** `web/integration/` läuft in der CI im Job `e2e`. Die pgTAP-Zählungen sind unabhängig von E2E-Resten.
- **Gesperrte Konten (QA F4):** Sie ändern ihr Profil nicht mehr und sehen einen klaren Hinweis.
- **Metadaten (Architekt 7):** Kein Anzeigename aus `user_metadata` mehr, ADR 008 sieht einen Löschjob für nie bestätigte Konten vor (M9).
- **Konten-Aufzählung (QA F2):** Die Aufzählung über die Auth-API bleibt als Restrisiko bis zur Captcha in ADR 010 dokumentiert.

Noch offen (vor dem ersten Deploy bzw. später):
- Captcha mit ADR, Cloud-Checkliste vervollständigen (Architekt 5), Link-Bestätigung und IP-Limit in Staging prüfen (QA F5)
- Mail-Sprache per DB-Trigger statt Client-Aufruf (Architekt 10)
- `otp_length` vor I1 (Architekt 6)
- Apple-Token-Widerruf bei Löschung vor M9/I6 (Architekt 8)
- CI-Traces und Rate-Limits der E2E-Suite (Architekt 14)
- Kleinigkeiten aus Architekt 15 und 16

## M1 Datenbank und Sicherheit – 2026-10-29

### Geändert
- SPEC v0.3 mit den Entscheidungen zu Startregion (7.4), Retention (7.3) und Pausieren/Fortsetzen (3.4); ADRs 005–009
- 9 Migrationen unter `supabase/migrations/`:
  - Fundament: Enums, Schema `private`, Admin-Rolle mit 2FA, Access Token Hook, `app_settings`
  - `profiles` mit `public_profiles`
  - Regionen DE/AT (16 + 401, 9 + 94) und 14 Wildarten
  - Anzeigen mit Statuslogik, Standortverfremdung, Fotos und Wildarten
  - Favoriten und Suchaufträge
  - Chat und Blockieren
  - Meldungen, Verifizierungen, Bewertungen (gesperrt), Geräte, Audit-Log
  - Storage-Buckets mit Policies
- `supabase/data/regions/`: Generator, Quellen und Lizenzen
- pgTAP-Tests unter `supabase/tests/` (nach Review 205), dazu ein Meta-Test: jede Tabelle hat RLS und eine Policy, `private` ist gesperrt
- CI `supabase.yml`: `db reset`, `test db`, Prüfung der generierten Typen, `db lint`
- `web/lib/supabase/database.types.ts` (`npm run gen:types`), Server-Client typisiert

### Wie testen
```sh
supabase stop && supabase start      # Neustart nötig: config.toml (Hook, auto_expose) wurde geändert
supabase db reset                    # alle Migrationen inkl. Regionendaten
supabase test db                     # 205 Tests
supabase db lint -s public,private --level warning
cd web && npm run gen:types && git diff --exit-code lib/supabase/database.types.ts
```

### Akzeptanz
- [x] Nutzer A liest keine Nachrichten von B (`06_chat_blocks`)
- [x] Nutzer A liest keine Verifizierungsdokumente von B, weder in der Tabelle (`07_trust_audit`) noch im Bucket (`08_storage`, zusätzlich über die Storage-API geprüft)
- [x] Nutzer A liest keine Entwürfe von B (`04_listings`)
- [x] Migrationen für alle Tabellen aus SPEC 3, Enums, Indizes, Regionen DE/AT und Wildarten
- [x] RLS-Policies mit automatisierten Tests

### Nach Review (Architekt und QA, docs/QA-REPORT.md)
- `service_role` hat CRUD-Rechte (Server-Pfade). API-Rollen haben kein TRUNCATE/REFERENCES/TRIGGER mehr.
- Profile:
  - Fallback-Name ist „Nutzer“.
  - Öffentlich erscheinen nur Anbieter mit öffentlicher Anzeige, dazu sehen Chatpartner einander.
  - Öffentlich sichtbar ist nur „verifiziert“.
- Fotos:
  - `storage_path` ist an Besitzer und Anzeige gebunden.
  - Upload erst nach Registrierung, das Limit von 8 gilt damit auch im Bucket.
  - Verwaiste Dateien sind nicht lesbar.
- Gerätetoken nur noch per RPC `register_device`.
- Kein GraphQL. Fremde Sperren sind nicht abfragbar.
- Chats bleiben beim Löschen einer Anzeige erhalten.
- Gesperrte Nutzer löschen keine Anzeigen, Admins entfernen per `removed`.
- Moderatoren-IDs sind für Nutzer unsichtbar.
- Admins geben keine eigenen Anzeigen frei.
- 205 pgTAP-Tests.

### Bekannte Lücken
- **Für Web-Code (M2):** `reports` und `verifications` haben Spalten-GRANTs. `select=*` schlägt dort fehl, Spalten müssen ausdrücklich genannt werden.
- **Cloud-Checkliste für M2:** steht in ADR 005.
- **Performance:** `is_active_user()` läuft in der öffentlichen Anzeigen-Policy pro Zeile. Vor M5 messen und bei Bedarf denormalisieren.
- **Standort:** Über mehrere Anzeigen desselben Reviers lässt sich der Originalpunkt herausmitteln. Bis M3 offen, siehe ADR 006.
- Rechtlich zu prüfen: Retention-Fristen und Löschregeln sind Platzhalter (ADR 008, SPEC 7.2/7.3).
- Die Lösch- und Retention-Jobs fehlen noch (M9). Gelöschte Datensätze hinterlassen bis dahin Dateien in Storage.
- `attributes` wird in M1 nur auf seine Form geprüft. Pflichtfelder je Anzeigenart folgen in M3.
- Für TOTP-2FA braucht es in M4 noch `enroll`/`verify`. In M1 wird `aal2` nur in Tests simuliert.
- Rate-Limits und Spam-Erkennung für Nachrichten fehlen noch (M7). Meldungen sind auf 20 pro 24 h begrenzt.
- cs/pl-Namen (Wildarten, Länder) sind ungeprüft (SPEC 7.6).
- Die Seite „Datenquellen“ mit den Pflichtvermerken BKG und Statistik Austria fehlt noch (M5/M9).
- In der Cloud müssen Hook, `auto_expose_new_tables = false` und die Buckets in M2 ebenso eingerichtet werden.
- Die CI ist noch nicht gelaufen, weil das GitHub-Remote fehlt.

## M0 Fundament – abgeschlossen 2026-10-29

### Geändert
- `.gitignore` um Build-, Test- und Secret-Muster ergänzt
- Doku-Gerüst: `CHANGELOG.md`, `GLOSSARY.md`, ADRs 001–004
- Web-Grundgerüst: Next.js 16.4.1, TypeScript strict, Tailwind 4, ESLint, Vitest, Node 24 LTS
- i18n mit next-intl 4.14.9:
  - `/` leitet auf `/de` um, bei passendem `Accept-Language` auf die erkannte Sprache
  - lokalisierte Startseite und 404
  - `hreflang`, Canonical, Sprachumschalter
  - Test prüft gleiche Keys in allen Sprachen
- Env-Validierung mit Zod (`web/lib/env.ts`), `web/.env.example`, Supabase-Server-Client (nur anon-Key, `server-only`)
- Security-Header: nosniff, Referrer-Policy, X-Frame-Options, Permissions-Policy, HSTS nur in prod
- Lokales Supabase (`supabase/config.toml`, leere `seed.sql`), Verbindungs-Check `npm run check:supabase`
- CI (`.github/workflows/web.yml`): Lint, Typecheck, Test, Build, Secret-Guard

### Wie testen
Voraussetzungen: Node 24 (`web/.nvmrc`), Docker läuft, Supabase-CLI installiert.

```sh
supabase start                       # im Repo-Root
cp web/.env.example web/.env.local   # NEXT_PUBLIC_SUPABASE_ANON_KEY = "Publishable key" aus `supabase status`
cd web && npm ci
npm run dev                          # http://localhost:3000 → /de; /en, /cs, /pl prüfen
npm run lint && npm run typecheck && npm test
npm run check:supabase               # zwei ✓
```

### Akzeptanz
- [x] `npm run dev` zeigt die lokalisierte Startseite in allen 4 Sprachen
- [x] Lint, Typecheck und Beispieltests (12) grün; `npm run build` ohne Warnungen
- [x] Supabase-Verbindung funktioniert (`check:supabase`: Auth-Health 200, anon-Key akzeptiert; falscher Key → Fehler)

### Nach QA (docs/QA-REPORT.md, F1–F9)
- 404: statische, mehrsprachige `global-not-found` (serverseitig, `noindex`, ohne Canonical); `/foo.png` und `/api` enden in der 404
- hreflang nur noch aus dem HTML, kein `Link`-Header der Middleware
- Secret- und service_role-Keys in `NEXT_PUBLIC_SUPABASE_ANON_KEY` werden abgelehnt (Build und `check:supabase`)
- CI: erweiterter Secret-Guard, Build-Cache
- Testen zusätzlich: `curl -I http://localhost:3000/de/gibtsnicht` → 404; Build mit `sb_secret_…` als anon-Key bricht ab

### Bekannte Lücken
- cs/pl-Texte sind von Muttersprachlern ungeprüft (SPEC 7.6).
- Kein iOS-Gerüst: Das Xcode-Projekt wird in I1 direkt in Xcode angelegt (Planänderung, ADR 001).
- Keine CSP: Sie folgt mit Auth und Drittanbietern (M2/M10).
- Kein Cloud-Projekt: Supabase läuft nur lokal und wird ab M2 verbunden (ADR 002).
- Die CI ist noch nicht gelaufen, weil das GitHub-Remote fehlt.
- Die 404 für unbekannte Pfade ist mehrsprachig statt in der angefragten Sprache. Explizite `notFound()`-Aufrufe in Seiten nutzen die lokalisierte `[locale]/not-found.tsx`.
- QA F4 (Glossar cs/pl) und F7 (Locale-Cookie vor Consent, M9) sind offen.
