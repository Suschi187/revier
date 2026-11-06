# Plan M8 – Suchaufträge (Web)

Stand: 2026-11-06, mit Architekt-Review (Abschnitt 10) und Freigabe (Abschnitt 11).

## 0. Auftrag und Akzeptanz (SPEC 6)
- Filter speichern, serverseitiger Abgleich bei neuer Freigabe (Edge Function), E-Mail-Benachrichtigung.
- **Akzeptanz:** Eine neue passende Anzeige löst genau eine E-Mail aus.

## 1. Entscheidungen des Nutzers (2026-11-06)
1. **Takt je Suchauftrag wählbar:** „sofort“ (gebündelt, wenige Minuten nach der Freigabe) oder „täglich“ (eine Sammelmail am Morgen).
2. **Abbestellen per Klick (RFC 8058)** kommt in M8, für Suchauftrags- und Chat-Mails.
3. **Moderations-Mails an Besitzer** (freigegeben, abgelehnt, entfernt) kommen in M8. Sie waren seit M4 offen.
4. **Laufzeit:** Ein Suchauftrag läuft 6 Wochen. Der Besitzer kann ihn jederzeit pausieren, fortsetzen, verlängern oder löschen. Das gilt für Suchen nach Angeboten wie nach Gesuchen. Die Laufzeit der Anzeigen (60 Tage) bleibt unverändert.

## 2. Umfang
- **Drin:**
  - „Suche speichern“ aus der Suche und der Kartenansicht (eingeloggt; anonym geht es über den Login und zurück).
  - Konto-Seite `/account/searches`: Liste, umbenennen, Takt, E-Mail an/aus, pausieren/fortsetzen, verlängern, löschen, „Ergebnisse ansehen“.
  - Abgleich in der DB bei der ersten Freigabe einer Anzeige; Versand über eine Edge Function.
  - Abbestellen per Klick (Mail-Header und Seite) für Suchaufträge und Chat.
  - Moderations-Mails an Besitzer.
- **Nicht drin:**
  - Push und iOS (I6; `notify_push` bleibt ungenutzt, die Lücke kommt ins CHANGELOG).
  - Filter eines bestehenden Suchauftrags bearbeiten (stattdessen öffnen, anpassen, neu speichern).
  - Erinnerungsmail vor dem Ablauf (Frage 9.4).
  - Echter Mail-Anbieter (SPEC 7.11, M10).

## 3. Bestand
- `saved_searches` (M1): `user_id`, `name` 1–100, `filters` jsonb ≤ 4096 Byte, `notify_push`, `notify_email` (Standard true), `last_notified_at`; höchstens 25 je Konto; RLS `saved_searches_own`; Spaltengrants für insert/update.
- Filterformat v1 (ADR 015) mit `private.search_filters_error` und gemeinsamen Fixtures (`search_filters.json`).
- `listings.published_at` wird bei der ersten Freigabe gesetzt und bleibt danach fest (auch bei erneuter Prüfung, Pausieren, Fortsetzen). Das ist das Merkmal „neue Anzeige“.
- M7-Mailweg: pg_cron → pg_net → Kong → Edge Function → SMTP (Mailpit), Secret im Vault mit SHA-256-Vergleich, claim/release/confirm, höchstens einmal, 3 Versuche.

## 4. Datenmodell und RPCs
### 4.1 Suchauftrag
- Neue Spalten: `cadence` (`instant | daily`, Standard `instant`), `paused_at`, `expires_at` (Server setzt `now() + saved_search_days`), `filters_version` bleibt im jsonb (`v: 1`).
- Check: `private.search_filters_error(filters) is null`. Der Server entfernt `sort` beim Speichern, die Reihenfolge spielt für den Abgleich keine Rolle.
- Grants: insert (`name, filters, cadence, notify_email`), update (`name, cadence, notify_email`). `filters` sind nach dem Anlegen fest.
- `paused_at`, `expires_at`, `last_notified_at` setzt nur der Server. Pausieren, Fortsetzen und Verlängern laufen über die Definer-RPCs `pause_saved_search`, `resume_saved_search` und `extend_saved_search`. Verlängern geht erst in den letzten 14 Tagen und setzt `now() + 6 Wochen`.
- Abgelaufene Aufträge bleiben 30 Tage sichtbar und lassen sich verlängern. Danach löscht ein Cron-Job sie (Retention, ADR 008 ergänzen).
- `app_settings`:
  - `saved_search_days` = 42
  - `saved_search_extend_window_days` = 14
  - `saved_search_expired_keep_days` = 30
  - `saved_search_daily_hour` = 7 (Europe/Berlin)
  - `saved_search_instant_min_gap_minutes` = 10
  - `search_email_batch` = 50

### 4.2 Eine Wahrheit für Filter
- Der Bedingungsbau aus `search_listings` wandert in `private.search_where(p_filters jsonb)`. Die Funktion liefert den SQL-Ausdruck mit denselben Parametern `$1…$4`, und `search_listings`, `map_listings` und der Abgleich nutzen sie alle.
- Ein Äquivalenztest (pgTAP über die Fixtures) zeigt: Für jeden Filter liefert der Abgleich genau die Anzeigen, die `search_listings` findet.

### 4.3 Abgleich (nur bei der ersten Freigabe)
- Trigger auf `listings`: Wechselt `published_at` von null auf einen Wert, schreibt er `private.search_match_queue(listing_id)`.
- Treffer werden festgehalten in `private.saved_search_matches(saved_search_id, listing_id, matched_at, claimed_at, sent_at, attempts)`.
  - Der Primärschlüssel `(saved_search_id, listing_id)` stellt sicher, dass dieselbe Kombination nie zweimal gemailt wird.
- Ein Auftrag kommt in Frage, wenn alles davon gilt:
  - er ist nicht pausiert und nicht abgelaufen, `notify_email` ist an;
  - das Konto ist aktiv und die E-Mail bestätigt;
  - er wurde vor `published_at` angelegt;
  - die Anzeige gehört nicht dem Besitzer des Auftrags;
  - keine Sperre in eine der beiden Richtungen;
  - die Anzeige ist zum Zeitpunkt des Abgleichs öffentlich.
- Ein pausierter Auftrag holt nach dem Fortsetzen nichts nach. Was in der Pause freigegeben wurde, bleibt ohne Mail.

### 4.4 Versand
- `claim_search_notifications(p_secret, p_limit)` (Definer, nur service_role):
  1. Verarbeitet zuerst die Warteschlange zu Treffern.
  2. Sucht fällige Empfänger:
     - `instant`: offene Treffer, und die letzte Mail ist mindestens 10 Minuten her.
     - `daily`: ab 07:00 Uhr Ortszeit, höchstens einmal je Kalendertag.
  3. Liefert je Empfänger eine Mail mit allen fälligen Treffern aller seiner Aufträge. Eine Anzeige steht nur einmal darin, auch wenn sie zu mehreren Aufträgen passt.
  4. Prüft beim Claim erneut, ob jede Anzeige noch öffentlich ist. Nicht mehr öffentliche Treffer werden ohne Mail erledigt.
- Inhalt je Treffer:
  - Titel, Region, Preis mit Einheit und Währung, Link zur Detailseite.
  - Nie Koordinaten oder Kontaktdaten.
- Rückmeldung über `confirm_search_notifications` (setzt `sent_at` und `last_notified_at`) bzw. `release_search_notifications`. Höchstens einmal, 3 Versuche, wie in M7.
- Edge Function `send-search-notifications`. Der Mailer wandert nach `functions/_shared/mail/`, und `send-chat-notifications` nutzt ihn mit.
- Cron-Job `search-notifications` jede Minute. Lokal und in der CI ist er ohne URL-Secret inaktiv, wie in M7.

### 4.5 Moderations-Mails
- `moderate_listing` (approve, reject, remove) schreibt `private.moderation_notifications(id, listing_id, owner_id, decision, reason, created_at, claimed_at, sent_at, attempts)`.
- Dieselbe Function versendet sie, mit claim/confirm/release analog zu 4.4.
- Inhalt:
  - Titel der Anzeige, Entscheidung, Begründung (`reject_reason`, beim Entfernen der Grund aus dem Audit) und Link ins Dashboard.
  - Bei Ablehnung und Entfernung zusätzlich der Hinweis auf den Widerspruch (Begründung nach DSA Art. 17).
- Moderations-Mails sind Dienstmails ohne Abbestellen (Frage 9.2).

### 4.6 Abbestellen per Klick
- `private.unsubscribe_tokens(token_hash, user_id, scope, target_id, created_at)`:
  - `scope` ist `saved_search` oder `chat`.
  - Der Token sind 32 zufällige Bytes; gespeichert wird nur der SHA-256.
  - Der Claim erzeugt den Token und gibt ihn einmal an die Function zurück.
  - Aufbewahrung 90 Tage.
- Mail-Header:
  - `List-Unsubscribe: <https://…/unsubscribe?t=…>`
  - `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
- Web:
  - `POST /api/unsubscribe` (Route-Handler, anon) ruft `unsubscribe(p_token)` (Definer). Für `saved_search` setzt das `notify_email = false`, für `chat` `notify_chat_email = false`.
  - Die Antwort ist immer gleich, egal ob der Token gültig ist (kein Orakel).
  - `GET /[locale]/unsubscribe?t=…` zeigt nur eine Bestätigungsseite mit Button. Ein GET ändert nichts, sonst würden Linkscanner abbestellen. Die Seite hat `noindex` und `Referrer-Policy: no-referrer`.
  - Der Token steht nie in Logs.

## 5. Web
- **Speichern:**
  - Ein Button „Suche speichern“ auf `/search` und in der Kartenansicht öffnet ein kleines Formular mit Name (vorbelegt aus den Filtern), Takt und E-Mail an/aus.
  - Server Action mit Zod (`filtersError` aus `lib/search/filters.ts`).
  - Fehlertexte für Limit 25 und ungültige Filter.
  - Funktioniert auch ohne JS (Redirect mit `?error=`, wie in M7).
- **`/account/searches`:**
  - Je Auftrag:
    - Name, Kurzbeschreibung der Filter (bestehende Labels), Status (aktiv, pausiert, läuft ab am …, abgelaufen).
    - Aktionen: Takt, E-Mail, Pausieren/Fortsetzen, Verlängern (nur im Fenster), Löschen mit Bestätigung, „Ergebnisse ansehen“ (Link mit `paramsFromFilters`).
  - Eintrag in der Konto-Navigation; `noindex`.
- **`/[locale]/unsubscribe`:** öffentlich, ohne Login.
- **Service-Schicht:** `lib/services/saved-searches.ts`.
- **Texte:** `SavedSearches.*`, `Unsubscribe.*` und die Mailtexte (Function) in en/de/cs/pl. Glossar: „Suchauftrag“ = saved search / hledací agent / zlecenie wyszukiwania (wird im Review mit dem Glossar abgestimmt).

## 6. Sicherheit (für das Review)
- RLS bleibt besitzerbezogen. Neue Server-Spalten sind durch fehlende Grants geschützt, ein Trigger sichert zusätzlich ab.
- Abgleich und Versand nur als service_role mit Vault-Secret; die Tabellen in `private` haben keine Grants.
- Ein Treffer zeigt nur öffentliche Daten und wird beim Claim erneut auf Sichtbarkeit geprüft.
  - Kein Orakel über nicht freigegebene oder gesperrte Anzeigen.
  - Kein Treffer zwischen gesperrten Nutzern.
- Abbestell-Token sind zufällig, nur gehasht gespeichert, gelten für genau einen Zweck und verraten bei Fehlern nichts.
- Mails enthalten keine Koordinaten und keine Kontaktdaten. Die Logs der Function enthalten nur Zähler.
- Last:
  - Höchstens 25 Aufträge je Konto.
  - Der Abgleich läuft in der DB über `search_where` mit Indizes.
  - Batch-Grenze je Lauf.

## 7. Tests
- **pgTAP:**
  - Spalten und Grants, Check der Filter, Server-Spalten.
  - pause/resume/extend mit Fehlercodes.
  - Äquivalenz von Abgleich und Suche.
  - Genau ein Treffer je Kombination: erneute Freigabe, Pausieren/Fortsetzen und erneute Prüfung erzeugen keinen zweiten.
  - Ausschlüsse: eigene Anzeige, Sperre, pausiert, abgelaufen, angelegt nach der Freigabe.
  - Claim/confirm/release mit Secret.
  - Moderations-Warteschlange.
  - Abbestellen: gültiger, ungültiger und fremder Token, jeweils ohne Orakel.
  - Retention.
  - Allowlists in 00_meta.
- **Deno:** Mailtexte in 4 Sprachen und Header (List-Unsubscribe) im Mailer.
- **Integration (Vitest gegen den lokalen Stack):**
  - Freigabe → Function → Mailpit: genau eine Mail; ein zweiter Lauf versendet keine weitere.
  - Täglicher Takt mit verschobener Uhrzeit (Test-Helper wie in M7).
  - Abbestellen per POST.
- **E2E (Playwright):** Suche speichern, auf der Konto-Seite verwalten, Abbestellseite, axe, 360 px, ohne JS.

## 8. Commits (je Commit pushen, CI grün)
1. Plan, ADR 018 und SPEC-Ergänzung (3.1 `saved_searches`, 7.x Laufzeit).
2. DB: Spalten, RPCs für den Suchauftrag, Retention.
3. DB: `search_where` aus `search_listings`/`map_listings` herauslösen, mit Äquivalenztest.
4. DB: Warteschlange, Treffer, Claim/Confirm/Release, Cron.
5. DB: Moderations-Warteschlange und Abbestell-Token.
6. Function: gemeinsamer Mailer, `send-search-notifications`, Chat-Mail mit List-Unsubscribe.
7. Web: Speichern und Konto-Seite.
8. Web: Abbestellseite und Route-Handler.
9. Integrations- und E2E-Tests, CHANGELOG, Glossar.

## 9. Fragen an das Review
1. Ist `search_where` als dynamisches SQL der richtige Weg für eine Wahrheit, oder lieber eine Funktion `listing_matches(listing, filters)` mit Äquivalenztest?
2. Sollen Moderations-Mails ohne Abbestellen bleiben, weil sie Begründungen nach DSA Art. 17 sind?
3. Soll beim Abbestellen über den Link des Suchauftrags `notify_email = false` gesetzt oder der Auftrag pausiert werden?
4. Brauchen wir eine Erinnerung vor dem Ablauf (zum Beispiel als Hinweis in der letzten Mail statt einer eigenen Mail)?
5. Für den täglichen Takt fest Europe/Berlin, oder eine Zeitzone je Markt?

## 10. Architekt-Review

Stand 2026-11-06. Geprüft gegen CLAUDE.md, SPEC 3.1/6/7, ADR 008, 013, 015, 017 und die Migrationen `favorites_saved_searches`, `search_listings`, `map_point` (`search_conditions`), `map_listings`, `qa_m6_fixes`, `moderate_listing`, `trust_audit`, `publication_fields`, `chat_notifications`, `qa_m7_fixes` sowie `functions/send-chat-notifications`.

### 10.1 Blockierend

**B1 – „Genau eine E-Mail“ ist mit dem Primärschlüssel `(saved_search_id, listing_id)` nicht gesichert.**
- Passt eine Anzeige zu zwei Aufträgen desselben Nutzers mit verschiedenem Takt (einer `instant`, einer `daily`), entstehen zwei Treffer und zwei Mails. 4.4 Nr. 3 entdoppelt nur innerhalb einer Mail.
- Gefordert: Entdoppeln je **(Empfänger, Anzeige)**. Zum Beispiel eine Tabelle `private.search_notified_listings(user_id, listing_id)` mit eindeutigem Schlüssel, beim Claim geschrieben (`on conflict do nothing`, nur neu eingefügte gehen in die Mail). Alternativ `saved_search_matches` mit `user_id` und `unique (user_id, listing_id)`, dann gewinnt der früheste fällige Takt.
- Regel ins ADR: Passt eine Anzeige zu Aufträgen mit beiden Takten, geht sie mit der Sofort-Mail; der tägliche Treffer wird ohne Mail erledigt.
- Test (pgTAP und Integration): zwei Aufträge eines Nutzers (gleicher und gemischter Takt) → genau eine Mail mit der Anzeige genau einmal.

**B2 – Die Buchführung für at-most-once ist nicht festgelegt.**
- `last_notified_at` wird laut 4.4 erst beim Confirm gesetzt und liegt am Auftrag, eine Mail umfasst aber mehrere Aufträge. Damit fehlt der Zustand je Empfänger für die 10-Minuten-Lücke und für „einmal je Kalendertag“, und zwischen Claim und Confirm kann ein zweiter Lauf denselben Empfänger erneut fällig sehen.
- Gefordert:
  - Zustand je Empfänger, z. B. `private.search_notification_state(user_id pk, last_instant_at, last_daily_on date, previous_*)`, **beim Claim** gesetzt (wie `chat_notifications.last_sent_at`), mit `for update skip locked`.
  - Ein geclaimter, nicht bestätigter Treffer wird nie erneut geclaimt, nur nach ausdrücklichem Release (höchstens 3 Versuche). Kein Re-Claim nach Zeitablauf.
  - Der Claim liefert eine `claim_id` je Empfänger. `confirm_*` und `release_*` arbeiten nur mit `claim_id`, nicht mit Empfänger-IDs und Zeitfenster wie in M7. Grund: Läufe überlappen (Cron jede Minute, pg_net-Timeout 20 s, Function läuft weiter), ein Release aus Lauf 1 darf keinen Claim aus Lauf 2 zurücksetzen.
  - `saved_searches.last_notified_at` bleibt eine reine Anzeige, gesetzt beim Confirm.
- Die Akzeptanz lautet technisch „höchstens eine, im Normalfall genau eine“ (Absturz nach dem Claim verliert die Mail, wie ADR 017). So ins ADR 018.

**B3 – Ein einzelner Suchauftrag kann den ganzen Versand lahmlegen.**
- `private.search_conditions` wirft `22023 q`, wenn der tsquery einer Sprachfassung mehr als 32 Knoten hat. `search_filters_error` prüft das **nicht**. Ein solcher Filter besteht den geplanten Check, und der Abgleich bricht im Claim ab, jede Minute erneut, für alle Empfänger.
- Gefordert:
  - Beim Speichern dieselbe Prüfung wie die Suche: `search_filters_error` **und** `search_conditions` (oder eine gemeinsame Validierungsfunktion, die beides tut). Fehler `22023` mit `hint`, im Web als „Suchbegriff zu lang“.
  - Im Abgleich je Auftrag ein Ausnahmeblock: Ein fehlerhafter Auftrag wird übersprungen und gezählt, nie der ganze Lauf.
  - pgTAP: Auftrag mit 33-Knoten-`q` direkt per SQL eingefügt → Abgleich der anderen Aufträge läuft.
- Kein `CHECK` mit `search_filters_error`: Die Funktion liest `regions` und `game_species` (nicht immutable). Ein CHECK darauf bricht Restore-Reihenfolgen (pg_dump, Backups M10) und wird bei geänderten Referenzdaten nicht neu geprüft. Stattdessen ein `before insert or update of filters`-Trigger.

**B4 – RFC 8058 ist so nicht erfüllt.**
- Die Header-URL zeigt auf die GET-Seite `/unsubscribe?t=…`, der POST geht an `/api/unsubscribe`. Nach RFC 8058 POSTet der Mail-Client **an genau die URL aus `List-Unsubscribe`**, ohne Cookies, mit Body `List-Unsubscribe=One-Click`.
- Gefordert:
  - Header: `List-Unsubscribe: <https://{site}/api/unsubscribe?t={token}>` und `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
  - `POST /api/unsubscribe`: Token aus Query **oder** Formularfeld, akzeptiert `application/x-www-form-urlencoded` und `multipart/form-data`, keine Cookies, keine Origin-/CSRF-Prüfung (der Token ist die Berechtigung), antwortet immer `200` mit gleichem Body, ohne Redirect, `Cache-Control: no-store`.
  - `GET /api/unsubscribe?t=…` ändert nichts und leitet per `303` auf `/{lang}/unsubscribe?t=…` (Sprache aus dem Token-Datensatz ist ein Orakel, daher aus `Accept-Language` oder fest `de`). Der Link im Mailtext zeigt direkt auf die lokalisierte Seite.
  - Umfang des Tokens: Eine Suchauftrags-Mail bündelt mehrere Aufträge, `target_id` reicht nicht. Festlegen: Scope `saved_search_mail`, Ziel = Menge der Aufträge dieser Mail (`target_ids uuid[]`); Abbestellen setzt `notify_email = false` für genau diese. Feinsteuerung über `/account/searches`.
  - Deno-Test: Header vorhanden, URL identisch mit der POST-URL, keine CR/LF-Injektion (Token nur hex, `SITE_URL` beim Start auf `https://` bzw. lokal `http://localhost` geprüft).

### 10.2 Auflagen

**A1 – Kein `search_where`, die eine Wahrheit gibt es schon.** `private.search_conditions(f)` (M6, `map_point.sql`) liefert bereits `conds`, `query`, `region_ids`, `species` für `search_listings` und `map_listings`. Commit 3 entfällt. Der Abgleich nutzt `search_conditions` und hängt nur `and l.id = any($5)` an (eigene Parameterposition, `$5` ist in `search_listings` der Cursor; Werte nur per `USING`). Äquivalenztest über alle Fixtures inklusive `bbox`, `q`, `driven_hunt`+Datum, `verified_only`, Preis „auf Anfrage“ mit Währungsfilter.

**A2 – Trigger richtig anlegen.**
- Abgleich: `after insert or update on public.listings for each row when (old.published_at is null and new.published_at is not null)` (bei INSERT `new.published_at is not null`). **Nicht** `after update of published_at`: `published_at` setzt der BEFORE-Trigger `listings_zz_publication_fields`, die Spaltenliste eines UPDATE-Triggers bezieht sich auf die SET-Liste des Statements, der Trigger feuerte nie. pgTAP: Freigabe über `moderate_listing` erzeugt genau einen Queue-Eintrag.
- Moderation: `moderate_listing` ist `security invoker` und kennt kein `remove` (Entscheidungen `approve`, `request_changes`, `reject`; Entfernen geschieht per Status `removed`, einen Web-Pfad gibt es noch nicht). Daher kein Schreiben aus `moderate_listing`, sondern ein Definer-Trigger `after update of status` analog `private.listings_audit` (gleiche Bedingung, `private.is_admin()`), der auch spätere Pfade (M9, SQL) abdeckt. `request_changes` gehört dazu: Auch das ist eine Beschränkung nach DSA Art. 17.
- Begründung aus der Zeile (`reject_code`, `reject_reason`, auch bei `removed` zulässig), nicht aus dem Audit.

**A3 – Beim Claim alle Bedingungen erneut prüfen**, nicht nur die Sichtbarkeit: Auftrag existiert, nicht pausiert, nicht abgelaufen, `notify_email` an; Empfänger aktiv (`is_active_user`), nicht gelöscht; keine Sperre (`is_blocked_pair`); Anzeige `listing_is_public` und fremd. Täglich gesammelte Treffer liegen bis zu 24 h, dazwischen kann abbestellt, pausiert oder gesperrt worden sein. Nicht mehr gültige Treffer ohne Mail erledigen.

**A4 – Abgleich vom Versand trennen und begrenzen.**
- Eigene Funktion `private.process_search_match_queue(p_budget)`, aufgerufen am Anfang des Claims oder als eigener Cron-Job, mit Obergrenze an Anzeigen je Lauf (z. B. 50) und Zeitbudget; Rest bleibt in der Queue.
- Je Lauf **eine** Ausführung je in Frage kommendem Auftrag über alle Anzeigen des Batches (`l.id = any($5)`), nicht je Paar.
- Vorfilter in plain SQL über `filters ->> 'kind'`, `'direction'`, `'country'` gegen die Batch-Anzeigen, bevor dynamisches SQL läuft.
- Messung mit lokal erzeugten 25 000 Aufträgen und 50 Anzeigen; Laufzeit ins CHANGELOG. Ziel: deutlich unter dem pg_net-Timeout.
- Ist die Anzeige beim Abgleich (noch) nicht öffentlich, Eintrag nicht sofort verwerfen, sondern bis zu 24 h in der Queue lassen (schnelles Pausieren nach Freigabe soll nicht dauerhaft „nie gemeldet“ bedeuten); danach verwerfen. Ins ADR.

**A5 – Mailinhalt per Allowlist.** Der Claim baut eine eigene Projektion (`id`, `title`, `kind`, `direction`, Kreis-/Bundesland-Code, `price_minor`, `currency`, `price_unit`), **nicht** `listing_card` (enthält `map_point`, Anbieter-ID). Nie `listing_places`, `display_location`, `listing_location_offsets`, PLZ, Kontaktdaten, Anbietername. pgTAP prüft die Schlüsselmenge der Claim-Antwort exakt. Titel nur escaped im Text, Betreff fest je Sprache, keine Tracking-Pixel, keine Redirect-Links.

**A6 – Abbestell-Seite und Logs.**
- `/{lang}/unsubscribe`: in `STATIC_ROUTES`, `noindex` (Meta und `X-Robots-Tag`), `Referrer-Policy: no-referrer`, `Cache-Control: private, no-store`, keine Drittressourcen, kein DB-Aufruf beim GET (kein Orakel), Token nur im versteckten Formularfeld. Der Sprachumschalter verliert den Token; akzeptabel, die Seite zeigt dann „Link aus der Mail erneut öffnen“.
- `unsubscribe(p_token)`: gleiche Arbeit für gültig und ungültig (Hash immer berechnen), gleicher Rückgabewert `void`; bereits abbestellt ist kein Fehler.
- „Token nie in Logs“ gilt für eigenen Code (Proxy, Route, Function). Access-Logs des Hosters enthalten die Query trotzdem. Ins ADR: Token wirkt nur abbestellend, 90 Tage, Log-Aufbewahrung des Hosters in M10 (wie Karte: höchstens 7 Tage).
- Der Chat-Claim liefert ebenfalls einen Token (Scope `chat`); `claim_chat_notifications` wird dafür erweitert, die Antwortform in ADR 017 nachtragen.

**A7 – Rechte am Suchauftrag.**
- Spalten-Grants ausdrücklich entziehen: `revoke update (filters, notify_push) on public.saved_searches from authenticated` und `revoke insert (notify_push)` (ein `revoke update on table` entfernt Spalten-Grants nicht). pgTAP prüft die exakte Grant-Menge.
- Schutz-Trigger für Server-Spalten über `private.is_server_caller()`, nie `is_server()` (ADR 017).
- Limit-Trigger mit `pg_advisory_xact_lock` je Nutzer wie `favorites_limit`, Fehler `23514` mit `hint {"reason":"saved_searches_limit"}`; abgelaufene Aufträge zählen mit (Fehlertext nennt das).
- Anlegen, Fortsetzen und Verlängern verlangen aktives Konto und aktuelle Zustimmung (`RV001`, ADR 013). Pausieren, E-Mail aus, Löschen und Abbestellen nie (wie Melden/Blockieren).
- `pause/resume/extend` mit fremder und nicht vorhandener ID: derselbe Fehler (`42501` oder `P0002`, einheitlich), kein Orakel. Fehlercodes ins ADR 018 (Fenster: eigener Code mit `hint {"extend_from": "<ISO>"}`).

**A8 – Moderations-Mails.**
- Dienstmails ohne `List-Unsubscribe`. Auch an gesperrte Besitzer (DSA Art. 17 gilt gerade dann), nicht an gelöschte.
- Inhalt: Titel, Entscheidung, Grund als lokalisiertes Label von `reject_code` plus `reject_reason` escaped; nie Admin-Identität, nie interne Notizen.
- Ein Widerspruchsweg im Produkt existiert noch nicht (kein Text, keine Route). Der Hinweis darf nichts versprechen, was es nicht gibt: Verweis auf den bestehenden Kontaktweg (Impressum) und das Dashboard, als Platzhalter markiert, bis SPEC 7.2 („Begründung per E-Mail“) und M9 (Beschwerdeweg Art. 20) geklärt sind.
- Freigabe-Mail ohne Begründungsteil.

**A9 – Retention und Löschung (ADR 008 ergänzen, Jobs in M8).**

| Daten | Frist |
|---|---|
| `search_match_queue` | nach Verarbeitung löschen, unverarbeitbar nach 24 h |
| `saved_search_matches` / Entdopplung | 30 Tage nach `sent_at` bzw. Erledigung, auch geclaimt-unbestätigte |
| `moderation_notifications` | 30 Tage nach Versand oder Aufgabe (Beleg der Entscheidung bleibt im Audit) |
| `unsubscribe_tokens` | 90 Tage |
| abgelaufene Aufträge | `saved_search_expired_keep_days` nach `expires_at` |

Alle neuen Tabellen mit `on delete cascade` auf `profiles`/`saved_searches`/`listings`, Zeilen in die FK-Tabelle von ADR 008. M9-Datenexport nennt Suchaufträge samt Treffern.

**A10 – Eigener Vault-Eintrag** `search_notifications_secret` und `search_notifications_url`, eigener Header (`x-search-notify-secret`), `verify_jwt = false` in `config.toml`, nur POST, Vergleich über SHA-256 wie M7. Ohne URL macht der Job nichts. Kein `service_role`-Key im Vault.

**A11 – Testbarkeit in der CI.**
- Kein `p_now` oder Testschalter in Produktions-RPCs. Zeit wird in Tests über Daten verschoben (Treffer, `search_notification_state`, `created_at` des Auftrags zurückdatieren) und für den täglichen Takt über `app_settings.saved_search_daily_hour` auf die aktuelle Stunde der Testzeit gesetzt.
- Integration ruft die Function direkt (H10 aus M7), Mailpit je Test über eindeutige Empfängeradresse filtern.
- Pflichtfälle: Freigabe → genau eine Mail; zweiter Lauf keine; erneute Prüfung und erneute Freigabe keine; zwei Aufträge (gleicher/gemischter Takt) eine; zwei parallele Claims disjunkt; Release nach Fehler und erneuter Versand; Abbestellen per One-Click-POST ohne Cookies an die Header-URL; Moderations-Mail bei approve, reject, request_changes und per SQL `removed`.

**A12 – Bestehende Zeilen.** Migration setzt `expires_at` und `cadence` für vorhandene Aufträge, prüft vorhandene `filters` mit der neuen Validierung und entfernt `sort`; ungültige werden gelöscht und gezählt (Dev/Stage, Prod hat noch keine).

**A13 – Links und Preise in der Function.** Detail-URL braucht die URL-Wörter je Sprache (`web/lib/public/sections.ts`). Keine stille Kopie: gemeinsame Fixture (`supabase/tests/fixtures/`) mit Abgleichstest auf beiden Seiten. Gleiches für Preisformat (kleinste Einheit, Einheit, Währung, „auf Anfrage“) mit gemeinsamen Fällen; Regionsnamen aus der DB in der Empfängersprache.

**A14 – Doku.** ADR 018 (Abgleich, Entdopplung, Takt, Buchführung, Token, Moderations-Mails, Fehlercodes), SPEC 3.1 (`saved_searches`-Spalten, neue private Tabellen), ADR 017 Nachtrag (Chat-Token, Header), CHANGELOG mit iOS-Lücke: I6 nutzt dieselben RPCs (`pause/resume/extend`), denselben Takt und dieselbe Entdopplung für Push.

### 10.3 Hinweise

- **H1 – `bbox` in gespeicherten Filtern.** Aus der Kartenansicht kommt `bbox` mit. Abgleich über `map_point` (verfremdet) ist datenschutzseitig unkritisch und gleich der Karte. Ausdrücklich entscheiden: übernehmen (Label „Kartenausschnitt“, „Ergebnisse ansehen“ öffnet die Karte) oder beim Speichern entfernen. Empfehlung: übernehmen, im Formular sichtbar machen.
- **H2 – Durchsatz am Morgen.** 50 Empfänger je Minute ergeben 3 000 je Stunde; der tägliche Takt verteilt sich bei vielen Nutzern über Stunden. Für den Start ausreichend, Grenzen des Anbieters in M10 abstimmen; eigene Batch-Einstellung für `daily` erwägen.
- **H3 – Zustellbarkeit (M10).** DKIM muss `List-Unsubscribe` und `List-Unsubscribe-Post` signieren (RFC 8058 Abschnitt 3); Bulk-Sender-Regeln von Gmail/Yahoo verlangen One-Click. In die Cloud-Checkliste.
- **H4 – Pausieren hält die Laufzeit nicht an.** So im UI sagen („läuft trotzdem am … ab“). Verlängern aus einer Pause heraus erlauben.
- **H5 – Glossar.** „hledací agent“ und „zlecenie wyszukiwania“ klingen nach Dienstleistung. Vorschlag: cs „uložené hledání“, pl „zapisane wyszukiwanie“, en „saved search“; „Abbestellen“: en „unsubscribe“, cs „odhlásit odběr“, pl „wypisz się“. Muttersprachlich prüfen (SPEC 7.6).
- **H6 – Datenschutzerklärung (Platzhalter, M9):** neue Verarbeitung Suchaufträge, E-Mail-Benachrichtigung, Abbestell-Token nennen. Nicht als fertig ausgeben.
- **H7 – Kurze Verzögerung für `instant`** (z. B. 2 Minuten nach `published_at`) bündelt Freigaben einer Moderationsrunde und fängt Fehlfreigaben ab, die sofort zurückgenommen werden. Optional.
- **H8 – Function-Laufzeit.** Abgleich, Suchauftrags-, Moderations- und Chat-Mails nicht in einem Aufruf vermischen, wenn die Laufzeit über 60 s steigen kann; getrennte Logs `fn`/`kind` mit Zählern.

### 10.4 Antworten auf Abschnitt 9

1. **Weder noch:** `private.search_conditions` besteht seit M6 und ist bereits die eine Wahrheit für Suche und Karte. Der Abgleich ergänzt nur `and l.id = any($n)` (A1). Eine zeilenweise `listing_matches(listing, filters)` wäre eine zweite Implementierung, die trotz Test auseinanderläuft (Volltext, Regionen, Datumslogik); abgelehnt.
2. **Ja, ohne Abbestellen und ohne `List-Unsubscribe`.** Es sind Dienstmitteilungen zu einer Entscheidung über eigene Inhalte, kein Newsletter; ein Abbestell-Header wäre irreführend. Die vollständige Begründung bleibt im Konto. Ob die Mail allein Art. 17 genügt, ist SPEC 7.2 (Anwalt); Auflagen A8.
3. **`notify_email = false`**, für genau die Aufträge der Mail (B4). Pausieren hat andere Bedeutung (Laufzeit läuft weiter, Fortsetzen holt nicht nach) und ist für den Nutzer schwerer zu verstehen. Die Bestätigungsseite sagt, wo man es wieder einschaltet.
4. **Keine eigene Mail in M8.** Mails im Verlängerungsfenster tragen einen Hinweis „läuft am … ab, hier verlängern“ (Link auf `/account/searches`, Login nötig, kein Token), dazu der Status im Konto. Aufträge ohne Treffer bekommen keinen Hinweis; als offener Punkt ins CHANGELOG, Entscheidung nach Nutzung.
5. **Fest eine Zeitzone, als Einstellung** `saved_search_timezone = 'Europe/Berlin'`. Alle fünf Märkte (DE, AT, CH, CZ, PL) liegen in MEZ/MESZ mit gleichen Umstellungstagen. Berechnung über `now() at time zone`, „Kalendertag“ in derselben Zone. Je Markt erst bei einem Markt außerhalb MEZ.

### 10.5 Freigabe

**Nein, noch nicht.** Freigabe ja, sobald der Plan B1–B4 aufnimmt (Abschnitte 4.1, 4.3, 4.4, 4.6 und 7 angepasst, Commit 3 gestrichen) und die Auflagen A1–A14 als Umsetzungspunkte übernommen sind. Danach ist kein erneutes Architekt-Review nötig, die Prüfung der Auflagen erfolgt in der QA-Abnahme.

Größte Risiken:
- doppelte Mails durch Entdopplung je Auftrag statt je Empfänger und durch überlappende Läufe (B1, B2),
- Ausfall aller Benachrichtigungen durch einen einzelnen Filter (B3),
- nicht funktionierendes One-Click-Abbestellen (B4),
- Last im Abgleich bei vielen Aufträgen (A4).

## 11. Eingearbeitet (Freigabe durch den Nutzer 2026-11-06, H1, H4 und H7 bestätigt)
Die Auflagen A1–A14 gelten als Umsetzungspunkte. Die QA-Abnahme prüft sie einzeln.

**Ersetzt in den Abschnitten 4–8:**
- **B1 – Entdopplung je (Empfänger, Anzeige):**
  - Zusätzliche Tabelle `private.saved_search_deliveries(user_id, listing_id)` mit Primärschlüssel.
  - Passt eine Anzeige zu mehreren Aufträgen, gewinnt der früheste Takt („sofort“ vor „täglich“).
  - Die übrigen Treffer werden ohne Mail als erledigt markiert.
- **B2 – Buchführung:**
  - `private.search_notification_claims(claim_id, user_id, claimed_at, confirmed_at, released_at, attempts)`.
  - Der Claim setzt den Zustand je Empfänger sofort. Treffer hängen an `claim_id` und werden nie erneut geclaimt, außer nach einem Release.
  - Confirm und Release arbeiten nur mit `claim_id`.
  - Akzeptanz technisch: höchstens eine Mail, im Normalfall genau eine. Nach 3 Versuchen ist Schluss.
- **B3 – Robustheit:**
  - Beim Speichern prüfen `search_filters_error` und ein Probelauf von `search_conditions` (fängt die Grenze von 32 Knoten bei `q` ab).
  - Ein Trigger statt CHECK.
  - Der Abgleich läuft je Auftrag in einem eigenen Ausnahmeblock. Ein fehlerhafter Auftrag wird übersprungen und gezählt, er stoppt nicht den Lauf.
- **B4 – RFC 8058:**
  - Header-URL `https://…/api/unsubscribe?t=…`. Dieselbe URL nimmt den POST an: ohne Cookies und CSRF, immer 200, kein Redirect.
  - Der Token deckt die Menge der Aufträge dieser Mail ab (`target_ids uuid[]`).
  - Der Link im Mailtext führt auf die Bestätigungsseite `/[locale]/unsubscribe?t=…`. Ein GET ändert nichts.
- **A1:** Commit 3 entfällt, der Abgleich nutzt die bestehende `private.search_conditions`.
- **A2:**
  - Warteschlange und Moderations-Mails entstehen über AFTER-Trigger auf `listings` (`status`/`published_at`, Definer, analog `listings_audit`).
  - Die Moderations-Mails decken `approve`, `request_changes`, `reject` und `remove` ab.

**Antworten aus 10.4 übernommen:**
- Moderations-Mails ohne Abbestellen.
- Abbestellen setzt `notify_email = false` für die Aufträge der Mail.
- Keine Erinnerungsmail: im Verlängerungsfenster ein Hinweis in der Mail plus Status im Konto.
- Feste Zeitzone Europe/Berlin als Einstellung.

**Hinweise, vorgeschlagen:**
- **H1:** Der Kartenausschnitt wird mitgespeichert und im Formular sichtbar gemacht.
- **H4:** Pausieren hält die Laufzeit nicht an. Das UI sagt das, und Verlängern geht auch aus der Pause.
- **H5:** Glossar en „saved search“, cs „uložené hledání“, pl „zapisane wyszukiwanie“.
- **H7:** Bei „sofort“ 2 Minuten Verzögerung nach der Freigabe (`saved_search_instant_delay_minutes`).
- **H8:** Getrennte Läufe für Abgleich, Suchmails und Moderationsmails, mit Zählern je Art.

**Commits neu:**
1. Plan, ADR 018, SPEC und ADR-Nachträge.
2. DB: Suchauftrag (Spalten, RPCs, Validierung, Migration der Bestandszeilen, Retention).
3. DB: Abgleich, Entdopplung, Claim/Confirm/Release, Cron.
4. DB: Moderations-Warteschlange und Abbestell-Token.
5. Function: gemeinsamer Mailer, `send-search-notifications`, Chat-Mail mit List-Unsubscribe.
6. Web: Speichern und Konto-Seite.
7. Web: Abbestellen (Route-Handler und Seite).
8. Integrations- und E2E-Tests, CHANGELOG, Glossar.
