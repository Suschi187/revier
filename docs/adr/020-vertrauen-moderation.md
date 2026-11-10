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
- `admin_open_verification_document(p_id)` schreibt `verification.document_viewed` (Admin, Antrag) und liefert den Pfad.
- Die Policy `verification_docs_select_admin` verlangt zusätzlich zu `private.is_admin()` einen Eintrag `verification.document_viewed` **desselben Admins für genau diesen Antrag aus den letzten 2 Minuten** (Muster `lookup_required`, ADR 014). Ein direkter Zugriff über die Storage-API ohne diesen Eintrag scheitert, auch für Admins.
- Danach signiert der Server mit dem Client des Admins für `verification_doc_link_seconds` (60). Bilder als `<img>`, PDFs als Link in neuem Tab (`noopener noreferrer`); `Cache-Control: no-store`, nie in geteilten Caches.
- Dokumente erscheinen nie öffentlich, nie im Export und nie in Mails.
- Restrisiko (H12): PDFs öffnen sich auf der Storage-Origin; dort liegen keine Session-Cookies der App.

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
`verification_requests_per_30d` 3, `verification_doc_link_seconds` 60, `appeal_window_days` 183, `draft_inactive_months` 12, `draft_notice_days` 30. Alle Werte sind Platzhalter.

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
