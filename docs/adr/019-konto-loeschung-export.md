# ADR 019: Account-Löschung, Datenexport und Aufräumjobs

Status: angenommen (M9a, Plan `docs/plans/M9-plan.md` mit Architekt-Review Abschnitt 10, Freigabe durch den Nutzer 2026-11-08). **Keine Rechtsberatung:** Fristen, verbleibende Reste und ihre Rechtsgründe sind technische Platzhalter bis SPEC 7.2.

## Kontext
SPEC 6 M9a „Konto und Datenschutz“. Akzeptanz a: Ein gelöschter Account verschwindet aus allen Tabellen und Buckets, bis auf gesetzlich nötige Reste (SPEC 7.3, ADR 008).

Nutzer-Entscheidungen vom 2026-11-08:
- Löschung sofort nach Bestätigung, vorher eine frische Anmeldung. Echte Löschung inklusive Chats, Fotos und Dokumenten; Audit- und Moderationsdaten bleiben pseudonymisiert.
- Datenexport als sofortiger JSON-Download im Konto, mit Rate-Limit, Fotos als Liste mit Links.
- Admins löschen ihr Konto erst nach Entzug der Rolle.

Bestand: ADR 008 (Fristen, FK-Tabelle), ADR 010 (Session, `getUser()` für Löschen), ADR 011 (Pfade beginnen mit der Nutzer-ID), ADR 014 (Step-up über `amr`), ADR 017/018 (Cron → pg_net → Function, Vault-Secret, Claim mit `claim_id`).

## Entscheidung

### Löschantrag
- **`public.request_account_deletion()`** (definer, `search_path = ''`), Prüfreihenfolge:
  1. angemeldet, sonst `42501`;
  2. frische Anmeldung (unten), sonst `RV007` mit `hint {"reauth":"required"}`;
  3. hat das Konto einen bestätigten MFA-Faktor (ehemalige Admins), zusätzlich `aal2`, sonst `RV005`;
  4. kein Eintrag in `private.user_roles`, sonst `42501` mit `hint {"reason":"admin_role"}`. Geprüft wird der Rolleneintrag selbst, unabhängig von `aal` und Kontostatus, nicht `private.is_admin()` (das wäre mit `aal1` falsch und ließe Admins durch).
- **Kein Legal-Gate, keine Sperrprüfung:** Auch gesperrte Konten und Konten ohne aktuelle Zustimmung können löschen (App Store, DSGVO).
- **Wirkung in einer Transaktion:**
  - `profiles.deleted_at = now()` (bleibt bei Wiederholung): Profil, Anzeigen und Chats sind sofort nicht öffentlich und nicht beschreibbar, der Cache-Zähler steigt (bestehender Trigger).
  - Zeile in `private.account_deletions` (`on conflict do nothing`).
  - Anstoß der Function per pg_net (läuft nach dem Commit), Body ohne Nutzer-ID.
- Wiederholter Aufruf ist kein Fehler. Rückgabe `void`.

### Frische Anmeldung (`RV007`, Review A3)
- Die DB prüft `auth.jwt() -> 'amr'`: mindestens ein Eintrag mit einer Methode der Allowlist und `timestamp` jünger als `account_deletion_reauth_minutes` (10). Muster wie der Step-up in ADR 014.
- **Allowlist (`private.has_fresh_login`):** `otp`, `magiclink`, `oauth`, `id_token`. `totp` allein zählt nie. Gemessen am 2026-11-11 gegen den lokalen Stack (GoTrue aus Supabase CLI 3.0.0): Ein Refresh behält den Zeitstempel, eine alte Session wird dadurch nicht „frisch“. `magiclink` und `id_token` stehen vorsorglich in der Liste (ältere GoTrue-Versionen, iOS); nachgemessen wird in I6 und nach dem Deploy (Cloud-Checkliste).

  | Weg | erwartet | gemessen |
  |---|---|---|
  | Code (`verifyOtp` mit `token`) | `otp` | `otp` |
  | Link (`token_hash`, `type=email`) | `otp` oder `magiclink` | `otp` |
  | Erstbestätigung | `otp` oder `email/signup` | `otp` |
  | Apple Web (OAuth) | `oauth` | lokal nicht prüfbar (Apple aus) |
  | Apple iOS (`id_token`) | `oauth` oder `id_token` | offen (I6) |

- **Web:** Die Seite fordert den Code im Browser an (ADR 010, Limits je IP), an die E-Mail-Adresse **aus der Session**, nicht an eine eingegebene, mit `shouldCreateUser: false`. Nach `verifyOtp` muss die `sub` der neuen Session gleich der alten sein, sonst abmelden und Fehler.
- **iOS (I6)** nutzt denselben Vertrag: `RV007` → frischer E-Mail-Code oder frischer Apple-Login; `RV005` → TOTP. Clients verzweigen nach dem Code, nicht nach `hint`.

### Ablauf der Löschung (Review B1)
**Anker:** `private.account_deletions (user_id pk ohne FK, email, requested_at, attempts, next_attempt_at, last_error_at, claim_id, claimed_until)`. RLS an, keine Grants. Die E-Mail ist ein Snapshot für Schritt 5 und verschwindet mit Schritt 7.

| Nr. | Schritt | idempotent, weil |
|---|---|---|
| 1 | `deleted_at` setzen (RPC bzw. Job A12) | bleibt gesetzt |
| 2 | Storage-Durchlauf 1: alle Objekte unter `{user_id}/` in jedem Bucket der Löschliste | Gegenprobe 0 |
| 3 | `private.account_deletion_prepare(user_id)`: `details.user_id` aus dem Audit entfernen | Update ohne Treffer |
| 4 | `auth.admin.deleteUser(user_id)`, `shouldSoftDelete` aus; 404 zählt als Erfolg | Kaskade auf `profiles`/`auth.users` |
| 5 | `private.account_deletion_finalize(user_id)`: `auth.audit_log_entries` (über `payload->>'actor_id'`, `payload->'traits'->>'user_id'` und die E-Mail der Ankerzeile; `deleteUser` schreibt selbst `user_deleted` mit E-Mail), `auth.flow_state` und die übrigen auth-Reste ohne FK; dazu Zeilen in `realtime.messages` mit Topic `user:<uuid>` oder der UUID in der Nutzlast (Ereignisse an das Gegenüber tragen `sender_id`, ADR 017) | Delete ohne Treffer |
| 6 | Storage-Durchlauf 2 (fängt späte Uploads von `process-listing-photo` ab) | Gegenprobe 0 |
| 7 | Ankerzeile löschen | – |

- Die Kaskade in Schritt 4 räumt Profil, Anzeigen, Fotozeilen, Chats, Suchaufträge, Treffer, Token, Geräte, Zustimmungen, MFA-Faktoren und Export-Zähler ab und setzt `reports.reporter_id`, `reports.handled_by`, `verifications.reviewed_by` und `audit_log.actor_id` auf `null` (ADR 008).
- Welche auth- und Realtime-Tabellen Schritt 5 braucht, legt der Inventartest fest (unten). Darf die Migrationsrolle dort nicht löschen, wird der Rest mit Grund in die Allowlist aufgenommen und nicht still übergangen.
- **Fehler:** Die Ankerzeile bleibt, `attempts + 1`, `next_attempt_at` mit Backoff (1 min, verdoppelt, höchstens 1 h). **Die Wiederholung bricht nie ab.** Ab 10 Versuchen zeigt die Admin-Übersicht einen Zähler „Löschungen hängen“, ohne Identität.

### Auslöseweg (Review A1)
- **Edge Function `delete-account`:** `verify_jwt = false`, nur `POST`, eigenes Secret im Header, in konstanter Zeit verglichen über die Claim-RPC gegen den Vault (`account_deletion_secret`, `account_deletion_url`), wie ADR 017. Es gibt keinen Pfad mit Nutzer-JWT; die Server Action ruft die Function nicht auf.
- **Auslöser:** der pg_net-Anstoß aus `request_account_deletion` und ein Cron-Job jede Minute, der nur ruft, wenn fällige Zeilen da sind (`next_attempt_at <= now()`, kein laufender Lease). Ohne URL im Vault macht der Job nichts.
- **Claim als Lease:** `public.account_deletion_claim(p_secret, p_limit)` (nur `service_role`, `for update skip locked`, höchstens 20) setzt `claim_id` und `claimed_until` (5 Minuten), zählt `attempts` hoch und setzt `next_attempt_at` schon beim Claim auf den Backoff (1 min · 2^(Versuche−1), höchstens 1 h). Ein abgestürzter Lauf verlängert so ebenfalls den Backoff. Batch-Grenze und Zeitbudget je Lauf.
- **Schritt-RPCs** (alle in `public`, nur `service_role`, nur mit gültigem Lease, sonst `42501`): `account_deletion_objects` (Schritte 2/6, höchstens 1000 Namen je Aufruf), `account_deletion_prepare` (3), `account_deletion_finalize` (5), `account_deletion_complete` (7), `account_deletion_fail` (Lease frei, `last_error_at`). `finalize` und `complete` verweigern mit `55000`, solange `auth.users` die Zeile noch hat. Sie liegen in `public` und nicht in `private`, weil die Function sie über PostgREST ruft (Muster `claim_chat_notifications`).
- **Antworten und Logs** nur als Zähler, keine UUIDs und keine Adressen (`net._http_response` speichert die Antwort).

### Storage (Review A2)
- **Löschliste** `listing-uploads`, `listing-photos`, `verification-docs` steht in der DB; die Function liest sie dort, damit der Wächter dieselbe Liste prüft. M9a ändert `verification-docs` nicht, löscht dort aber unter dem Präfix mit.
- Objektnamen liefert eine `service_role`-RPC aus `storage.objects` (`bucket_id`, `name like uid || '/%'`), weil `list()` nicht rekursiv ist. Gelöscht wird per `remove()` in Blöcken ≤ 1000, danach Gegenprobe mit 0.
- **Nie per SQL** in `storage.objects` löschen, sonst bleiben die Dateien im Speicher-Backend.
- `process-listing-photo` bleibt unverändert; den Wettlauf deckt Durchlauf 2.

### Sitzungen und Web-Ablauf
- `deleteUser` entfernt Sessions und Refresh-Tokens. Das JWT gilt technisch bis zum Ablauf, findet aber keine Daten mehr, und `is_active_user` ist falsch.
- Die Server Action ruft `getUser()` und `request_account_deletion`, meldet lokal ab (Fehler von `signOut` ignorieren, Cookies trotzdem löschen, H6) und leitet sofort auf `/{lang}?deleted=1`. Der Hinweis sagt „wird gelöscht“, nicht „ist gelöscht“ (H7).
- **Apple:** Der Token-Widerruf bei Löschung (Apple-Vorgabe) kommt erst, wenn Apple eingeschaltet wird (SPEC 7.1). Bis dahin Lücke im CHANGELOG und Vorbedingung für `NEXT_PUBLIC_AUTH_APPLE_ENABLED`.

### Umsetzung im Web (Commit 5)
- `/account/delete`: Schritt 1 erneute Anmeldung im Browser (`ReauthForm`: Code an die Adresse der Session, `shouldCreateUser: false`, `emailRedirectTo` über `/auth/confirm` wie der Login; gleiche `sub` nach `verifyOtp`; bei bestätigtem TOTP-Faktor zusätzlich `challengeAndVerify`). Schritt 2 Bestätigung per Server Action mit Pflicht-Häkchen, auch ohne JavaScript. Fehler aus der RPC als `?error=reauth|step_up|admin_role|failed`.
- Anders als beim Login zeigt die Seite die Sperrfrist von GoTrue zwischen zwei Mails an (`429 over_email_send_rate_limit`): Es ist die eigene Adresse, eine Konto-Enumeration gibt es hier nicht. Gefunden im E2E (ein Login kurz vor dem Löschen löste die Sperre aus).
- Der Hinweis „wird gelöscht“ auf `/{lang}?deleted=1` ist eine Client-Komponente, damit die gecachte Startseite statisch bleibt; ohne JavaScript entfällt nur der Hinweis.
- `/account/data`: Formular an `POST /api/account/export`; `GET /api/account/photos/{id}` signiert mit dem Client des Nutzers (`listing_photos` mit `listings!inner(owner_id)`).
- Admin-Übersicht: `admin_stuck_account_deletions` als Satz nur bei Anzahl > 0.
- Links auf Export und Löschen im Konto und auf der Willkommensseite (ohne Zustimmung erreichbar); `guards.test.ts` hält fest, dass diese Seiten nur die Session prüfen.

### Erreichbarkeit (Review A4)
- `/account/delete`, `/account/data` (M9a) sowie `/account/reports`, `/account/decisions` und `/account/decisions/:id/appeal` (M9b) prüfen mit `requireSessionUser`, nicht mit `requireOnboardedUser`: Sie gehen ohne aktuelle Zustimmung und für gesperrte Konten.
- Mit `deleted_at` zeigen die Konto-Seiten „Löschung läuft“.
- Die Ausnahmen stehen mit Grund in `guards.test.ts` (wie ADR 017).

### Was bleibt (Allowlist der Reste, Review B2)
Alles andere mit Bezug auf die Nutzer-ID oder E-Mail ist nach Schritt 7 ein Fehler.

| Tabelle | Spalte | Inhalt | Grund (Platzhalter, Anwalt) | Frist |
|---|---|---|---|---|
| `public.audit_log` | `target_id` (`actor_id` ist `null`) | UUID als Pseudonym, ohne Weg zu Person oder E-Mail | Nachweis von Moderations- und Admin-Entscheidungen (DSA Art. 17/20, berechtigtes Interesse) | `audit_log_months` (24) |
| `public.reports` | `target_id` bei `target_type = profile` | UUID als Pseudonym | Beweissicherung | `handled_reports_months` (12) nach Bearbeitung; offene bis zur Bearbeitung plus Frist |
| `private.reported_message_snapshots` | `sender_id`, `body` | Kopie gemeldeter Nachrichten des Kontos | Beweissicherung | wie die Meldung (Kaskade über `report_id`) |

- Nie gemeldete Nachrichten des Kontos verschwinden, auch beim Gegenüber (SPEC 7.3, Anwalt).
- Logs und Backups des Hosters und des Mail-Anbieters enthalten Daten bis zu deren Frist (M10, Datenschutzerklärung).

### Nachweis von Akzeptanz a (Review B2)
- **pgTAP-Inventar:** Ein SQL-Helfer durchsucht **alle Nicht-System-Schemas** (alles außer `pg_*` und `information_schema`): jede Zeile als `row_to_json(t)::text`, Nutzer-ID und E-Mail ohne Groß-/Kleinschreibung. Damit sind auch `json`, `varchar`, `citext`, Arrays und die Schemas `realtime`, `net`, `cron` und `storage` erfasst. Erlaubt sind nur die Einträge der Allowlist oben; neue Tabellen fallen automatisch auf.
- **Verbindlich ist der Integrationstest gegen den echten lokalen Stack:** GoTrue `deleteUser`, Storage-API, danach Gegenprobe je Bucket über die API (Listing je bekanntem Unterordner, Download der bekannten Pfade ergibt 404) und das Inventar.
  - Fixture: Anzeige mit Fotos, Verifizierungsdokument, Chat mit offenem Realtime-Abo, Suchauftrag mit Treffer, Favorit, Blockierung, eigene und fremde Meldung, MFA-Faktor (ehemaliger Admin, Rolle entzogen), Export-Zähler, Apple-Identität, falls lokal möglich.
  - Fälle: Normalfall; Abbruch nach Storage-Durchlauf 1; Abbruch nach `deleteUser` vor `finalize`; Upload zwischen Durchlauf 1 und 2. Jeweils holt der nächste Lauf nach.
- **Deno:** Reihenfolge der Schritte 2–7, Wiederholung mit Backoff, Secret, 403 bei falschem Secret, 405 außer POST.
- **Umsetzung (Commit 4):** `supabase/functions/delete-account` mit `handler.ts` (Ablauf, Abhängigkeiten injiziert, Deno-Tests mit Mocks) und `index.ts` (Verdrahtung). Zeitbudget 40 s je Lauf, höchstens 5 Zeilen; übrige Zeilen gehen per `fail` zurück. `web/integration/account-deletion.test.ts` prüft gegen den echten Stack den Normalfall, die drei Abbruchfälle und den Auslöseweg über pg_net (Vault-URL `http://kong:8000/functions/v1/delete-account`). Der Normalfall nutzt Realtime-Ereignisse aus den Chat-Triggern statt eines offenen Abos; eine Apple-Identität ist lokal nicht anlegbar (Apple aus).
- **Lokal einschalten:** `supabase db query "select vault.create_secret('http://kong:8000/functions/v1/delete-account', 'account_deletion_url')"`; ohne URL bleiben Löschanträge liegen, bis sie gesetzt ist (der Cron holt dann nach).
- **`00_meta`-Wächter:**
  - Jeder Bucket in `storage.buckets` steht in der Löschliste.
  - Jede Tabelle mit Nutzerbezug (FK auf `profiles`/`auth.users` oder Spalte `*user_id`/`*_id` ohne FK) ist in ADR 008 eingeordnet (cascade, set null oder Rest mit Grund).

### Nie bestätigte Konten (Review A12)
- Ein täglicher Job legt Ankerzeilen an und setzt `deleted_at`, statt selbst `deleteUser` zu rufen: dieselbe Reihenfolge, dieselben Tests.
- Bedingungen: `email_confirmed_at is null`, `last_sign_in_at is null`, älter als `unconfirmed_account_days` (7) und keine Identität außer `email`.

### Datenexport (Review A5)
- **`public.export_my_data()`** (definer, nur der Aufrufer, ohne Legal-Gate, auch für gesperrte Konten; mit `deleted_at` `42501`). Liefert `jsonb` mit `format = "revier-export"`, `version`, `generated_at`.
- **Allowlist je Abschnitt**, keine `select *`. Daten anderer Personen erscheinen nur als Anzeigename, nie als UUID. Maßgeblich ist die exakte Schlüsselmenge im pgTAP.

  | Abschnitt | Inhalt |
  |---|---|
  | `account` | E-Mail, angelegt, letzte Anmeldung |
  | `profile` | Anzeigename, Kontotyp, Firmenname, Land, Sprache, Verifizierungsstatus, Sperrstatus, Mail-Einstellungen |
  | `roles` | Rolle und Datum, falls vorhanden |
  | `legal_acceptances` | Dokument, Version, Quelle, Zeitpunkt |
  | `listings` | alle Inhaltsfelder und Status inkl. Grund-Code und Begründung, Zeitpunkte, Wildarten, Attribute, PLZ und Ort (`listing_places`), `photos[]` mit `id`, Reihenfolge, Alt-Text, Maßen, `download_url` |
  | `favorites` | Anzeigen-ID, Titel, Zeitpunkt |
  | `saved_searches` | Name, Filter, Takt, Mail an/aus, Pause, Ablauf, Treffer mit Anzeigen-ID und Versandzeitpunkt (ADR 018) |
  | `conversations` | eigene Rolle, Anzeigen-ID und Titel, Anzeigename des Gegenübers, Nachrichten beider Seiten mit `from` (`me` / `counterpart`), Text, Zeitpunkt, `read_at` |
  | `blocks` | Anzeigename (Rückfallname wie `my_blocks`), Zeitpunkt |
  | `reports` | eigene Meldungen: Zieltyp, Bezeichnung des Ziels (Titel bzw. Anzeigename), Grund, Notiz, Stand, Zeitpunkte; ohne `handled_by` |
  | `devices` | Plattform, Sprache, Zeitpunkt, ohne Token |
  | `verifications` | Dokumenttyp, Status, Zeitpunkte, Grund-Code, ob das Dokument noch vorliegt; ohne Pfad und Prüfer (M9a: Bestandsspalten) |
  | `reviews` | geschrieben und erhalten (`direction`), Anzeigename des Gegenübers, Bewertung, Text, Zeitpunkt (Tabelle besteht seit M1, im Plan vergessen; ergänzt in Commit 3b) |
  | M9b | `reports[].outcome`, `decisions` (wie `my_decisions`), `appeals`; jede Änderung der Schlüsselmenge erhöht `version` |

- **Umsetzung (Commit 3b):** `version` 1. Die Region steht als `region_code`. Fotos tragen nur ihre `id` (nur verarbeitete Fotos); `download_url` ergänzt die Route `POST /api/account/export` beim Ausliefern, damit die DB `SITE_URL` nicht kennen muss. Daten anderer erscheinen über `private.export_party_name` (Regel wie `my_blocks`: Firmenname bei gewerblichen Konten, `null` bei gelöschten oder gesperrten Konten).
- **Ausschlussliste mit Grund:** Meldungen anderer über das Konto (Schutz der Meldenden); Audit-Einträge und Admin-Identitäten; `admin_lookups`; `unsubscribe_tokens` und alle Hashes; `listing_location_offsets`, `display_location` und `map_point` (Verfremdung, der Punkt ist keine Eingabe); Zähler (`photo_creations`, `listing_creations`, `data_exports`); Versandzustände (`chat_notifications`, `moderation_notifications`, Suchauftrags-Zustand), weil ihr Inhalt in den Abschnitten oben steht.
- **Wächter `00_meta`:** Jede Tabelle mit Nutzerbezug steht entweder in der Export-Allowlist oder in der Ausschlussliste.
- **Rate-Limit:** `export_per_24h` (3), gezählt in `private.data_exports (user_id → profiles cascade, created_at)` unter Advisory-Lock. Fehler `RV002` mit `hint {"retry_after":"<ISO UTC>","scope":"data_export"}`.
- **Größe:** Der Rollen-`statement_timeout` von `authenticated` gilt. Der Integrationstest misst ein großes Konto; reicht es nicht, wird der Export in Commit 3 in Abschnitte geteilt, nicht das Timeout erhöht.
- **Route `POST /api/account/export`:**
  - prüft `Origin` (= `SITE_URL`) **und** `Sec-Fetch-Site` (`same-origin`), dann `getUser()`;
  - Antwort `Content-Type: application/json; charset=utf-8`, `Content-Disposition: attachment; filename="revier-export-<datum>.json"`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`;
  - ohne JavaScript per Formular; Fehler und Limit per 303 auf `/{lang}/account/data?error=<code>`;
  - keine Inhalte in Logs.

### Foto-Links im Export (Review 10.4/6)
- **Route `GET /api/account/photos/{photo_id}`.** Alle Route-Handler liegen ohne Sprachpräfix unter `/api/` (`/api/photos`, `/api/map`, `/api/unsubscribe`, `/api/account/export`); die im Review genannte Form `/{lang}/api/…` entfällt.
- Ablauf: UUID prüfen, `getUser()`. Ohne Session 303 auf `/{lang}/login?next=/{lang}/account/data` (Sprache nach `Accept-Language` wie `/`, weil `next` mit `/{locale}/` beginnen muss, ADR 010). Fremde, unbekannte und unverarbeitete Fotos ergeben dieselbe 404. Für eigene Fotos signiert der Client des Nutzers `storage_path` für 60 Sekunden (die Policy lässt den Besitzer seinen Ordner lesen) und leitet per 303 weiter.
- Header `Cache-Control: private, no-store`, `Referrer-Policy: no-referrer`.
- **Vertrag für Web und iOS:** `photos[].download_url = {SITE_URL}/api/account/photos/{id}`. iOS baut dieselbe URL, damit beide Dateien gleich sind. `export_photo_link_hours` entfällt.

### Aufräumjobs in M9a
| Job | Frist (`app_settings`) | Weg |
|---|---|---|
| Löschungen nachholen | sofort, Backoff bis 1 h | Function `delete-account` |
| Nie bestätigte Konten | `unconfirmed_account_days` (7) | pg_cron legt Ankerzeilen an (A12) |
| Foto-Eingang `listing-uploads` | 24 h | Function `account-maintenance` |
| Dateien in `listing-photos` ohne Zeile | 24 h | Function `account-maintenance` |
| Erledigte Meldungen samt Kopien | `handled_reports_months` (12) nach `handled_at` | pg_cron SQL |
| Audit-Log | `audit_log_months` (24) | pg_cron SQL |
| Export-Zähler | 7 Tage | pg_cron SQL (`data-exports-cleanup`, schon mit Commit 3b) |

- `account-maintenance` hat ein eigenes Vault-Secret und eine eigene URL; ohne URL macht der Job nichts. Storage nur über die API, Batch-Grenze, Zeitbudget, Logs nur als Zähler.
- Die Jobs für Verifizierungsdokumente, verwaiste Anträge, verlassene Entwürfe und Beschwerden folgen in M9b (ADR 020).

### Einstellungen (`app_settings`, M9a)
`account_deletion_reauth_minutes` 10, `export_per_24h` 3, `unconfirmed_account_days` 7. Alle Werte sind Platzhalter (ADR 008).

### Fehlercodes (für Web und iOS)
| Code | Wann | Hinweis |
|---|---|---|
| `42501` | nicht angemeldet; Konto mit Rolle (`hint {"reason":"admin_role"}`); Export während laufender Löschung; falsches Secret der Function | Rolle zuerst entziehen (ADR 005) |
| `RV007` | keine frische Anmeldung (E-Mail-Code oder Apple) in den letzten 10 Minuten | `hint {"reauth":"required"}`; Client verzweigt nach Code |
| `RV005` | Konto mit MFA-Faktor, Session nur `aal1` | TOTP bestätigen, wie ADR 014 |
| `RV002` | Export-Limit | `hint {"retry_after","scope":"data_export"}` |

## Alternativen
- **Löschung mit Karenz** (`account_deletion_grace_days` > 0): vom Nutzer verworfen; der Wert bleibt 0.
- **Function mit Nutzer-JWT aus der Server Action:** zwei Auslösewege, und der letzte Aufruf läuft mit dem JWT eines gerade gelöschten Kontos (A1).
- **Signierte 24-h-Links im Export:** Ein weitergegebener Export wäre ein Zugriff ohne Login (10.4/6).
- **`RV005` mit `hint` für die frische Anmeldung:** andere Abhilfe, Clients müssten `hint` parsen (10.4/5).
- **Inventartest nur in pgTAP:** beweist eine Simulation; Storage-Dateien und GoTrue-Einträge bleiben unsichtbar (B2).
- **Job für unbestätigte Konten mit eigenem `deleteUser`:** zweiter Löschweg mit eigenen Lücken (A12).

## Folgen
- iOS (I6) nutzt `request_account_deletion`, `export_my_data`, `RV007`/`RV005` und den `download_url`-Vertrag. Bis dahin Lücke im CHANGELOG.
- **Cloud-Checkliste (Review A13):**
  - Prüfen, ob die Migrationsrolle in der Cloud auf `auth.audit_log_entries`, `auth.flow_state` und `realtime.messages` löschen darf. Sonst in den Auth-Einstellungen das Schreiben des Auth-Audits in die Projektdatenbank abschalten; dann gilt die Frist des Log-Dienstes und steht in der Datenschutzerklärung.
  - Vault-Secret und URL für `delete-account` und `account-maintenance` anlegen.
  - Kaskade von MFA-Faktoren und Rollen nach dem Deploy nachweisen (ADR 014).
  - `amr`-Allowlist nach dem Deploy mit einem echten Login gegenprüfen.
- Die Datenschutzerklärung (Platzhalter) nennt Löschung, Reste, Export und die Fristen; alles bleibt bis SPEC 7.2 als Platzhalter markiert.
- Restrisiko H8: Sperrumgehung durch Löschen und Neuregistrieren; ein Hash der Adresse nur nach Entscheidung des Anwalts.
