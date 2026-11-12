# ADR 020: Verifizierung, Meldungen, Maßnahmen und Beschwerden

Status: angenommen, Umsetzung in M9b (Plan `docs/plans/M9-plan.md` mit Architekt-Review Abschnitt 10, Freigabe durch den Nutzer 2026-11-08). **Keine Rechtsberatung:** Wortlaute, Fristen und die Einordnung nach DSA sind Platzhalter bis SPEC 7.2. Nichts hier gilt als „DSA-konform“.

## Kontext
SPEC 6 M9b „Vertrauen und Moderation“: Verifizierung (Upload, Admin-Entscheidung, Badge), Melden von Anzeigen und Profilen, Meldungs-Warteschlange, Sperren, Beschwerden.

Nutzer-Entscheidungen vom 2026-11-08:
- Verifizierung ist freiwillig und bringt nur das Badge „verifiziert“ und den Filter „nur verifizierte“ (SPEC 7.5 entschieden).
- Melden nur eingeloggt plus Kontaktweg im Impressum; ein anonymes Formular käme mit Captcha in M10 (Anwaltsfrage vor dem Go-live).
- Volles Beschwerdesystem.

Bestand: `verifications` und Bucket `verification-docs` (M1), `reports` und `reported_message_snapshots` (M1, M7), `moderate_listing` mit Flag `revier.moderation` (ADR 014), Moderations-Mails (ADR 018), `is_blocked` mit Audit-Trigger, Cache-Zähler `public_page_state` (ADR 015).

## Entscheidung

### Verifizierung
- **Zeile zuerst** (wie ADR 011):
  - `begin_verification(p_document_type)` legt den Antrag an; der Server setzt `document_path = {user_id}/{id}` und gibt die ID zurück.
  - `gewerbe` nur für gewerbliche Konten, die übrigen Typen für alle.
  - `submit_verification(p_id)` prüft, ob das Objekt existiert (`storage.objects`), und setzt `submitted_at`. Die Admin-Warteschlange zeigt nur eingereichte Anträge.
- **Storage-Policies `verification-docs` (Review A6):**
  - Insert nur mit exaktem Namen `= document_path` eines eigenen Antrags mit `status = pending`, `submitted_at is null` und aktivem Konto.
  - Keine Update-Policy (kein Upsert).
  - Delete für den Besitzer nur bis zur Einreichung.
  - Bucket-Typen `image/jpeg`, `image/png`, `application/pdf`, 10 MB. HEIC entfällt, weil Browser es im Admin nicht anzeigen; **iOS (I6) wandelt in JPEG um**.
- **Inhaltstyp:** Der Bucket prüft nur den gemeldeten `Content-Type`. Vor dem Anzeigen im Admin prüft der Server die ersten Bytes (`FFD8FF`, `89504E47`, `%PDF-`). Abweichende Dateien werden nicht angezeigt, sondern markiert.
- **Limit:** `verification_requests_per_30d` (3), gezählt in `private.verification_attempts (user_id → profiles cascade, created_at)`, damit Zurückziehen und Aufräumen das Limit nicht umgehen. `RV002` mit `scope = verification`. Dazu weiter höchstens ein offener Antrag. Zählerzeilen nach 30 Tagen löschen.
- **Zurückziehen:** `withdraw_verification(p_id)` (eigener, offener Antrag) löscht die Zeile. Vor der Einreichung löscht der Client die Datei vorher selbst; danach räumt sie der 24-h-Job ab.
- **Entscheiden nur per RPC** `decide_verification(p_id, p_decision, p_code, p_note)`:
  - Admin mit `aal2`; **nie über das eigene Konto** (Selbstentscheidungsverbot, kein Vier-Augen-Prinzip).
  - Codes `unreadable | expired | mismatch | wrong_document | other`; `p_note` 1–1000, Pflicht bei `other`. `p_note` ist die Begründung für den Betroffenen, keine interne Notiz (H9).
  - Grant `update (status, reject_reason)` und Policy `verifications_update_admin` entfallen. Der Guard bleibt und schreibt das Audit.
  - Bereits entschieden: `RV003`.
- **Widerruf:** `revoke_verification(p_user_id, p_code, p_note)` setzt den Profilstatus auf `none`, Audit `verification.revoked`, Mail.
- **Cache:** Jeder Wechsel zu oder weg von `verified` erhöht den Cache-Zähler (`bump_public_cache_epoch`), sonst zeigen gecachte Seiten und `verified_only` das Badge weiter.
- **Badge:** unverändert über `public_profiles`. Was „verifiziert“ zusagt (Dokument gesehen, keine Identitätsgarantie, kein Ablaufdatum), steht im Tooltip und in den Nutzungsbedingungen, beides Platzhalter (SPEC 7.2).

### Dokumentansicht nur mit Audit (Review B3)
> **Ersetzt** durch „Nachträge QA M9b“ (F6, N2, N3): kein Lesen über die Storage-API mehr, Auslieferung nur über die Edge Function `verification-document`. Der folgende Stand gilt nicht mehr und bleibt als Begründung stehen.

- `admin_open_verification_document(p_id)` schreibt `verification.document_viewed` (Admin, Antrag) und liefert den Pfad.
- Die Policy `verification_docs_select_admin` verlangt zusätzlich zu `private.is_admin()` einen Eintrag `verification.document_viewed` **desselben Admins für genau diesen Antrag aus den letzten 2 Minuten** (Muster `lookup_required`, ADR 014). Ein direkter Zugriff über die Storage-API ohne diesen Eintrag scheitert, auch für Admins.
- Danach signiert der Server mit dem Client des Admins für `verification_doc_link_seconds` (60). Bilder als `<img>`, PDFs als Link in neuem Tab (`noopener noreferrer`); `Cache-Control: no-store`, nie in geteilten Caches.
- Dokumente erscheinen nie öffentlich, nie im Export und nie in Mails.
- Restrisiko (H12, überholt): PDFs öffneten sich auf der Storage-Origin. Seit F6 kommen PDFs als Download mit `Content-Security-Policy: sandbox` von der eigenen Origin.

### Aufbewahrung der Dokumente
- `verification_document_days` (30) nach `decided_at`: Datei löschen (Storage-API), `document_path = null`, `document_deleted_at` setzen.
- Anträge ohne Datei und Dateien ohne Antrag nach 24 h.
- Metadaten bleiben bis zur Account-Löschung (ADR 008).
- EXIF/GPS in Fotos von Dokumenten (H1): später über den Bildpfad aus ADR 011 neu kodieren, PDF ausgenommen; bis dahin Anwaltsfrage.

### Meldungen (Review A9)
- **Melden** wie bisher über `reports_insert_own`: alle drei Zieltypen, nur sichtbare Ziele (`can_report`), ohne Legal-Gate, auch für gesperrte Konten, Grenze 20 je 24 h (`54000`). Fremde, unbekannte und nicht sichtbare Ziele ergeben dieselbe Antwort.
- **Pflicht-Häkchen „in gutem Glauben“** (Art. 16 Abs. 2 d) nur im Client, nicht gespeichert; Wortlaut vom Anwalt.
- **Höchstens eine offene Meldung je Meldendem und Ziel** (Partial Unique Index). Eine Wiederholung ergibt `23505`, der Client zeigt „bereits gemeldet“.
- **Eingangsbestätigung:** Bestätigungsseite und Eintrag in „Meine Meldungen“ (`/account/reports`). Ob zusätzlich eine Mail nötig ist, entscheidet der Anwalt.
- **Neue Spalten an `reports`** (nur Server): `outcome` (`no_action | content_removed | point_removed | account_warned | account_blocked | target_gone`) und `decision_audit_id` (→ `audit_log`, `on delete set null`). Meldende lesen `outcome`, `handled_by` bleibt verborgen.
- **Melden ohne Konto:** Kontaktadresse im Impressum (Platzhalter). Der Admin legt die Meldung von Hand an, `reporter_id` ist dann `null`.

### Warteschlange und Maßnahmen
- **Admin-RPCs** (aal2):
  - `admin_report_queue(p_after)`: offene Meldungen je Ziel (Anzahl, Gründe, ältestes Datum), Keyset.
  - `admin_report_target(p_target_type, p_target_id)`: Zusammenfassung des Ziels (Anzeige mit Status, Version und Link zur Prüfansicht; Profil mit Name, Typ, Land, Status, Anzahl Anzeigen).
  - `admin_report_message(p_report_id)`: die gesicherte Kopie einer gemeldeten Nachricht, nur hinter einem Klick, jeder Abruf schreibt `report.message_viewed` (ADR 017: Admins lesen Chats nicht pauschal).
  - `resolve_reports(p_target_type, p_target_id, p_outcome, p_code, p_note, p_expected_version)`: schließt alle offenen Meldungen des Ziels mit Ergebnis und führt die Maßnahme in derselben Transaktion aus. Ist das Ziel inzwischen weg, gilt `target_gone`.
- **Maßnahmen:**
  - Anzeige entfernen: `moderate_listing` mit der neuen Entscheidung **`remove`** aus `active`, `paused`, `pending_review` oder `expired`; Code und Begründung Pflicht, Version Pflicht. Aus anderem Status `RV003`, abweichende Version `RV004`.
  - Kartenpunkt entfernen: wie M6 F7.
  - Konto verwarnen oder sperren (unten).
- **Konto:**
  - `admin_find_account(p_query)`: exakte E-Mail oder UUID; Rate-Limit gemeinsam mit `admin_find_user`; Audit `user.looked_up` ohne die gesuchte E-Mail (Test).
  - `admin_set_account_blocked(p_user_id, p_blocked, p_code, p_note)`: nie das eigene Konto, nie ein Konto mit Rolle (erst entziehen); Audit mit `code`/`note`.
  - `admin_warn_account(p_user_id, p_code, p_note)`: nur Audit `profile.warned` und Mail.
  - Die Sperre ist unbefristet bis zur Entsperrung oder zu einer erfolgreichen Beschwerde. Befristete Sperren (Art. 23 „angemessener Zeitraum“) klärt der Anwalt; eine Spalte `blocked_until` wird erst dann angelegt (H2).
- Für Meldungen gegen Nachrichten gibt es nur Maßnahmen gegen das Konto; `message_hidden` (Text beim Gegenüber ausgeblendet, Kopie bleibt) ist als Option vorgemerkt (H3).

### Moderationspfade (Review A7)
- **Version für `remove`:** `admin_listing_version` bleibt auf `pending_review` beschränkt (QA M4 F4 bleibt zu). Die Version für den Meldungsfall liefert nur `admin_report_target`.
- **Rücknahme per Beschwerde:** `removed`/`rejected → pending_review` über einen eigenen Guard-Pfad mit Flag `revier.appeal`, mit pgTAP-Tests. Ohne dieses Flag verlässt keine Anzeige `removed`. Die Anzeige steht danach vorne in der Warteschlange.
- **Audit und Mails auf allen Pfaden:** `listings_audit` und `listings_moderation_notify` feuern, wenn `private.is_admin()` gilt **oder** das Transaktions-Flag `revier.moderation` bzw. `revier.appeal` gesetzt ist. So entsteht auch auf Server-Pfaden ein Audit-Eintrag (Art.-17-Datensatz, `decision_audit_id`, `my_decisions`). Der Admin-Check bleibt für SQL-Eingriffe.

### Entscheidungen und Beschwerden (DSA Art. 17, 20; Review A8)
- **Entscheidungen** sind Audit-Einträge der Arten `listing.rejected`, `listing.draft` (Änderung angefordert), `listing.removed`, `listing.point_removed`, `profile.blocked`, `profile.warned`, `verification.rejected`, `verification.revoked` und `report.handled` (für Meldende).
- **`my_decisions()`** liefert Betroffenen und Meldenden ihre Entscheidungen der letzten `appeal_window_days` (183): Art, Zeitpunkt, Code, Begründung, Ziel, ob anfechtbar. Nie die Admin-Identität.
- **`public.appeals`** (`user_id → profiles cascade`, `decision_audit_id → audit_log set null`, `text` 10–2000, `status` `open | upheld | reversed`, `decided_at`, `decision_note`):
  - höchstens eine je Entscheidung (`23505`);
  - Lesen nur die eigenen; Schreiben nur per `submit_appeal(p_decision_id, p_text)`, ohne Legal-Gate, auch für gesperrte Konten;
  - fremde, unbekannte und abgelaufene Entscheidungen ergeben einheitlich `P0002`.
- **`decide_appeal(p_appeal_id, p_outcome, p_note)`:**
  - Admin mit `aal2`, nicht der Admin der ursprünglichen Entscheidung.
  - **Ausweichregel:** Gibt es keinen anderen aktiven Admin (Rolle, aktives Konto, bestätigter TOTP-Faktor), ist die Entscheidung erlaubt und im Audit mit `same_reviewer` markiert. Ob das Art. 20 Abs. 6 genügt, klärt der Anwalt.
  - Bereits entschieden: `RV003`.
  - `reversed` macht die Maßnahme rückgängig:
    - entfernte oder abgelehnte Anzeige → `pending_review`, vorne in der Warteschlange;
    - Sperre aufheben;
    - Verifizierung → neuer Antrag ohne Anrechnung auf das Limit (das Dokument liegt nach 30 Tagen nicht mehr vor, H11);
    - Beschwerde eines Meldenden gegen `no_action` → die Meldungen des Ziels werden wieder geöffnet und stehen vorne.
  - Audit `appeal.upheld` bzw. `appeal.reversed`, Mail an den Beschwerdeführer.
- **Aufbewahrung:** Beschwerden 24 Monate nach der Entscheidung (Platzhalter), mit dem Konto per Kaskade.

### Mailtexte
- Der markierte Platzhalter `contactPlaceholder` aus M8 wird ersetzt: Begründung, Hinweis „Du kannst diese Entscheidung bis zum … anfechten“, Link `/{lang}/account/decisions` (Login nötig, kein Token).
- Der Hinweis auf außergerichtliche Streitbeilegung (Art. 21) und Gerichte bleibt ein markierter Platzhalter.
- Nie Admin-Identität, interne Notizen, Kontaktdaten des Meldenden oder Koordinaten; Begründungen nur escaped.

### Benachrichtigungs-Warteschlange (Review A11)
- **`private.account_notifications (kind, user_id, ref_id, payload jsonb, …)`** für die neuen Dienstmails: `account_blocked`, `account_unblocked`, `account_warned`, `verification_verified`, `verification_rejected`, `verification_revoked`, `report_resolved`, `appeal_decided`, `draft_expiry_notice`. Die Moderations-Mails aus M8 bleiben in ihrer Tabelle.
  - `kind` mit Check-Constraint, Payload-Allowlist je Art in der DB.
  - `ref_id` verweist auf den Audit- bzw. Fachdatensatz; der Text wird beim Versand daraus gelesen, nicht als Freitext kopiert.
  - Keine E-Mail in der Zeile; `user_id → profiles cascade`; `unique (kind, ref_id, user_id)`; Frist 30 Tage.
- Versand im selben Lauf wie die Moderations-Mails, claim/confirm/release mit `claim_id` (ADR 018).
- Dienstmails ohne Abbestellen. Sie gehen an gesperrte Konten, nicht an gelöschte.
- `report_resolved` an Meldende nennt nur das Ergebnis, nichts über das Gegenüber (Art. 16 Abs. 5).

### Verlassene Entwürfe (SPEC 7.3)
- **`listings.edited_at`** (nur Server): Der Guard setzt sie bei jeder Besitzer-Änderung, auch an Fotos, Wildarten und Ort (über den Kinder-Guard). Nicht im Inhalts-Hash. Bestandszeilen bekommen `greatest(created_at, submitted_at)`.
- **Hinweis:** `draft_notice_days` (30) vor Ablauf von `draft_inactive_months` (12) eine Mail `draft_expiry_notice`. Der Zeitpunkt des Hinweises steht in **`listings.draft_notice_at`** (nur Server), nicht nur in der Warteschlange, weil deren Frist (30 Tage) genau mit der Wartezeit zusammenfällt.
- **Löschen** nur, wenn `draft_notice_at` mindestens 30 Tage alt ist und `edited_at < draft_notice_at`. Die Function löscht erst die Fotos über die Storage-API, dann die Zeile. Eine Bearbeitung nach dem Hinweis setzt die Frist neu.

### Aufräumjobs in M9b
| Job | Frist (`app_settings`) | Weg |
|---|---|---|
| Verifizierungsdokumente | `verification_document_days` (30) nach Entscheidung | Function (Storage), dann RPC |
| Anträge ohne Datei, Dateien ohne Antrag | 24 h | Function |
| Zählerzeilen `verification_attempts` | 30 Tage | pg_cron SQL |
| Verlassene Entwürfe | `draft_inactive_months` (12), Hinweis `draft_notice_days` (30) vorher | DB-Hinweis, Function löscht Fotos und Zeile |
| Beschwerden | 24 Monate nach Entscheidung (Platzhalter) | pg_cron SQL |
| `account_notifications` | 30 Tage | pg_cron SQL |

Function, Secret und Grenzen wie ADR 019 (`account-maintenance`).

### Einstellungen (`app_settings`, M9b)
`verification_requests_per_30d` 3, `appeal_window_days` 183 (`verification_doc_link_seconds` entfiel mit QA M9b N4), `draft_inactive_months` 12, `draft_notice_days` 30. Alle Werte sind Platzhalter.

### Fehlercodes (für Web und iOS)
| Code | Wann | Hinweis |
|---|---|---|
| `42501` | kein Admin oder `aal1`; Entscheidung über das eigene Konto; Sperre eines Kontos mit Rolle; Dokumentzugriff ohne frischen Audit-Eintrag; Roh-UPDATE an `verifications` | gleich für fremd und nicht vorhanden |
| `P0002` | Antrag, Meldungsziel, Konto oder Entscheidung fremd, unbekannt oder (Beschwerde) abgelaufen | kein Orakel |
| `RV002` | Verifizierungs-Limit | `hint {"retry_after","scope":"verification"}` |
| `RV003` | bereits entschieden (Verifizierung, Beschwerde, Meldungen des Ziels) bzw. `remove` aus nicht erlaubtem Status | Ansicht neu laden |
| `RV004` | Version der Anzeige beim Entfernen weicht ab | wie ADR 014 |
| `23505` | zweite offene Meldung zum selben Ziel, zweite Beschwerde zur selben Entscheidung | „bereits gemeldet“ bzw. „bereits eingelegt“ |
| `54000` | Meldungs-Limit, Kontosuche | wie bisher |

### Umsetzung (M9b Commit 6)
Migration `20261112100000_verification.sql`, pgTAP 53 (07, 08, 45 angepasst):
- **Beginn:** Ein noch nicht eingereichter eigener Antrag wird von `begin_verification` wiederverwendet (neuer Dokumenttyp, kein neuer Versuch), damit ein gescheiterter Upload nicht das Limit verbraucht. Ein eingereichter offener Antrag ergibt `23505`. Legal-Gate (`RV001`) und aktives Konto für Beginn und Einreichen; Zurückziehen ohne Legal-Gate, auch gesperrt.
- **Profilstatus** wird aus den Anträgen abgeleitet (`private.sync_verification_status`): `verified`, solange ein verifizierter Antrag nicht widerrufen ist; sonst `pending` bei einem eingereichten offenen Antrag; sonst `rejected`, wenn die letzte Entscheidung (Widerruf eingeschlossen) eine Ablehnung war; sonst `none`. Ein nicht eingereichter Antrag ändert nichts. Der Cache-Zähler steigt per Trigger auf `profiles`, wenn `verified` dazukommt oder wegfällt.
- **Widerruf** steht am verifizierten Antrag (`revoked_at`, `revoke_code`, `revoke_reason`, einmalig, unveränderlich). Codes `expired | mismatch | fraud | other` (Platzhalter), Freitext Pflicht bei `other`.
- **Guard:** Einreichen, Entscheiden und Widerrufen nur mit dem Transaktions-Flag `revier.verification`, das nur die RPCs setzen; ohne Flag `42501`, auch für den Server.
- **Admin-Lesepfade:** `admin_verification_queue` (eingereichte offene Anträge, Keyset, `is_own`), `admin_verification` (Antrag, Konto, Verlauf; ohne Pfad und Prüfer), `admin_open_verification_document` (Audit, dann Pfad).
- **Dienstmails:** Die Warteschlange `private.account_notifications` hat claim/confirm/release mit dem Secret der Suchauftrags-Mails (derselbe Lauf, `account_email_batch` 50). Die Details je Art liest `private.account_notification_details` aus dem Fachdatensatz; fehlt die Quelle oder der Empfänger, ist die Zeile ohne Versand erledigt. In Commit 6 gibt es die Zweige für die drei Verifizierungsarten, die übrigen Arten folgen mit ihren Commits. Fristen: Job `trust-retention` (Warteschlange und Zählerzeilen nach 30 Tagen).
- **Server-Pfade:** `private.moderation_path()` (Admin-JWT oder Flag `revier.moderation`/`revier.appeal`) steuert `listings_audit` und `listings_moderation_notify`. Auf einem Server-Pfad entsteht das Audit ohne Akteur.

### Umsetzung (M9b Commit 7)
- **Web, Nutzer:** `/account/verification` (`requireOnboardedUser`) zeigt Status, Grund einer Ablehnung bzw. eines Widerrufs und frühere Anträge. Der Upload (Client-Komponente) prüft Typ nach den ersten Bytes und Größe vor, ruft `begin_verification`, lädt mit dem Browser-Client auf den Serverpfad (ohne Upsert; liegt dort eine Datei eines abgebrochenen Versuchs, löscht er sie zuerst) und reicht ein. Zurückziehen geht ohne JavaScript; vor der Einreichung löscht die Session des Nutzers die Datei.
- **Web, Admin:** `/admin/verifications` (Warteschlange) und `/admin/verifications/:id`. Das Dokument erscheint erst nach „Dokument anzeigen“ (Server Action → `admin_open_verification_document`, danach `?document=1`); die Seite signiert 60 Sekunden mit der Session des Admins, liest die ersten 16 Bytes per Range-Request und zeigt nur JPEG/PNG (`<img>`, `referrerpolicy=no-referrer`) bzw. PDF (Link, neuer Tab). Abweichende Dateien werden nicht angezeigt. Entscheidung und Widerruf ohne JavaScript, Codes und Begründung für Betroffene (H9). Die Übersicht zählt offene Anträge.
- **Mails:** `send-search-notifications` hat einen dritten Schritt `account` (claim/confirm/release). Texte in `account_texts.ts` (4 Sprachen); Ablehnung und Widerruf nennen Grund, Begründung, die Frist zum Anfechten (`appeal_window_days`, ab der Entscheidung) mit Link `/{lang}/account/decisions` (Seite folgt mit Commit 9, in `mail_links.json` vorgemerkt) und den markierten Platzhalter zu Rechtsbehelfen. Labels sind Kopien der Web-Texte, geprüft über `mail_labels.json`.
- **Tests:** Vitest `lib/verification.test.ts`, Integration `verification.test.ts` (B3 gegen die echte Storage-API), E2E `verification.spec.ts` (Upload → Dokument mit Audit → Entscheidung → Badge → Widerruf), Deno `account_texts_test.ts` und `handler_test.ts`.

### Umsetzung (M9b Commit 8)
Migration `20261112120000_reports_appeals.sql`, pgTAP 54 (07, 17, 49, 52, 00 angepasst):
- **Meldungen:** Erledigen nur per `resolve_reports` (Flag `revier.report`); `report.handled` je Meldung mit `outcome`, Code und Begründung, `decision_audit_id` zeigt darauf. Nutzer haben kein UPDATE-Recht mehr; Server-Pfade (Jobs, SQL) bleiben wie bei den übrigen Guards frei. `reporter_id` fällt bei einer Kontolöschung per FK auf `null`. Wiedereröffnen nur per `decide_appeal` (Audit `report.reopened`), nicht für Meldende, die zum selben Ziel inzwischen neu gemeldet haben.
- **Maßnahmen:** `content_removed` über `moderate_listing(…, 'remove', version)`; die Version liefert `private.listing_moderation_version` (jeder Status, nur über `admin_report_target`). `point_removed` setzt `display_location = null` (Audit wie M6 F7). `account_warned`/`account_blocked` gegen Besitzer, Profil bzw. Absender laut Kopie; ein schon gesperrtes Konto wird nicht erneut gesperrt (keine zweite Mail). Ist das Ziel weg, gilt `target_gone`.
- **Codes für Konten** (Platzhalter): `scam | illegal | weapons | harassment | spam | other`, Freitext Pflicht bei `other`. Sperren und Verwarnen schreiben das Audit selbst mit Code und Begründung (`profiles_audit` schweigt dann) und legen die Dienstmail an.
- **Removed ist endgültig** bis zur Beschwerde: Der Trigger `listings_appeal_guard` lässt ohne Flag `revier.appeal` keinen Wechsel weg von `removed` zu, auch nicht für den Server. Mit dem Flag nur `removed | rejected | draft → pending_review`; die alte Einreichungszeit bleibt, die Anzeige steht damit vorne.
- **Entscheidungen:** `private.decisions_for(user)` ist die eine Quelle für `my_decisions`, Beschwerde und Export (Anzeige-Entscheidungen, Sperre, Verwarnung, Verifizierung, `report.handled` für Meldende). Meldende sehen bei Profil- und Nachrichtenmeldungen keinen Namen.
- **Beschwerden:** `appeals.decision_action` hält die Art fest, auch wenn das Audit nach der Frist fällt. `decided_by` (set null) und `same_reviewer`; die Ausweichregel prüft aktive Admins mit bestätigtem TOTP-Faktor. Aufbewahrung `appeal_keep_months` (24) im Job `trust-retention`.
- **Export version 4:** `reports[].outcome`, `decisions`, `appeals`.

### Umsetzung (M9b Commit 9a, Nutzerseite und Mails)
- **Melden:** `/account/report/listing/:id` und `/account/report/profile/:id` statt `?type=&id=` (Plan 5): Der Proxy übernimmt beim Login-Umweg nur den Pfad, wie im Chat (Review A2). Die Links auf Detail- und Anbieterseite sind statisch (`rel=nofollow`). Eigene Anzeigen und das eigene Profil ergeben dieselbe Seite wie nicht sichtbare Ziele. Zusicherung „in gutem Glauben“ als markierter Platzhalter, nicht gespeichert. Eingangsbestätigung: Weiterleitung auf `/account/reports` mit Hinweis.
- **Chat:** Eine zweite Meldung derselben Nachricht zeigt „bereits gemeldet“ (`23505`) statt „fehlgeschlagen“.
- **Entscheidungen** `/account/decisions` mit Grund-Label, Begründung, Frist und Beschwerde-Link; `/account/decisions/:id/appeal` (10–2000 Zeichen). Alle vier Konto-Seiten prüfen nur die Session (`guards.test.ts`, Review A4).
- **Mails:** Moderations-Mails nennen statt des Kontakt-Platzhalters aus M8 die Frist zum Anfechten (`claim_moderation_notifications.appeal_until`) mit Link und den markierten Hinweis zu Rechtsbehelfen. Neue Dienstmails für Sperre, Entsperrung, Verwarnung (mit Link auf die Richtlinien), Meldungsergebnis (nur Zieltyp, Ergebnis, bei Anzeigen der Titel) und Beschwerde (bestätigt mit Hinweis auf Rechtsbehelfe, aufgehoben ohne).

### Umsetzung (M9b Commit 9b, Admin)
- **Meldungen:** `/admin/reports` (je Ziel, älteste zuerst) und `/admin/reports/{listing|profile|message}/:id` (der Routen-Parser kennt nur UUID-Platzhalter). Die Zielansicht zeigt offene Meldungen ohne Meldende, das betroffene Konto und nur die passenden Maßnahmen; Verwarnen und Sperren sind bei Konten mit Rolle und beim eigenen Konto gesperrt. Die Kopie einer gemeldeten Nachricht erscheint erst nach „Gemeldete Nachricht anzeigen“ (`?show=<Meldung>`); jede Ansicht ruft `admin_report_message` und wird auditiert.
- **Konten:** `/admin/users` sucht per POST (Adresse nie in der URL), `/admin/users/:id` zeigt das Konto mit Sperren, Entsperren und Verwarnen. Jede Ansicht zählt als Suche (Limit, Audit `user.looked_up`).
- **Beschwerden:** `/admin/appeals` und `/admin/appeals/:id` mit der ursprünglichen Entscheidung (ohne Admin-Identität, nur „deine eigene Entscheidung“) und Pflicht-Begründung.
- **Übersicht** zählt offene Meldungen und Beschwerden; das Audit-Log kennt die neuen Arten.
- **Tests:** E2E `admin-moderation.spec.ts` (Akzeptanz 2 über die Oberfläche, Akzeptanz 3 mit Vier-Augen-Regel, Kopie nur nach Klick), Integration `trust-mails.test.ts` (Mails zu Akzeptanz 2 und 3 über die echte Edge Function in Mailpit).

### Umsetzung (M9b Commit 10, Aufräumjobs)
Migration `20261112140000_trust_maintenance.sql`, pgTAP 55:
- **Verifizierung:** `account-maintenance` löscht über die Storage-API Dokumente entschiedener Anträge nach `verification_document_days` (`verification_expired`) und Dateien ohne Antrag nach `storage_orphan_hours` (`verification_orphan`). Der tägliche Job `trust-maintenance` (`private.run_trust_maintenance`) löscht nicht eingereichte Anträge nach derselben Frist und setzt `document_path = null`, `document_deleted_at`, sobald die Datei weg ist. Nie per SQL in `storage.objects`.
- **Verlassene Entwürfe:** `listings.edited_at` stempelt der Trigger `listings_edited_at` bei jeder Änderung des Besitzers (Vergleich über `to_jsonb`, weil der Zeilenvergleich für Geodaten keinen Operator hat), der Kinder-Guard bei Fotos, Wildarten und Ort. `edited_at` und `draft_notice_at` stehen nicht im Inhalts-Hash, sonst müsste eine pausierte Anzeige nach dem Fortsetzen neu geprüft werden (gefunden im Integrationstest). Hinweis per Dienstmail `draft_expiry_notice` mit Löschdatum und Link zum Bearbeiten; gelöscht werden nur Entwürfe, deren Hinweis 30 Tage alt ist und die seitdem nicht bearbeitet wurden. **Abweichung vom Plan:** Der Job löscht die Zeile; die Fotodateien entfernt danach der bestehende Job für Dateien ohne Zeile (`photo_orphan`, ADR 019), statt einer eigenen Reihenfolge in der Function. Das Ergebnis ist dasselbe, ein zweiter Löschweg entfällt.
- **Fristen:** `trust-retention` löscht Warteschlange und Zählerzeilen nach 30 Tagen und Beschwerden nach `appeal_keep_months`.

### Nachträge QA M9b (Migration `20261112160000_qa_m9b_fixes.sql`)
- **F1:** `reports.resolution_id` kennzeichnet eine Bearbeitung von `resolve_reports`. Eine Beschwerde von Meldenden öffnet nur die Meldungen dieser Bearbeitung wieder, nicht frühere Zyklen.
- **F2:** Die Ausweichregel schließt neben dem entscheidenden Admin auch den Beschwerdeführer aus (`other_admin_available(p_exclude)`).
- **F3:** Kartenpunkt entfernen verlangt einen Anzeigen-Grund und eine Begründung, schreibt beides ins Audit `listing.point_removed` und legt eine Moderations-Mail (`point_removed`, 4 Sprachen) mit Frist zum Anfechten an.
- **F4:** `report_resolved` verweist auf das Audit der Bearbeitung (`decision_audit_id`); jede neue Entscheidung nach einer Wiedereröffnung ergibt eine eigene Mail.
- **F5:** Getrennte Auswahl „Grund für die Anzeige“ und „Grund für das Konto“; Schema und `resolve_reports` prüfen den Code je Maßnahme (`23514`, `hint fields code`).
- **F6 (ersetzt die Dokumentansicht aus Commit 7):** Admins haben keinen Lesezugriff mehr über die Storage-API; die Policy `verification_docs_select_admin` und das 2-Minuten-Fenster entfallen. Jeder Abruf läuft über die Edge Function `verification-document` (`verify_jwt`, `admin_open_verification_document` mit dem JWT des Admins schreibt das Audit, Download mit `service_role`, erste Bytes, `no-store`, `sandbox`, PDF als Download) und die Web-Route `/api/admin/verifications/:id/document`. Langlebige signierte Links gibt es damit nicht mehr. `verification_doc_link_seconds` wird nicht mehr genutzt.

### Nachträge QA M9b Nachprüfung (Migration `20261112170000_qa_m9b_recheck.sql`)
- **N1:** Der Trigger `listings_point_guard` lässt Admins den Kartenpunkt fremder Anzeigen nur mit dem Flag aus `resolve_reports` (Grund und Begründung) entfernen; ein direktes UPDATE per PostgREST ergibt `42501`. Besitzer und Server-Pfade bleiben frei.
- **N2:** `/api/admin/verifications/:id/document` ist aus der allgemeinen Header-Regel ausgenommen; CSP `sandbox` und `no-referrer` kommen genau einmal.
- **N3:** Die Admin-Seite ruft das Dokument einmal über die Function ab (ein Audit je Ansicht) und zeigt nach dem **erkannten** Typ: Bilder eingebettet (`data:`), PDFs als Download-Link auf die Route, abweichende Dateien mit eindeutiger Markierung.
- **H1:** Die Route weist Abrufe mit `Sec-Fetch-Site` außer `same-origin` mit 403 ab (kein Audit durch fremde Links).
- **N4:** Doku nachgezogen, `verification_doc_link_seconds` entfernt.

## Alternativen
- **Schlanker Beschwerdeweg** (Formular als Meldung, Entscheidung von Hand): keine Wirkung auf die Maßnahme, keine gemeinsame Quelle mit `my_decisions` und Export (10.4/3).
- **Eigene Tabelle je Mailart** wie in M8: mehr Schema ohne Nutzen (10.4/8).
- **Dokumentansicht nur über die RPC, ohne Policy-Bedingung:** umgehbar über die Storage-API (B3).
- **Verlassene Entwürfe nach `last_sign_in_at`:** Refresh-Tokens verfälschen den Wert, kein Bezug zum Entwurf (10.4/8).

## Folgen
- iOS (I6): dieselben RPCs für Verifizierung (JPEG statt HEIC), Melden, „Meine Meldungen“, Entscheidungen und Beschwerde. Bis dahin Lücke im CHANGELOG.
- Für Transparenzberichte (Art. 15/24, falls keine Ausnahme nach Art. 19 greift) müssen Zählwerte als Aggregate laufen, bevor die Fristjobs die Grundlage löschen (H10, Anwalt).
- Restrisiko H8: Sperrumgehung durch Löschen und Neuregistrieren.
- SPEC 3.4 zum Dokument-Bucket wird mit Commit 6 auf die Bedingung aus B3 nachgezogen.
