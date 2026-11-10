# Plan M9 – Vertrauen und Compliance (Web)

Stand: 2026-11-08, mit Architekt-Review (Abschnitt 10) und Freigabe (Abschnitt 11).

## 0. Auftrag und Akzeptanz (SPEC 6)
- Verifizierung (Upload, Admin-Entscheidung, Badge), Melden von Anzeigen und Profilen, Meldungs-Warteschlange im Admin, Account-Löschung (inklusive Daten und Storage), Datenexport, Cookie-Consent, Rechtstext-Platzhalter.
- Karte (v0.8, ADR 016): Die selbst gehostete Karte steht als technisch notwendiger eigener Dienst in der Cookie-Übersicht, und die Datenschutzerklärung nennt sie.
- **Akzeptanz:**
  - a) Ein gelöschter Account verschwindet aus allen Tabellen und Buckets, bis auf gesetzlich nötige Reste (SPEC 7.3, ADR 008).
  - b) Ohne Einwilligung laufen keine nicht notwendigen Cookies.

## 1. Entscheidungen des Nutzers (2026-11-08)
1. **Verifizierung ist freiwillig (SPEC 7.5 entschieden):** Sie bringt nur das Badge „verifiziert“ und den Filter „nur verifizierte“. Für Anzeigen ist sie keine Pflicht.
2. **Account-Löschung sofort nach Bestätigung:**
   - Vorher eine erneute Anmeldung (frischer Code bzw. frischer Apple-Login, App-Store-konform).
   - Es ist eine echte Löschung, inklusive Chats, Fotos und Dokumenten.
   - Audit- und Moderationsdaten bleiben pseudonymisiert (ADR 008).
3. **Datenexport als sofortiger JSON-Download im Konto:**
   - Er enthält alle eigenen Daten: Profil, Anzeigen, Fotos (als Liste mit Links), Nachrichten, Suchaufträge samt Treffern, Favoriten, Blockierungen, Meldungen, Zustimmungen und Verifizierungs-Metadaten.
   - Mit Rate-Limit.
4. **Cookie-Consent ohne Pop-up, solange nur notwendige Cookies laufen** (TTDSG § 25 Abs. 2):
   - Eine Seite „Cookie-Einstellungen“ im Footer listet alle Cookies und Browser-Speicher. Die selbst gehostete Karte steht dort als notwendiger eigener Dienst.
   - Die Consent-Mechanik ist vorbereitet und greift, sobald etwas Optionales dazukommt.
   - Akzeptanz b) wird per E2E-Test über ein Inventar der Cookies und des Browser-Speichers nachgewiesen.

## 2. Umfang
- **Drin (Vorschläge mit Begründung, im Review zu bestätigen):**
  - **Konto löschen** unter `/account/delete`:
    - Bestätigung mit frischer Anmeldung, dann sofortige harte Löschung.
    - Storage und `auth.users` löscht eine Edge Function (service_role nur dort).
    - Ein Cron-Job wiederholt abgebrochene Löschungen.
  - **Datenexport** unter `/account/data` als JSON-Download (Route-Handler, POST), Rate-Limit 3 je 24 h.
  - **Cookie-Einstellungen** `/{lang}/cookies`:
    - Ein Inventar als eine Quelle für die Seite und für die Tests.
    - Das Locale-Cookie wird abgeschaltet (QA M0 F7).
    - Die Consent-Mechanik ist als Vertrag und Guard-Test vorbereitet.
  - **Rechtstext-Platzhalter:**
    - Datenschutz mit einer Gliederung der tatsächlichen Verarbeitungen (Suchaufträge, Benachrichtigungen, Abbestell-Token, Karte, Realtime, Verifizierung, Meldungen, Löschung, Export).
    - Nutzungsbedingungen und neue Seiten „Richtlinien“ (verbotene Inhalte) und „Datenquellen“ (BKG, Statistik Austria, OSM/ODbL, Protomaps; offen seit M1/M3/M6).
    - Alles bleibt als Platzhalter markiert und `noindex`.
  - **Verifizierung:**
    - Upload in den privaten Bucket `verification-docs` mit den Dokumenttypen aus SPEC 3.1.
    - Admin-Warteschlange mit Dokumentansicht per kurzlebiger signierter URL, Entscheidung mit Begründung.
    - Widerruf, Badge (besteht), Mail an den Nutzer.
    - Aufbewahrung des Dokuments 30 Tage nach der Entscheidung.
  - **Melden von Anzeigen und Profilen:**
    - Vom Detail und vom Anbieterprofil, nur eingeloggt (Frage 9.2).
    - „Meine Meldungen“ mit Stand und Ergebnis (DSA Art. 16 Abs. 5).
  - **Meldungs-Warteschlange im Admin:**
    - Meldungen gruppiert je Ziel, mit gesicherten Chat-Nachrichten aus M7.
    - Aktionen: keine Maßnahme, Anzeige entfernen, Kartenpunkt entfernen (M6 F7), Konto verwarnen, Konto sperren/entsperren.
  - **Nutzer suchen und sperren** (SPEC 5): Einen Weg im Admin gibt es bisher nicht, nur die Spalte `is_blocked` und das Audit.
  - **Begründung (DSA Art. 17) und Beschwerdeweg (DSA Art. 20):**
    - Der Platzhalter in den Moderations-Mails aus M8 wird durch einen echten Link auf „Entscheidung anfechten“ ersetzt.
    - Neu sind Mails bei Sperre, Verwarnung, Verifizierungsentscheidung, Meldungsergebnis und Beschwerdeergebnis.
  - **Moderations-Mails auch für Server-Pfade** (Lücke M8): Auslöser über ein Transaktions-Flag statt nur über das Admin-JWT.
  - **Aufräumjobs (ADR 008, 011):**
    - Verifizierungsdokumente nach Frist.
    - Foto-Eingang älter als 24 h und Dateien ohne Zeile.
    - Nie bestätigte Konten nach 7 Tagen.
    - Erledigte Meldungen samt Kopien nach 12 Monaten, Audit nach 24 Monaten.
    - Verlassene Entwürfe nach 12 Monaten mit Hinweis vorab (SPEC 7.3; Frage 9.8).
- **Nicht drin:**
  - iOS (I6): Löschen, Export, Verifizierung per Kamera, Melden, Beschwerde. Die RPCs sind der Vertrag; die Lücke kommt ins CHANGELOG.
  - E-Mail-Adresse ändern (seit M2 offen). Vorschlag: M10, weil kein Akzeptanzkriterium daran hängt.
  - Spam-Erkennung über gleiche Texte (M7-Lücke) → M10.
  - Echter Mail-Anbieter, Captcha, Backups samt Löschfrist in Backups (M10).
  - Automatische Erkennung oder Vorprüfung von Dokumenten. Ablaufdatum des Jagdscheins (`valid_until`) nur als Frage an den Anwalt.
  - Melden ohne Konto, außer einem Kontaktweg im Impressum (Frage 9.2).
  - Außergerichtliche Streitbeilegung (DSA Art. 21): nur ein Hinweis-Platzhalter in den Mails.

## 3. Bestand
- **`verifications`** (M1, `trust_audit`, `review_medium`):
  - Spalten `document_path` (Check: eigener Ordner), `document_type` (`jagdschein | jagdkarte | revierbescheinigung | gewerbe`), `status`, `reviewed_by`, `reviewed_at`, `decided_at`, `document_deleted_at`, `reject_reason`.
  - Höchstens ein `pending` je Nutzer.
  - `verifications_guard`: Ein Insert setzt `profiles.verification_status = pending`, eine Entscheidung setzt den Profilstatus und schreibt das Audit. Entschiedene Anträge sind unveränderlich.
  - Admins entscheiden heute per **Roh-UPDATE** (`verifications_update_admin`, Grant `update (status, reject_reason)`); einen Web-Pfad gibt es nicht.
- **Bucket `verification-docs`** (M1, `storage`):
  - Privat, 10 MB, `image/jpeg`, `image/png`, `image/heic`, `application/pdf`.
  - Insert nur in den eigenen Ordner und nur als aktives Konto. Lesen dürfen der Besitzer und Admins.
  - Keine Delete-Policy und keine Bindung an eine Zeile: Hochladen ohne Antrag ist möglich, das ergibt verwaiste Dateien.
- **`profiles`:** `is_blocked`, `deleted_at`, `verification_status` (nur der Server).
  - `public_profiles` zeigt nur „verifiziert“ oder nichts.
  - `private.is_active_user` und `listing_is_public` werten Sperre und Löschung aus.
  - Der Cache-Zähler steigt bei Sperre und Löschung (`public_page_state`).
  - Audit-Trigger `profile.blocked`/`unblocked`.
  - Ein RPC oder eine Admin-Seite zum Sperren fehlt.
- **`reports`** (M1, M7):
  - Ziel ohne FK; Gründe `scam | illegal | weapons | harassment | wrong_category | other`; Status `open | handled`.
  - Grenze 20 je 24 h (`54000`). `reports_insert_own` gilt ohne Legal-Gate, auch für gesperrte Konten.
  - Spalten-Grants ohne `handled_by`. Admins setzen den Status per Roh-UPDATE, der Audit-Trigger schreibt `report.handled`.
  - `private.reported_message_snapshots`: `sender_id` ohne FK, überlebt die Löschung des Absenders. Ohne API-Rechte, ein Lese-RPC fehlt.
  - Web: nur `reportFromChat` (Nachricht und Profil aus dem Chat, `web/lib/services/chat.ts`). Melden von Anzeigen und Profilen fehlt.
- **`audit_log`:**
  - `actor_id` mit `on delete set null`. `target_id` und `details` können die UUID des Nutzers enthalten (`profile.*`, `verification.*` mit `details.user_id`).
  - Lesen nur Admins (aal2), Seite `/admin/audit`.
- **Moderation (M4, M8):**
  - `moderate_listing` (`security invoker`, Flag `revier.moderation`) kennt `approve`, `request_changes` und `reject`, aber **kein `remove`**. Für das Entfernen gibt es keinen Pfad, ein Roh-UPDATE scheitert am Guard.
  - `listings_moderation_notify` feuert nur mit `private.is_admin()` (Lücke M8).
  - Die Mailtexte (`send-search-notifications/texts.ts`) enthalten den markierten Platzhalter `contactPlaceholder` mit Link aufs Impressum.
- **Löschregeln:** ADR 008, Tabelle der Fremdschlüssel; fast alles läuft per `cascade` an `profiles`/`auth.users`. `private.admin_lookups` hat seit QA M4 F5 einen FK mit cascade.
- **`app_settings`:** Vorhanden sind `verification_document_days` 30, `account_deletion_grace_days` 0, `audit_log_months` 24, `handled_reports_months` 12. `unconfirmed_account_days` fehlt noch (ADR 008: „wird in M9 angelegt“).
- **Auth:** passwortlos (Code und Link, ADR 010). Admin-Step-up prüft `amr` in der DB (ADR 014, `RV005`). Apple ist eingebaut, aber aus. Der Apple-Token-Widerruf bei Löschung ist offen (Review M2, Architekt 8).
- **Cookies heute:**
  - `sb-<ref>-auth-token` (auch geteilt in `.0`/`.1`) nach dem Login.
  - `sb-<ref>-auth-token-code-verifier` beim Apple-Login.
  - `NEXT_LOCALE` auf **jeder** Antwort (QA M0 F7, offen bis M9).
  - Kein `localStorage`/`sessionStorage` im eigenen Code. MapLibre legt nichts im Cache Storage ab (E2E M6).
- **Rechtstexte:** `/imprint`, `/privacy` und `/terms` zeigen nur den Platzhaltersatz (`Legal.placeholder`), `noindex`. Der Footer (`SiteFooter.tsx`) verlinkt alle drei.
- **Mail-Weg:** pg_cron → pg_net → Edge Function, Vault-Secret, claim/confirm/release mit `claim_id` (ADR 017, 018).
- **Badge und Filter** „nur verifizierte“ bestehen seit M5 (`verified_only`, `ListingCard`, `ProviderPage`).
- **Kein Feld für „zuletzt bearbeitet“** an `listings`. Für verlassene Entwürfe fehlt das Merkmal.

## 4. Datenmodell und RPCs
### 4.1 Account-Löschung
- **`public.request_account_deletion()`** (Definer), Prüfreihenfolge:
  1. Angemeldet.
  2. Frische Anmeldung: ein `amr`-Eintrag `otp` oder `oauth` jünger als `account_deletion_reauth_minutes` (10), geprüft wie der Step-up in ADR 014. Sonst `RV007` mit `hint {"reauth":"required"}`.
  3. Kein aktiver Admin, sonst `42501` mit `hint {"reason":"admin_role"}`. Die Rolle muss vorher entzogen werden; das schützt auch den letzten Admin (Frage 9.4).
- **Wirkung:**
  - `profiles.deleted_at = now()`: Profil, Anzeigen und Chats sind sofort nicht mehr öffentlich und nicht mehr beschreibbar.
  - Zeile in `private.account_deletions(user_id pk, requested_at, attempts, last_error_at)`, ohne FK.
  - Es gilt keine Sperre und kein Legal-Gate: Auch gesperrte Konten und Konten ohne aktuelle Zustimmung können löschen (App Store, DSGVO).
- **Edge Function `delete-account`:**
  - `verify_jwt = true`, `getUser()`, oder per Cron mit eigenem Vault-Secret wie in M7/M8.
  - Je Konto:
    1. `private.account_deletion_claim` (nur service_role, `for update skip locked`).
    2. Storage leeren: alle Objekte unter dem Präfix `{user_id}/` in `listing-uploads`, `listing-photos` und `verification-docs` (die Pfade beginnen überall mit der Nutzer-ID, ADR 011). Das geschieht zuerst, weil Storage-Objekte mit `owner` das Löschen des Auth-Nutzers sonst stören.
    3. `private.account_deletion_prepare(user_id)` pseudonymisiert:
       - `details.user_id` im Audit entfernen.
       - `auth.audit_log_entries` des Kontos löschen (enthalten die E-Mail).
       - Die Meldungen des Kontos werden per bestehendem FK `reporter_id → null` gesetzt.
    4. `auth.admin.deleteUser(user_id)`: Die Kaskade räumt Profil, Anzeigen, Fotos, Chats, Suchaufträge, Treffer, Token, Geräte, Zustimmungen, Rollen und MFA-Faktoren ab.
    5. Zeile in `account_deletions` löschen.
  - Fehler: Die Zeile bleibt mit Zähler, der Cron-Job `account-deletions` wiederholt jede Minute, höchstens 10 Versuche, danach Alarm im Log (nur Zähler).
- **Was bleibt (gesetzlich nötige Reste, ins ADR):**
  - `audit_log` mit `actor_id = null`; `target_id` bleibt als Pseudonym, eine Zuordnung zu Person oder E-Mail gibt es nicht mehr.
  - `reports` gegen das Konto oder seine Inhalte (`target_id` ohne FK).
  - `reported_message_snapshots` gemeldeter Nachrichten des Kontos, bis `handled_reports_months` (Beweissicherung, Frage 9.4).
- **Sitzungen:** `deleteUser` entfernt Sessions und Refresh-Tokens. Das JWT gilt technisch bis zum Ablauf weiter, hat aber keine Daten mehr, und `is_active_user` ist falsch. Das Web meldet vorher lokal ab.
- **Apple:** Den Token-Widerruf (Apple-Vorgabe) gibt es erst, wenn Apple eingeschaltet wird (SPEC 7.1). Bis dahin steht er als Lücke im CHANGELOG und als Vorbedingung im Schalter `NEXT_PUBLIC_AUTH_APPLE_ENABLED`.

### 4.2 Datenexport
- **`public.export_my_data()`** (Definer, nur der Aufrufer):
  - Liefert `jsonb` mit `format = "revier-export"`, `version = 1` und `generated_at`.
  - Inhalt per **Allowlist je Tabelle** (keine `select *`):
    - Konto: E-Mail, angelegt, letzte Anmeldung.
    - Profil und Mail-Einstellungen.
    - Zustimmungen.
    - Anzeigen mit Wildarten, Attributen, PLZ und Ort (`listing_places`, eigene Daten) und Fotos als Metadaten mit Pfad.
    - Favoriten.
    - Suchaufträge samt Treffern und Versandzeitpunkten (ADR 018, A9).
    - Unterhaltungen mit Nachrichten (Frage 9.6), `read_at` und dem Anzeigenamen des Gegenübers.
    - Blockierungen.
    - Eigene Meldungen (ohne `handled_by`).
    - Verifizierungen (nur Metadaten).
    - Entscheidungen über eigene Inhalte (wie `my_decisions`, 4.5).
    - Beschwerden.
  - **Nicht enthalten:**
    - Meldungen anderer über das Konto (Schutz der Meldenden).
    - Interne Notizen, Admin-Identitäten, Hashes, Abbestell-Token, `display_location`-Versatz und der verfremdete Punkt als Eingabe.
- **Rate-Limit:** `export_per_24h` = 3, gezählt in `private.data_exports(user_id, created_at)` mit cascade. Fehler `RV002` mit `hint {"retry_after", "scope":"data_export"}`.
- **Fotos:** Der Route-Handler ergänzt je Foto eine signierte URL mit dem Client des Nutzers. Die Storage-Policy lässt den Besitzer seinen Ordner lesen. Laufzeit `export_photo_link_hours` (Vorschlag 24 h, Frage 9.6).

### 4.3 Verifizierung
- **„Zeile zuerst“ wie bei Fotos (ADR 011):**
  - `begin_verification(p_document_type)` legt einen Antrag an: Der Server setzt `document_path = {user_id}/{id}` und gibt die ID zurück.
  - Die Storage-Policy erlaubt den Upload nur auf genau diesen Pfad eines eigenen, offenen Antrags ohne Datei.
  - `submit_verification(p_id)` prüft, ob das Objekt existiert (`storage.objects`), und setzt `submitted_at`.
  - Die Warteschlange zeigt nur eingereichte Anträge.
- **Dateitypen:** JPEG, PNG, PDF, höchstens 10 MB. HEIC fällt aus der Bucket-Liste, weil Browser es im Admin nicht anzeigen können; iOS wandelt um.
- **Dokumenttyp:** `gewerbe` nur für gewerbliche Konten, die anderen für alle.
- **Rate-Limit:** `verification_requests_per_30d` = 3 (`RV002`, Scope `verification`), dazu weiter höchstens ein offener Antrag.
- **Zurückziehen:** `withdraw_verification(p_id)` (offen, eigener Antrag) löscht die Zeile. Die Datei entfernt der Aufräumjob bzw. die Function sofort.
- **Entscheiden** nur per RPC `decide_verification(p_id, p_decision, p_code, p_note)`:
  - Admin mit aal2, nie das eigene Konto (Vier-Augen-Prinzip wie ADR 014).
  - Grund-Codes `unreadable | expired | mismatch | wrong_document | other`; Freitext 1–1000, Pflicht bei `other`.
  - Roh-UPDATE-Grant und `verifications_update_admin` entfallen.
  - Der Guard bleibt und schreibt das Audit wie bisher.
- **Widerruf:** `revoke_verification(p_user_id, p_code, p_note)` setzt den Profilstatus auf `none`, mit Audit `verification.revoked` und Mail, zum Beispiel nach einer Meldung wegen Betrugs.
- **Dokumentansicht im Admin:** signierte URL mit dem Client des Admins (`verification_docs_select_admin`), 60 Sekunden, `no-store`, nie in geteilten Caches. Der Abruf schreibt das Audit `verification.document_viewed`.
- **Aufbewahrung:**
  - `verification_document_days` (30) nach `decided_at`: Der Job löscht die Datei und setzt `document_path = null` und `document_deleted_at`.
  - Anträge ohne Datei werden nach 24 h gelöscht, Dateien ohne Antrag ebenso.
  - Die Metadaten bleiben bis zur Account-Löschung (ADR 008).
- **Badge:** unverändert (`public_profiles`). Was „verifiziert“ zusagt (Dokument gesehen, keine Identitätsgarantie), steht im Tooltip und in den Nutzungsbedingungen (Platzhalter, SPEC 7.2).

### 4.4 Meldungen, Maßnahmen, Sperre
- **Melden:** wie bisher über `reports_insert_own` (alle drei Zieltypen, ohne Legal-Gate, auch für gesperrte Konten).
  - Neu ist die Zusicherung „in gutem Glauben“ (DSA Art. 16 Abs. 2 d) als Pflicht-Häkchen im Formular (nur Client, nicht gespeichert). Der genaue Wortlaut kommt vom Anwalt.
- **Neue Spalten an `reports`:**
  - `outcome` (`no_action | content_removed | point_removed | account_warned | account_blocked`), nur der Server.
  - `decision_audit_id` als Verweis auf die Entscheidung.
- **Admin-RPCs** (aal2, Definer mit ausdrücklicher Admin-Prüfung bzw. `invoker` über bestehende Guards):
  - `admin_report_queue(p_after)`: offene Meldungen gruppiert je Ziel (Anzahl, Gründe, ältestes Datum), Keyset.
  - `admin_report_target(p_target_type, p_target_id)`:
    - Zusammenfassung des Ziels: Anzeige mit Status und Link zur Prüfansicht; Profil mit Name, Typ, Land, Status und Anzahl Anzeigen.
    - Die gesicherte Kopie der Nachricht nur bei Zieltyp `message`. Jeder Abruf einer Kopie schreibt das Audit `report.message_viewed` („Admins lesen Chats nicht pauschal“, ADR 017).
  - `resolve_reports(p_target_type, p_target_id, p_outcome, p_code, p_note)`:
    - Schließt alle offenen Meldungen des Ziels mit einem Ergebnis und führt die Maßnahme in derselben Transaktion aus.
    - Anzeige entfernen: über `moderate_listing` mit der **neuen Entscheidung `remove`** (aus `active`, `paused`, `pending_review`, `expired`; Code und Begründung Pflicht, Version wie ADR 014).
    - Kartenpunkt entfernen: wie M6 F7.
    - Konto verwarnen oder sperren: über 4.4.1.
- **4.4.1 Konto:**
  - `admin_find_account(p_query)`: exakte E-Mail oder UUID, Rate-Limit und Audit `user.looked_up` (wie ADR 014).
  - `admin_set_account_blocked(p_user_id, p_blocked, p_code, p_note)`:
    - Nie das eigene Konto, nie ein aktiver Admin (erst die Rolle entziehen).
    - Schreibt die Audit-Details `code`/`note`.
  - `admin_warn_account(p_user_id, p_code, p_note)` schreibt nur das Audit `profile.warned` und eine Mail.
  - Die Sperre ist unbefristet bis zur Entsperrung oder zu einer erfolgreichen Beschwerde (DSA Art. 23 „angemessener Zeitraum“: Anwalt).
- **Meldende:**
  - `/account/reports` zeigt die eigenen Meldungen mit Stand und Ergebnis (RLS `reports_select_own`; Spalten-Grant um `outcome` ergänzt, `handled_by` bleibt verborgen).
  - Dazu eine Mail beim Ergebnis (Art. 16 Abs. 5), ohne Angaben über das Gegenüber außer dem Ergebnis.

### 4.5 Begründung und Beschwerde (DSA Art. 17, 20)
- **Entscheidungen** sind Audit-Einträge der Arten `listing.rejected`, `listing.draft` (Änderung angefordert), `listing.removed`, `listing.point_removed`, `profile.blocked`, `profile.warned`, `verification.rejected`, `verification.revoked` und `report.handled` (für Meldende).
- **`my_decisions()`** liefert dem Betroffenen bzw. Meldenden seine Entscheidungen der letzten `appeal_window_days` (183, Art. 20 Abs. 1: mindestens 6 Monate). Inhalt: Art, Zeitpunkt, Code, Begründung, Ziel und ob anfechtbar. Nie die Admin-Identität.
- **`public.appeals`:**
  - Spalten: `user_id`, `decision_audit_id`, `text` 10–2000, `status` (`open | upheld | reversed`), `decided_at`, `decision_note`.
  - Höchstens eine Beschwerde je Entscheidung.
  - RLS: Lesen der eigenen. Schreiben nur per `submit_appeal(p_decision_id, p_text)`, ohne Legal-Gate, auch für gesperrte Konten (Art. 20 gilt gerade dann).
- **`decide_appeal(p_appeal_id, p_outcome, p_note)`:**
  - Admin mit aal2, **nicht** der Admin der ursprünglichen Entscheidung (Art. 20 Abs. 6, Vier-Augen).
  - `reversed` macht die Maßnahme rückgängig:
    - entfernte oder abgelehnte Anzeige → `pending_review`, vorne in der Warteschlange;
    - Sperre aufheben;
    - Verifizierung → neuer Antrag möglich, Hinweis.
  - Audit `appeal.upheld` bzw. `appeal.reversed`, Mail an den Beschwerdeführer.
- **Mailtexte:**
  - Der markierte Platzhalter `contactPlaceholder` wird ersetzt durch: Begründung, Hinweis „Du kannst diese Entscheidung bis zum … anfechten“, Link `/{lang}/account/decisions` (Login nötig, kein Token).
  - Der Hinweis auf außergerichtliche Streitbeilegung und Gerichte bleibt als markierter Platzhalter, bis SPEC 7.2 klärt.
  - Nie Admin-Identität, interne Notizen oder Kontaktdaten des Meldenden.

### 4.6 Benachrichtigungen (Lücke M8)
- **Server-Pfade:** `listings_moderation_notify` feuert zusätzlich, wenn das Transaktions-Flag `revier.moderation` gesetzt ist. Das gilt auch, wenn die Entscheidung über einen Server-Pfad läuft (service_role oder künftige Jobs). Der Admin-Check bleibt für SQL-Eingriffe.
- **Neue Arten** `account_blocked`, `account_unblocked`, `account_warned`, `verification_verified`, `verification_rejected`, `verification_revoked`, `report_resolved`, `appeal_decided`, `draft_expiry_notice`:
  - Vorschlag: eine allgemeine Warteschlange `private.account_notifications(kind, user_id, ref_id, payload jsonb)` mit Allowlist je Art, im selben Lauf wie die Moderations-Mails, mit claim/confirm/release über `claim_id` (Frage 9.8).
  - Dienstmails ohne Abbestellen. Sie gehen an gesperrte Konten, nicht an gelöschte.

### 4.7 Aufräumjobs (ADR 008, 011)
| Job | Frist (`app_settings`) | Weg |
|---|---|---|
| Account-Löschungen nachholen | sofort, Wiederholung jede Minute | Function `delete-account` |
| Verifizierungsdokumente | 30 Tage nach Entscheidung | Function (Storage), dann RPC |
| Verifizierungen ohne Datei, Dateien ohne Antrag | 24 h | Function |
| Foto-Eingang (`listing-uploads`) | 24 h | Function |
| Dateien in `listing-photos` ohne Zeile | 24 h | Function |
| Nie bestätigte Konten | `unconfirmed_account_days` 7 | Function (`deleteUser`) |
| Verlassene Entwürfe | 12 Monate ohne Bearbeitung, Hinweis 30 Tage vorher | DB-Hinweis, Function löscht Fotos und Zeile |
| Erledigte Meldungen samt Kopien | `handled_reports_months` 12 | pg_cron SQL |
| Audit-Log | `audit_log_months` 24 | pg_cron SQL |
| Beschwerden | 24 Monate nach Entscheidung (Platzhalter) | pg_cron SQL |
| Datenexport-Zähler | 7 Tage | pg_cron SQL |

- Die Storage-Jobs laufen in einer Function `account-maintenance` (oder als Schritt in `delete-account`). Der Cron-Auslöser hat ein eigenes Vault-Secret und eine eigene URL; ohne URL macht der Job nichts (wie ADR 017).
- Die Jobs arbeiten mit Batch-Grenze und Zeitbudget und loggen nur Zähler.
- **Verlassene Entwürfe:**
  - Neue Spalte `listings.edited_at`. Der Guard setzt sie bei jeder Besitzer-Änderung, auch an Fotos, Wildarten und Ort (über den Kinder-Guard). Nicht im Inhalts-Hash.
  - Bestandszeilen bekommen `created_at`.
  - Gelöscht wird nur, wenn der Hinweis mindestens 30 Tage alt ist und seitdem nichts geändert wurde.

### 4.8 Einstellungen und Fehlercodes
- Neue `app_settings`:
  - `account_deletion_reauth_minutes` 10
  - `export_per_24h` 3
  - `export_photo_link_hours` 24
  - `verification_requests_per_30d` 3
  - `verification_doc_link_seconds` 60
  - `appeal_window_days` 183
  - `unconfirmed_account_days` 7
  - `draft_inactive_months` 12
  - `draft_notice_days` 30
- Neuer Code `RV007` (frische Anmeldung nötig) in die Fehlertabelle von ADR 014.
- `RV002` mit den Scopes `data_export` und `verification`.
- Fremde und unbekannte IDs liefern einheitlich `P0002` bzw. `42501`, kein Orakel.

## 5. Web
- **Routen** (`STATIC_ROUTES`, alle `noindex`, `private, no-store`):
  - `/account/data`, `/account/delete`, `/account/verification`, `/account/reports`, `/account/decisions`, `/account/decisions/:id/appeal`, `/account/report` (`?type=listing|profile&id=`)
  - `/admin/verifications`, `/admin/verifications/:id`, `/admin/reports`, `/admin/reports/:type/:id`, `/admin/users`, `/admin/appeals`, `/admin/appeals/:id`
  - öffentlich: `/cookies`, `/guidelines`, `/sources`
- **Konto löschen:**
  - Die Seite erklärt, was gelöscht wird und was pseudonymisiert bleibt.
  - Danach eine frische Anmeldung per Code, im Browser wie beim Login (ADR 010, Limits je IP), anschließend der Button „Konto endgültig löschen“.
  - Die Server Action ruft `getUser()`, `request_account_deletion` und die Function auf, meldet ab und leitet auf `/{lang}?deleted=1` (Hinweis ohne Daten).
  - Ohne JavaScript geht nur der Bestätigungsschritt; die Code-Anforderung braucht JavaScript, wie beim Login.
- **Datenexport:**
  - `POST /api/account/export` (Route-Handler, Origin-Prüfung, `getUser()`).
  - Antwort: `Content-Disposition: attachment; filename="revier-export-<datum>.json"`, `no-store`, `X-Content-Type-Options: nosniff`.
  - Das Formular funktioniert ohne JavaScript. Fehler und Limit führen auf die Seite mit `?error=` zurück.
- **Melden:**
  - Der Link „Melden“ an Detail und Anbieterprofil ist statisch und lässt die öffentliche gecachte Seite unpersonalisiert.
  - Er führt auf `/account/report` mit Login-Rücksprung. Die Seite prüft das Ziel per `public_page_state`; fremde, unbekannte und nicht sichtbare Ziele ergeben dieselbe Seite.
  - Gründe je Zieltyp, Notiz ≤ 1000, Häkchen „in gutem Glauben“. Ohne JavaScript per PRG.
- **Verifizierung (Nutzer):**
  - Status, Dokumenttyp wählen, Datei hochladen (Browser-Client in den Pfad des Antrags), Einreichen, Zurückziehen.
  - Hinweis auf die Aufbewahrung von 30 Tagen. Ohne JavaScript nur Anzeige des Status.
- **Admin:**
  - Übersicht mit Zählern (Anzeigen, Verifizierungen, Meldungen, Beschwerden).
  - Verifizierung: Dokument als `<img>` bzw. PDF-Link auf die signierte URL in einem neuen Tab; Entscheidung mit Codes.
  - Meldungen: gruppiert, Zielansicht, Kopie der Nachricht hinter einem Klick „Gemeldete Nachricht anzeigen“ (wird auditiert), Maßnahmen.
  - Konto: Suche, Sperren/Entsperren, Verwarnen.
  - Beschwerden: Liste und Entscheidung.
  - Nonce-CSP wie bisher; `img-src` für signierte Storage-URLs ist schon erlaubt (Fotos in der Prüfansicht).
- **Cookies und Consent:**
  - `web/lib/consent/inventory.ts` ist die eine Quelle: Name bzw. Muster, Zweck, Anbieter, Dauer, Kategorie (`necessary | optional`), Art (`cookie | localStorage | sessionStorage | indexedDB | cache`).
  - Startbestand:
    - Supabase-Session (`sb-*-auth-token*`) und PKCE-Verifier.
    - Karte als notwendiger eigener Dienst, ohne Speicher.
    - Kein `NEXT_LOCALE`: `localeCookie: false` in `i18n/routing.ts`, weil die Sprache immer in der URL steht. `/` wählt nach `Accept-Language` (QA M0 F7).
  - Die Seite `/cookies` rendert das Inventar in 4 Sprachen.
  - **Vorbereitet:**
    - Vertrag für Kategorien und das Einwilligungs-Cookie `revier_consent` (Version, Kategorien, Zeitpunkt), festgehalten in ADR 021.
    - Ein Vitest-Guard schlägt fehl, sobald ein Eintrag `optional` ist und kein Banner existiert.
    - Kein Banner-Code in M9 (Frage 9.7).
- **Rechtstexte:**
  - Platzhalter mit Gliederung und Stichpunkten aus dem System, jede Seite mit dem markierten Hinweis „Platzhalter, nicht rechtsverbindlich“.
  - Die Versionen in `app_settings` bleiben unverändert, es gibt also keine neue Zustimmung für Platzhalter.
  - Footer: Impressum, Datenschutz, Nutzungsbedingungen, Richtlinien, Cookie-Einstellungen, Datenquellen.
- **Service-Schicht:**
  - `lib/services/account.ts` (Löschung, Export)
  - `verification.ts`
  - `reports.ts` (Melden; `reportFromChat` nutzt es mit)
  - `admin-reports.ts`, `admin-verifications.ts`, `admin-users.ts`
  - `appeals.ts`
- **Texte:** neue Bereiche `AccountDelete.*`, `DataExport.*`, `Verification.*`, `Report.*`, `Decisions.*`, `Appeal.*`, `Cookies.*`, `Admin.verifications|reports|users|appeals.*` sowie die Mailtexte, in en/de/cs/pl. Glossar: Dokumenttypen je Land, „Beschwerde/Anfechten“, „Sperre“ vs. „Blockieren“ (bestehend), „Datenexport“, „Konto löschen“.

## 6. Sicherheit (für das Review)
- **service_role** gibt es nur in den Edge Functions `delete-account`/`account-maintenance`. Im Web kommt kein service_role-Code dazu; Löschung und Export laufen über die Session des Nutzers und Definer-RPCs mit Allowlist.
- **Frische Anmeldung** wird in der DB über `amr` geprüft, nicht im Client. Eine gestohlene Session allein kann ohne Zugriff auf das Postfach kein Konto löschen.
- **Export:**
  - nur eigene Daten, Allowlist, pgTAP prüft die Schlüsselmenge exakt;
  - keine fremden Meldungen, keine Admin-Daten;
  - Rate-Limit;
  - POST mit Origin-Prüfung und `no-store`;
  - keine Daten in Logs.
- **Dokumente:**
  - privater Bucket, Upload nur auf den Pfad des eigenen Antrags;
  - Admins sehen sie per 60-s-URL, jeder Abruf wird auditiert;
  - nie öffentlich, nie im Export, nie in Mails;
  - Frist 30 Tage.
  - Restrisiko: Hochgeladene PDFs öffnen sich im Browser des Admins auf der Storage-Origin, nicht auf unserer.
- **Melden ohne Orakel:**
  - nur sichtbare Ziele (`can_report`);
  - gleiche Antwort für fremd und unbekannt;
  - Grenze 20 je 24 h.
- **Admin-Aktionen:**
  - aal2;
  - Vier-Augen bei Verifizierung (nicht das eigene Konto) und bei Beschwerden (nicht der ursprüngliche Admin);
  - keine Sperre und keine Löschung aktiver Admins;
  - jede Maßnahme und jede Einsicht in gesicherte Nachrichten im Audit.
- **Mails:** Begründungen nur escaped, kein Admin und kein Meldender, keine Koordinaten.
- **Pseudonymisierung:**
  - Nach der Löschung gibt es keinen Weg von der UUID zu Person oder E-Mail (auch `auth.audit_log_entries`).
  - Hinweis für M10: Backups und Logs des Hosters und des Mail-Anbieters enthalten weiter Daten bis zu ihrer Frist; das gehört in die Datenschutzerklärung.
- **Consent:**
  - keine Drittressourcen (CSP bleibt `self` plus Supabase);
  - E2E-Inventar über alle Seitentypen, anonym und angemeldet;
  - kein Cookie vor einer Nutzeraktion außer der Session nach dem Login.

## 7. Tests
- **pgTAP:**
  - `request_account_deletion`: ohne frische Anmeldung `RV007`, als Admin `42501`, gesperrt erlaubt, ohne Zustimmung erlaubt; Wirkung von `deleted_at` (nicht öffentlich, kein Schreiben).
  - **Rest-Inventar nach der Löschung (Akzeptanz a):** Ein Test sucht in allen `uuid`-, `text`- und `jsonb`-Spalten der Schemas `public`, `private`, `auth` und `storage` nach der Nutzer-ID und der E-Mail. Erlaubt sind nur die Reste der Allowlist (`audit_log.target_id`, `reports.target_id`, `reported_message_snapshots.sender_id`). Neue Tabellen fallen damit automatisch auf.
  - `export_my_data`: Schlüsselmenge exakt, keine fremden Daten (zwei Konten mit gemeinsamer Unterhaltung, fremde Meldungen), Rate-Limit.
  - Verifizierung: Pfadbindung im Storage, ohne Datei nicht einreichbar, Limit, Entscheidung nur per RPC (Roh-UPDATE 42501), Vier-Augen, Widerruf, Frist.
  - Meldungen und Maßnahmen: `remove` in `moderate_listing`, Gruppierung, `outcome`, Sperren/Entsperren/Verwarnen inklusive Audit, nicht das eigene Konto und keine Admins, Lesen der Kopien nur mit aal2 und mit Audit.
  - Beschwerde: Frist, eine je Entscheidung, nicht der ursprüngliche Admin, `reversed` stellt wieder her.
  - Benachrichtigungen je Art, Moderations-Mail über einen Server-Pfad mit Flag.
  - Retention-Jobs mit Grenzen (29/31 Tage usw.).
  - `00_meta`-Allowlists.
- **Deno:**
  - `delete-account`: Reihenfolge Storage → prepare → deleteUser, Wiederholung, Secret, 401/403.
  - Mailtexte aller neuen Arten in 4 Sprachen, Platzhalter für Art. 21 markiert, kein `contactPlaceholder` mehr.
- **Integration (lokaler Stack):**
  - Konto mit Anzeige, Fotos, Verifizierungsdokument, Chat, Suchauftrag, Favorit, Meldung und MFA-Faktor löschen → alle Buckets leer unter dem Präfix, `auth.users` und `auth.mfa_factors` ohne das Konto, Rest-Inventar grün (ADR 014: MFA und Rollen).
  - Abbruch nach dem Storage-Schritt → der Cron-Lauf holt nach.
  - Export als JSON gegen das Schema, signierte Foto-URLs erreichbar, Limit.
  - Verifizierung bis zur Mail in Mailpit.
- **E2E (Playwright):**
  - **Cookie-Inventar (Akzeptanz b):** Startseite, Liste, Karte, Detail, Anbieter, Rechtstexte und Login anonym; danach angemeldet Konto, Chat, Suchaufträge und Admin. Gesammelt werden `context.cookies()`, `localStorage`, `sessionStorage`, `indexedDB.databases()` und `caches.keys()`; alles muss im Inventar stehen und `necessary` sein. Dazu: keine Requests an fremde Origins.
  - Konto löschen mit Code aus Mailpit, danach Login als neues Konto.
  - Export-Download.
  - Melden von Anzeige und Profil ohne und mit Login.
  - Verifizierung von Upload bis Badge.
  - Meldungs-Warteschlange mit Entfernen und Mail.
  - Sperren und Beschwerde bis zur Entsperrung.
  - axe, 360 px, 4 Sprachen, ohne JavaScript, wo zugesagt.

## 8. Commits (je Commit pushen, CI grün)
1. Plan, ADR 019 (Löschung, Export, Aufräumjobs; ADR 008 nachgezogen), ADR 020 (Verifizierung, Meldungen, Sperre, Beschwerde), ADR 021 (Cookies und Einwilligung), SPEC v0.11 (3.1, 5, 7.3, 7.5 entschieden), Fehlercodes in ADR 014.
2. Web: Cookie-Inventar und Seite, `localeCookie: false`, Guard-Test, E2E-Inventar (Akzeptanz b), Rechtstext-Platzhalter, Richtlinien, Datenquellen, Footer.
3. DB: Account-Löschung (`request_account_deletion`, `account_deletions`, prepare), Rest-Inventar-Test, Datenexport mit Limit.
4. Function `delete-account` (Storage, deleteUser, Cron, Vault) mit Integrationstest (Akzeptanz a).
5. Web: `/account/delete` mit frischer Anmeldung, `/account/data` mit Export-Route.
6. DB: Verifizierung (Zeile zuerst, Storage-Policy, Bucket-Typen, RPCs, Limit) und allgemeine Benachrichtigungs-Warteschlange mit Server-Pfad-Auslöser.
7. Web: Verifizierung für Nutzer und Admin-Warteschlange, Mailtexte.
8. DB: Meldungen und Maßnahmen (`remove` in `moderate_listing`, `outcome`, Admin-RPCs, Sperre, Verwarnung, Lesen der Kopien), `my_decisions`, Beschwerden.
9. Web: Melden von Anzeigen und Profilen, `/account/reports`, `/account/decisions`, Beschwerde, Admin für Meldungen, Nutzer und Beschwerden; Mailtexte (Platzhalter aus M8 ersetzt).
10. Aufräumjobs (Function-Schritte und pg_cron), `listings.edited_at`, Hinweis bei verlassenen Entwürfen.
11. Integrations- und E2E-Tests, CHANGELOG (iOS-Lücke I6, Apple-Token-Widerruf, E-Mail ändern), Glossar.

**Teilung (Frage 9.1):** Die Commits 1–5 und 10 tragen beide Akzeptanzkriterien und die App-Store-Pflicht „Account löschen“. Die Commits 6–9 (Verifizierung, Meldungen, DSA) sind fachlich eigenständig und ähnlich groß. Vorschlag: M9a „Konto und Datenschutz“ (1–5, 10, 11) und M9b „Vertrauen und Moderation“ (6–9), mit je eigener QA-Abnahme.

## 9. Fragen an das Review
1. **Teilen?** M9a (Löschung, Export, Consent, Rechtstexte, Jobs; trägt die Akzeptanz) und M9b (Verifizierung, Meldungen, Sperre, Beschwerde) als zwei Schritte mit eigener Abnahme, oder M9 in einem Durchgang?
2. **Melden ohne Konto (DSA Art. 16):** Art. 16 verlangt einen leicht zugänglichen Meldeweg für jedermann. Reicht für den Start „nur eingeloggt“ plus Kontaktadresse im Impressum (Platzhalter), oder braucht es jetzt ein anonymes Formular (dann mit Captcha, M10)? Gehört an den Anwalt; Vorschlag: eingeloggt plus Impressum.
3. **Umfang des Beschwerdewegs (DSA Art. 20):** Ein vollständiges System (Tabelle, Admin-Warteschlange, Vier-Augen, Rückgängigmachen) wie in 4.5, oder schlanker (Beschwerde per Formular als Meldung an das Team, Entscheidung von Hand)? Art. 19 nimmt Kleinst- und Kleinunternehmen von Art. 20 aus; ob das für uns gilt und ob wir es nutzen wollen, klärt der Anwalt. Vorschlag: das System aus 4.5, weil der Aufwand überschaubar ist und App Store wie Nutzer davon profitieren.
4. **Reste und Sonderfälle der Löschung:**
   - Sollen gesicherte Kopien gemeldeter Nachrichten (Text und `sender_id`) und Meldungen gegen das Konto bis `handled_reports_months` bleiben (Beweissicherung) oder mit dem Konto verschwinden?
   - Ist „aktive Admins können erst nach Entzug der Rolle löschen“ richtig (schützt den letzten Admin)?
5. **Frische Anmeldung:** `amr` (`otp`/`oauth`) jünger als 10 Minuten, geprüft in der DB, mit neuem Code `RV007`. Oder lieber `RV005` (Step-up) mit `hint` wiederverwenden?
6. **Inhalt des Exports:**
   - Nachrichten des Gegenübers in eigenen Unterhaltungen mit aufnehmen (Vorschlag: ja, nur mit Anzeigenamen)?
   - Fotos als signierte Links mit 24 h Laufzeit, oder nur Metadaten (der Link in einer weitergegebenen Datei ist ein Zugriff)?
7. **Consent vorbereitet:** Reicht ein Inventar mit Kategorie, ein Vertrag im ADR und ein Guard-Test ohne Banner-Code? Ist `localeCookie: false` (kein `NEXT_LOCALE`) besser, als das Cookie als „notwendig“ einzustufen?
8. **Benachrichtigungen und Entwürfe:**
   - Eine allgemeine Warteschlange `account_notifications(kind)` für alle neuen Dienstmails (Moderations-Mails aus M8 bleiben), oder je Art eine eigene Tabelle wie in M8?
   - Gilt für verlassene Entwürfe „12 Monate ohne Bearbeitung des Entwurfs“ (neue Spalte `edited_at`) oder „ohne Anmeldung des Kontos“?
   - Gehört dieser Job besser nach M10?

**Rechtlich zu prüfen (SPEC 7.2, ins CHANGELOG):**
- Wortlaut von Begründung und Rechtsbehelf (Art. 17, 21).
- Die Zusicherung „in gutem Glauben“ (Art. 16).
- Ein befristeter Zeitraum für Sperren (Art. 23).
- Was das Badge „verifiziert“ zusagt und ob das Ablaufdatum eines Jagdscheins zählt.
- Die Frist von 30 Tagen für Dokumente.
- Die Aufbewahrung des Zustimmungsnachweises und der Beschwerden nach der Löschung.
- Nachrichten beim Gegenüber nach der Löschung (SPEC 7.3).

## 10. Architekt-Review

Stand: 2026-11-08. Geprüft gegen CLAUDE.md, SPEC 2/3/5/6/7/8, ADR 005, 008, 010, 011, 013, 014, 016, 017, 018 und den Bestand (u. a. `20261029100800_storage.sql`, `20261029104500_photo_processing_function.sql`, `20261030110000_moderation_fields.sql`, `20261031120000_public_page_state.sql`, `20261106130000_chat_block_report.sql`, `supabase/config.toml`). Rechtliche Aussagen hier sind technische Annahmen, keine Rechtsberatung; alles DSA-/DSGVO-Bezogene bleibt Platzhalter bis SPEC 7.2.

### 10.1 Blockierend

**B1 – Löschreihenfolge lässt Reste zurück und bricht ab.** Drei Fehler in 4.1:
- `auth.admin.deleteUser` schreibt selbst einen Eintrag `user_deleted` in `auth.audit_log_entries` (mit `user_email` in `traits`). `prepare` läuft davor und löscht diesen Eintrag nicht. Damit fällt Akzeptanz a im echten Stack durch, und im pgTAP (`delete from auth.users` ohne GoTrue) ist der Fehler unsichtbar. Dasselbe gilt für Tabellen ohne FK auf `auth.users` (z. B. `auth.flow_state.user_id`), die die Kaskade nicht erreicht.
- Wettlauf mit `process-listing-photo`: Ein Claim kurz vor `deleted_at` lädt nach dem Storage-Schritt noch nach `listing-photos` hoch (`complete_photo_processing` sagt `processed`, solange die Zeile da ist). Die Dateien liegen dann ohne Zeile da.
- Nach 10 Versuchen hört der Job auf. Eine Löschung darf nie endgültig liegen bleiben (Art. 17/12 Abs. 3 DSGVO, App Store).

**Auflage zu B1:** Die Reihenfolge in ADR 019 lautet:
1. `deleted_at`
2. Storage-Durchlauf 1
3. `prepare` (Audit-Details)
4. `deleteUser`; 404 zählt als Erfolg, `shouldSoftDelete` bleibt aus
5. `account_deletion_finalize(user_id)`: Er löscht `auth.audit_log_entries` (über `payload->>'actor_id'`, `payload->'traits'->>'user_id'` und die E-Mail aus der Löschzeile), dazu `auth.flow_state` und die übrigen auth-Reste ohne FK.
6. Storage-Durchlauf 2
7. Löschzeile entfernen

Jeder Schritt ist idempotent. Bis Schritt 7 ist die Zeile in `account_deletions` der Anker. Sie hält dafür die E-Mail als Snapshot; die E-Mail wird mit Schritt 7 entfernt. Die Wiederholung bricht nie ab: Backoff (1 min → 1 h), ab 10 Versuchen ein Zähler „Löschungen hängen“ in der Admin-Übersicht, ohne Identität. Den Deno-Test (7) auf diese Reihenfolge anpassen. Den Integrationstest „Abbruch nach `deleteUser`, vor finalize“ ergänzen.

**B2 – Der Nachweis von Akzeptanz a ist zu eng und läuft an der falschen Stelle.**
- Der Inventartest in 7 prüft nur `uuid`/`text`/`jsonb` in vier Schemas. Er übersieht damit `json` (`auth.audit_log_entries.payload`), `varchar` (`auth.refresh_tokens.user_id`), `citext`, Arrays sowie die Schemas `realtime` (`subscription.claims` mit `sub`/`email`), `net` (`_http_response.content`), `cron` (`job_run_details`) und `storage.s3_multipart_uploads`.
- Der Test in pgTAP beweist nur eine Simulation. Storage-Zeilen, die per SQL gelöscht werden, lassen die Dateien im Speicher-Backend liegen.

**Auflage zu B2:**
- Der Test läuft über **alle Nicht-System-Schemas**. Jede Zeile wird als `row_to_json(t)::text` geprüft, die E-Mail ohne Groß-/Kleinschreibung. Bei Bedarf mit einem SQL-Helfer.
- Die Allowlist der Reste nennt je Eintrag Tabelle, Spalte und Grund (Rechtsgrund-Platzhalter) und steht im ADR.
- Der verbindliche Nachweis läuft als **Integrationstest gegen den echten Stack**: GoTrue `deleteUser` und die Storage-API, danach `list` je Bucket unter dem Präfix über die API (nicht nur `storage.objects`). Er nimmt auch MFA, Rollen, Apple-Identität (falls lokal möglich), Chat mit Realtime-Abo und Export-Zähler mit.
- Dazu zwei `00_meta`-Wächter:
  - Jeder Bucket in `storage.buckets` steht in der Löschliste der Function.
  - Jede Tabelle mit Nutzerbezug (FK auf `profiles`/`auth.users` oder Spalte `*user_id`/`*_id` ohne FK) ist in ADR 008 klassifiziert (cascade, set null oder Rest mit Grund).

**B3 – Der Audit der Dokumentansicht lässt sich umgehen.** `verification_docs_select_admin` erlaubt jedem Admin mit aal2 den direkten Lesezugriff über die Storage-API. Die Session liegt in einem nicht-`httpOnly`-Cookie (ADR 010), der Browser des Admins kann `createSignedUrl`/`download` also selbst aufrufen, ohne dass `verification.document_viewed` entsteht. „Jeder Abruf wird auditiert“ ist damit nicht wahr.

**Auflage zu B3:**
- Die Policy verlangt zusätzlich einen Audit-Eintrag `verification.document_viewed` desselben Admins für genau diesen Antrag aus den letzten 2 Minuten. Das ist dasselbe Muster wie `lookup_required` in ADR 014.
- Die RPC `admin_open_verification_document(p_id)` schreibt den Eintrag und liefert den Pfad. Erst danach signiert der Server die URL (60 s).
- pgTAP: Ohne frischen Eintrag gibt es keinen Lesezugriff, auch nicht für Admins.
- Für `reported_message_snapshots` ist das schon so gelöst (keine API-Rechte, Lesen nur per RPC).

### 10.2 Auflagen

**A1 – Ein Auslöseweg für `delete-account`.**
- `verify_jwt = true` plus Cron-Secret ist mit dem bestehenden Muster (`verify_jwt = false` und eigenes Secret, `config.toml`) nicht vereinbar.
- Empfehlung: `request_account_deletion` legt die Zeile an und stößt per pg_net (nach dem Commit) die Function an. Die Function kennt nur das Vault-Secret, mit konstanter Laufzeit beim Vergleich. Die Server Action ruft die Function nicht selbst auf. So gibt es keinen Pfad mit Nutzer-JWT und keinen Fall mit „JWT eines gerade gelöschten Kontos“.
- Der Claim wird ein Lease mit `claim_id`/`claimed_until` wie in ADR 017/018. `for update skip locked` allein endet mit der RPC-Transaktion.
- Antworten und Logs enthalten nur Zähler, keine UUIDs (`net._http_response` speichert die Antwort).
- Der Cron-Lauf ruft die Function nur auf, wenn fällige Zeilen da sind.

**A2 – Storage-Löschung belastbar machen.**
- `list()` der Storage-API arbeitet nicht rekursiv. Die Objektnamen liefert eine service_role-RPC aus `storage.objects` (`bucket_id`, `name like uid || '/%'`). Gelöscht wird per `remove()` in Blöcken ≤ 1000, danach Gegenprobe mit 0.
- Gelöscht wird nie per SQL in `storage.objects`.
- `process-listing-photo` bleibt unverändert; den Wettlauf deckt Durchlauf 2 aus B1 ab.

**A3 – Frische Anmeldung (RV007).**
- Welche `amr`-Methoden GoTrue für Code, Link (`token_hash`, `type=email`), Erstbestätigung und Apple (Web-OAuth, iOS `id_token`) tatsächlich schreibt, wird per Integrationstest gegen den lokalen Stack ermittelt. Die Allowlist steht danach im ADR. `totp` allein zählt nicht.
- Der Code geht an die E-Mail-Adresse aus der Session, nicht an eine eingegebene, mit `shouldCreateUser: false`. Nach `verifyOtp` muss die `sub` der neuen Session gleich der alten sein.
- Hat das Konto einen bestätigten MFA-Faktor (ehemalige Admins), verlangt die RPC zusätzlich aal2.
- iOS (I6) nutzt denselben Vertrag; ADR 019 nennt ihn.

**A4 – Erreichbarkeit der Konto-Seiten.**
- `/account/delete`, `/account/data`, `/account/reports`, `/account/decisions` und `/account/decisions/:id/appeal` prüfen mit `requireSessionUser` und nicht mit `requireOnboardedUser`. Sie gehen also ohne aktuelle Zustimmung und für gesperrte Konten.
- Mit `deleted_at` zeigt die Seite „Löschung läuft“.
- Die Ausnahmen stehen in `guards.test.ts` mit Grund (wie ADR 017).
- Die DB-Seite ist im Plan schon so vorgesehen; ohne die Web-Seite läuft die Zusage für Art. 20 und das App-Store-Löschen ins Leere.

**A5 – Vollständigkeit des Exports maschinell absichern.**
- Neben der exakten Schlüsselmenge ein `00_meta`-Wächter: Jede Tabelle mit Nutzerbezug steht entweder in der Export-Allowlist oder in einer Ausschlussliste mit Grund. Kandidaten, die heute fehlen: `devices` ohne Token, `chat_notifications`-Einstellungen, `legal_acceptances`, `role`, falls vorhanden.
- Daten anderer erscheinen nur als Anzeigename, nie als UUID.
- Größe begrenzen: Rollen-`statement_timeout` von `authenticated` beachten, im Integrationstest mit einem großen Konto messen.
- Der Route-Handler prüft `Origin` **und** `Sec-Fetch-Site` und setzt `Content-Type: application/json; charset=utf-8`.

**A6 – Verifizierung.**
- Das Limit `verification_requests_per_30d` zählt in eigenen Zählerzeilen (`private.verification_attempts`). Heute umgehen `withdraw` (löscht die Zeile) und der 24-h-Aufräumjob das Limit.
- Upload-Policy:
  - exakter Name `= document_path` eines eigenen Antrags mit `status = pending`, `submitted_at is null` und aktivem Konto;
  - keine Update-Policy (kein Upsert);
  - eine Delete-Policy für den Besitzer nur bis zur Einreichung, damit „Zurückziehen“ die Datei sofort löscht und nicht erst nach 24 h.
- Den Inhaltstyp prüfen: Der Bucket prüft nur den vom Client gemeldeten `Content-Type`. Vor dem Einreichen (Function) oder spätestens vor dem Anzeigen im Admin (serverseitig, die ersten Bytes mit dem Admin-Client) die Magic Bytes prüfen: `FFD8FF`, `89504E47`, `%PDF-`. Abweichungen werden nicht angezeigt, sondern markiert.
- Der Widerruf und jeder Wechsel weg von `verified` erhöhen den Cache-Zähler (`bump_public_cache_epoch`), sonst zeigen gecachte Seiten und `verified_only` das Badge weiter.
- Die Begriffe in ADR 020 klarstellen: „nie das eigene Konto“ ist ein Selbstentscheidungsverbot, kein Vier-Augen-Prinzip.
- Der Vertrag für iOS: kein HEIC, also JPEG-Umwandlung in I6, steht im ADR.

**A7 – Moderationspfade.**
- `remove` aus `active`/`paused`/`expired` braucht eine Version. `admin_listing_version` liefert sie heute nur bei `pending_review` (QA M4 F4) und muss für den Meldungsfall erweitert werden, ohne F4 wieder aufzumachen: Die Version gibt es nur über `admin_report_target`.
- Die Rücknahme per Beschwerde (`removed`/`rejected → pending_review`) braucht einen eigenen Guard-Pfad mit Flag (`revier.appeal`) und pgTAP-Tests. Heute verlässt keine Anzeige `removed`.
- Der Audit-Trigger der Anzeigen (`listings_audit` in `moderation_fields`) schreibt heute nur mit `private.is_admin()`. Er braucht dieselbe Flag-Regel wie `listings_moderation_notify`, sonst entsteht auf Server-Pfaden eine Entscheidung ohne Audit: kein Art.-17-Datensatz, kein `decision_audit_id`, nichts für `my_decisions`.

**A8 – Beschwerden.**
- Beschwerden von Meldenden gegen `no_action` müssen eine Wirkung haben: `reversed` öffnet die Meldungen des Ziels wieder und stellt sie vorne in die Warteschlange.
- Das Verbot „nicht der ursprüngliche Admin“ braucht eine Ausweichregel, falls kein anderer aktiver Admin mit aal2 existiert. Dann ist die Entscheidung erlaubt und im Audit markiert (`same_reviewer`). Art. 20 Abs. 6 verlangt qualifiziertes Personal, nicht zwingend eine zweite Person (Anwalt). Ohne diese Regel bleiben Beschwerden bei einem einzigen Admin liegen.
- `appeals.user_id` (cascade oder set null) und `decision_audit_id` (Verhalten, wenn das Audit nach 24 Monaten gelöscht wird) stehen in der FK-Tabelle von ADR 008. Der Plan nennt sonst gleichzeitig „24 Monate“ und die Kaskade.
- `submit_appeal` auf eine fremde, unbekannte oder abgelaufene Entscheidung antwortet einheitlich mit `P0002`.

**A9 – Meldungen (DSA Art. 16, Platzhalter).**
- Eine Eingangsbestätigung (Art. 16 Abs. 4): mindestens die Bestätigungsseite und der Eintrag in „Meine Meldungen“; ob zusätzlich eine Mail nötig ist, entscheidet der Anwalt.
- Höchstens eine offene Meldung je Meldendem und Ziel (Partial Unique Index). Sonst blähen Wiederholungen die Gruppenzähler auf.
- Ein `outcome` `target_gone` für Ziele, die vor der Bearbeitung gelöscht wurden.
- `admin_find_account` teilt sich das Rate-Limit mit `admin_find_user`, und `user.looked_up` speichert nie die gesuchte E-Mail (heute korrekt, im Test festhalten).

**A10 – Nachweis von Akzeptanz b.**
- Das E2E-Inventar prüft zusätzlich die `Set-Cookie`-Header aller Antworten (auch Redirects, `/api/*`, Fehlerseiten) und `navigator.serviceWorker.getRegistrations()`.
- Die Muster im Inventar sind verankert (`^sb-[a-z0-9]+-auth-token(\.\d+)?$`, `…-code-verifier$`), keine freien Wildcards.
- Ein Selbsttest des Tests: Ein künstlich gesetztes, nicht inventarisiertes Cookie lässt ihn fehlschlagen.
- Er läuft am Ende von M9 über alle neuen Seiten (Export, Löschen, Verifizierung, Melden, Admin-Seiten).
- Er ist gegen eine `BASE_URL` lauffähig und steht als Pflichtpunkt für Stage und Produktion in `docs/WEB-RELEASE.md` (M10). Hosting- und CDN-Cookies, etwa Bot-Schutz und Preview-Toolbars, sieht CI nicht.

**A11 – Warteschlange `account_notifications`.**
- `kind` mit Check-Constraint und Payload-Allowlist je Art in der DB.
- `ref_id` verweist auf den Audit- bzw. Fachdatensatz; der Text wird beim Versand daraus gelesen, statt Freitext zu kopieren.
- Keine E-Mail in der Zeile.
- `unique (kind, ref_id, user_id)` für Idempotenz, `user_id` mit cascade, Frist 30 Tage wie die Moderations-Mails.

**A12 – Nie bestätigte Konten über denselben Löschweg.** Der Job legt Zeilen in `account_deletions` an, statt selbst `deleteUser` zu rufen: dieselbe Reihenfolge, dieselben Tests. Bedingungen: `email_confirmed_at is null`, `last_sign_in_at is null`, älter als `unconfirmed_account_days` und keine Identität außer `email`.

**A13 – Cloud-Checkliste.**
- Prüfen, ob die Rolle der Migrationen in der Cloud `delete` auf `auth.audit_log_entries`/`auth.flow_state` darf. Alternative: In den Auth-Einstellungen das Schreiben des Auth-Audits in die Projektdatenbank abschalten; dann gilt die Frist im Log-Dienst und steht in der Datenschutzerklärung.
- Vault-Secret und URL für `delete-account`/`account-maintenance` anlegen.
- Kaskade von MFA und Rollen nach dem Deploy nachweisen (ADR 014).

**A14 – Platzhalter, Doku, Schnitt.**
- Keine Seite und kein ADR nennt Texte, Fristen (30 Tage, 183 Tage, 12/24 Monate) oder das Verfahren „DSA-konform“ oder „fertig“. Jede Rechtsseite und jede Mail mit Rechtsbehelf trägt die Platzhalter-Markierung.
- In die Anwaltsliste im CHANGELOG zusätzlich:
  - Kontaktstellen nach Art. 11/12 (Behörden und Nutzer);
  - Ausnahme nach Art. 19 (Kleinst- und Kleinunternehmen);
  - Transparenzbericht (Art. 15/24);
  - Meldepflicht nach Art. 18;
  - Melden ohne Konto;
  - Sperrdauer (Art. 23);
  - Aufbewahrung der Reste nach der Löschung (Art. 17 Abs. 3 DSGVO);
  - EXIF in Verifizierungsfotos.
- SPEC v0.11 hält den Schnitt M9a/M9b fest (10.4/1) und gibt M9b eigene Akzeptanzkriterien:
  - Upload → Entscheidung → Badge;
  - Meldung → Entfernen → Mails an Betroffene und Meldende;
  - Sperre → Beschwerde → Entsperrung;
  - Audit-Pflicht der Dokumentansicht (B3).
- Die SPEC-Zeile „Consent-Banner führt die Karte“ wird an die Entscheidung 1.4 angepasst.

**A15 – Admins und Löschung.** Bleibt wie geplant (siehe 10.4/4). Für den letzten Admin, der löschen will, braucht es einen Runbook-Eintrag in ADR 005 (zuerst einen weiteren Admin ernennen, Karenz 7 Tage).

### 10.3 Hinweise
- **H1:** EXIF/GPS in Fotos von Dokumenten: Die Fotos sind 30 Tage privat, enthalten aber oft den Wohnort. Später durch den Bildpfad aus ADR 011 schicken (neu kodieren), mit PDF als Ausnahme.
- **H2:** Eine Spalte `blocked_until` (nullable) jetzt anlegen kostet wenig und erspart eine Migration, falls der Anwalt befristete Sperren verlangt (Art. 23).
- **H3:** Für Meldungen gegen Nachrichten gibt es nur Maßnahmen gegen das Konto. Ein späteres `message_hidden` (Text beim Gegenüber ausgeblendet, Kopie bleibt) im ADR als Option vormerken.
- **H4:** `/` mit Auswahl nach `Accept-Language` antwortet mit `Vary: Accept-Language` und `private`. Der Redirect darf nicht ohne `Vary` in einem geteilten Cache landen. `localeCookie: false` beseitigt nebenbei das `Set-Cookie` auf jeder Antwort, das bisher Caching verhinderte.
- **H5:** „Datenquellen“ ist kein Rechtstext-Platzhalter und darf indexierbar sein. ADR 012 sieht dort den ODbL-Download der PLZ-Tabelle vor (Share-Alike); nicht vergessen oder bewusst ins CHANGELOG schreiben.
- **H6:** Nach der Löschung schlägt `signOut({ scope: 'local' })` am Server fehl (Session weg). Den Fehler ignorieren und die Cookies trotzdem löschen.
- **H7:** Die Server Action wartet nicht auf das Ende der Löschung. Sie leitet sofort weiter, und `?deleted=1` sagt „wird gelöscht“, nicht „ist gelöscht“.
- **H8:** Sperrumgehung durch Löschen und Neuregistrieren mit derselben Adresse ist möglich. Ein Hash der Adresse gesperrter Konten wäre ein neues personenbezogenes Datum: nur nach Entscheidung des Anwalts.
- **H9:** `p_note` bei Entscheidungen ist ein Text für Betroffene (Begründung), keine interne Notiz. Die UI beschriftet das Feld so, und interne Notizen gibt es in M9 nicht.
- **H10:** Für spätere Transparenzberichte (Art. 15/24, falls keine Ausnahme greift) laufen Zählwerte als Aggregate. Die Fristjobs löschen sonst die Grundlage.
- **H11:** Verschiebt eine Beschwerde eine abgelehnte Verifizierung, liegt das Dokument nach 30 Tagen nicht mehr vor. Dann heißt `reversed` „neuer Antrag ohne Anrechnung auf das Limit“; so ins ADR.
- **H12:** Die Restrisiken der PDF-Ansicht auf der Storage-Origin sind gering, weil keine Session-Cookies der App auf `*.supabase.co` liegen. `<img>` für Bilder bleibt die sichere Darstellung.

### 10.4 Antworten auf Abschnitt 9
1. **Teilen:** Ja.
   - **M9a „Konto und Datenschutz“:** Commits 1–5, 11, aus 10 die Jobs Löschung nachholen, nie bestätigte Konten, Foto-Eingang und Fotos ohne Zeile, Audit- und Meldungsfristen, Export-Zähler. M9a trägt Akzeptanz a und b.
   - **M9b „Vertrauen und Moderation“:** Commits 6–9, die Benachrichtigungs-Warteschlange und aus 10 die Jobs für Verifizierungsdokumente, verwaiste Anträge, verlassene Entwürfe und Beschwerdefristen; diese hängen am Modell bzw. an der Warteschlange aus M9b.
   - Jeder Teil hat eine eigene QA-Abnahme; M9 gilt erst nach M9b als abgeschlossen. M9a ändert den Bucket `verification-docs` noch nicht, löscht ihn aber unter dem Präfix mit.
2. **Melden ohne Konto:** Für den Start vertretbar ist „eingeloggt“ plus eine funktionierende Kontaktadresse im Impressum (Platzhalter) mit beschriebenem Ablauf: Der Admin legt die Meldung von Hand an, `reporter_id` ist dann `null`. Das ist eine **Rechtsfrage mit Go-live-Bezug**. Das Schema bleibt dafür offen (`reporter_id` ist nullable). Falls der Anwalt ein anonymes Formular verlangt, kommt es mit Captcha in M10. Nicht als „DSA-konform“ ausgeben.
3. **Beschwerdeweg:** Das System aus 4.5 ist richtig, mit den Auflagen A7 und A8. Es ist dieselbe Entscheidungsquelle (Audit) für Begründung, Export und `my_decisions`, und ein späterer Rückbau auf Art. 19 kostet nichts.
4. **Reste und Admins:**
   - Kopien gemeldeter Nachrichten und Meldungen gegen das Konto bleiben bis `handled_reports_months` nach der Bearbeitung, offene bis dahin plus Frist. Grund: Beweissicherung, berechtigtes Interesse; ausdrücklich im ADR und in der Datenschutzerklärung als Platzhalter, Anwalt.
   - Nachrichten des Gelöschten, die nie gemeldet wurden, verschwinden.
   - Admins erst nach Entzug der Rolle: ja (A15).
5. **Frische Anmeldung:** Ein eigener Code `RV007`. Die Abhilfe ist eine andere (E-Mail-Code oder Apple statt TOTP), Clients müssen darauf verzweigen, ohne `hint` zu parsen. Die `amr`-Allowlist folgt A3.
6. **Export:**
   - Nachrichten des Gegenübers: ja, nur mit Anzeigename. Sie sind Teil der eigenen Unterhaltung und in der UI ohnehin sichtbar.
   - Fotos: Statt signierter 24-h-Links (Inhaberzugriff in einer weitergegebenen Datei) Links auf eine eigene Route `GET /{lang}/api/account/photos/{photo_id}`. Die Route verlangt die Session und Eigentum und leitet auf eine 60-s-URL weiter, mit `no-store`. Das erfüllt „Liste mit Links“ (Entscheidung 1.3) ohne Inhaber-Token. Ein weitergegebener Link braucht den Login, und eine abgelaufene Laufzeit gibt es nicht.
   - `export_photo_link_hours` entfällt. Den Vertrag (`photos[].download_url`) legt ADR 019 auch für iOS fest.
7. **Consent:** Ja, mit A10. `localeCookie: false` ist besser als ein „notwendiges“ Locale-Cookie: Datensparsamkeit, kein Klassifizierungsstreit, und es gibt kein `Set-Cookie` mehr auf anonymen Antworten (H4). Der Guard-Test plus das Vertrags-ADR genügen, solange das Inventar nur `necessary` enthält. Den Banner-Code schreibt erst der Schritt, der etwas Optionales einführt.
8. **Benachrichtigungen und Entwürfe:**
   - Eine allgemeine Warteschlange mit A11. Die M8-Tabellen bleiben.
   - Entwürfe: „ohne Bearbeitung des Entwurfs“ (`edited_at`). `last_sign_in_at` ist eine auth-Größe, die Refresh-Tokens verfälschen, und gibt keinen Bezug zum Entwurf.
   - Bestandszeilen: `greatest(created_at, submitted_at)`, statt nur `created_at`.
   - Der Job kommt in M9b, nicht in M10 (SPEC 7.3 weist ihn M9 zu, und er braucht die Warteschlange). Reicht M9b nicht, wird er mit CHANGELOG-Eintrag verschoben.

### 10.5 Freigabe
**Ja, mit Bedingungen.**
- Der Schnitt M9a/M9b wie in 10.4/1.
- B1–B3 sind vor Commit 3 (B1, B2) bzw. vor Commit 6 von M9b (B3) in ADR 019/020 eingearbeitet und mit Tests hinterlegt.
- Die Auflagen gelten je Commit:
  - A1–A5, A10, A12, A13 und A14 in M9a;
  - A6–A9, A11 und A15 in M9b.
- Die Abnahme von Akzeptanz a erfolgt ausschließlich über den Integrationstest gegen den echten Stack (B2), die von Akzeptanz b über das E2E-Inventar mit Selbsttest (A10).
- Rechtsinhalte bleiben markierte Platzhalter.

## 11. Eingearbeitet (Freigabe durch den Nutzer 2026-11-08, mit Teilung in M9a/M9b)
- **Schnitt (10.4 Nr. 1):** M9 wird geteilt.
  - **M9a „Konto und Datenschutz“** trägt die beiden SPEC-Akzeptanzen a und b: Löschung, Export, Consent-Inventar und Seite „Cookie-Einstellungen“, Rechtstext-Platzhalter.
  - **M9b „Vertrauen und Moderation“:** Verifizierung, Melden, Meldungs-Warteschlange, Sperren, DSA-Beschwerden, Moderations-Mails für Server-Pfade, verlassene Entwürfe und die allgemeine Benachrichtigungs-Warteschlange. SPEC v0.11 gibt M9b eigene Akzeptanzkriterien.
  - M9 gilt erst nach M9b als abgeschlossen.
- **Vor Commit 3 in ADR 019 und mit Tests:**
  - **B1, Löschreihenfolge:** `deleted_at` → Storage-Durchlauf 1 → prepare → `deleteUser` (404 = Erfolg) → `account_deletion_finalize` (Auth-Reste wie `audit_log_entries` und `flow_state`) → Storage-Durchlauf 2 → Löschzeile entfernen. Alle Schritte idempotent, Backoff statt Abbruch, ein Zähler „Löschungen hängen“ im Admin.
  - **B2, Nachweis:** Alle Nicht-System-Schemas werden per `row_to_json` durchsucht. Verbindlich ist ein Integrationstest gegen den echten Stack, inklusive Bucket-Listing über die Storage-API. Dazu kommen Wächter in `00_meta`: jeder Bucket steht in der Löschliste, jede Tabelle mit Nutzerbezug ist in ADR 008 eingeordnet.
- **Vor Commit 6 in ADR 020:**
  - **B3:** Die Admin-Policy für Dokumente verlangt einen frischen Audit-Eintrag `verification.document_viewed` (2 Minuten).
- **Auflagen:** A1–A15 gelten als Umsetzungspunkte, die QA-Abnahme prüft sie einzeln.
- **Weitere Antworten aus 10.4:**
  - `RV007` für die frische Anmeldung.
  - Der Export enthält die Nachrichten des Gegenübers mit dessen Anzeigenamen. Fotos verlinkt er über eine eigene Route mit Login, die auf eine 60-Sekunden-URL weiterleitet.
  - `localeCookie: false`.
  - Melden nur eingeloggt plus Kontakt im Impressum. Das ist eine Anwaltsfrage vor dem Go-live, ein anonymes Formular käme mit Captcha in M10.
  - Volles Beschwerdesystem.
  - Admins löschen ihr Konto erst nach Entzug der Rolle.
