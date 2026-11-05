# Plan M7 – Chat (Web)

Stand: 2026-11-05, Entwurf für das Architekt-Review.

## 0. Auftrag und Akzeptanz (SPEC 6)
- Unterhaltung pro Anzeige, Realtime, Ungelesen-Zähler, E-Mail-Benachrichtigung bei neuer Nachricht (mit Drosselung), Blockieren und Melden im Chat.
- **Akzeptanz:**
  - a) Zwei Browser-Sitzungen tauschen Nachrichten in Echtzeit.
  - b) Ein blockierter Nutzer kann nicht mehr schreiben.

## 1. Entscheidungen des Nutzers (2026-11-05)
1. **Kontaktdaten im Chat (SPEC 7.8 entschieden):** erlaubt. Enthält eine Nachricht vor dem Absenden eine Telefonnummer, E-Mail-Adresse oder Bankverbindung, zeigt der Chat einen Sicherheitshinweis (Betrug, Vorauszahlung). Das Absenden bleibt möglich. Eigene Texte, nichts von anderen Plattformen übernommen.
2. **E-Mail-Versand (SPEC 7.11 bleibt offen bis M10):** Versand über SMTP mit Konfiguration per Umgebung. Lokal und in der CI geht er an Mailpit, den Anbieter wählen wir zum Release.
3. **Drosselung:** Mail erst, wenn eine Nachricht 2 Minuten ungelesen ist, und höchstens eine Mail je Unterhaltung und Empfänger in 15 Minuten. Beide Werte stehen in `app_settings`.

## 2. Umfang
- **Drin:**
  - Kontakt aus dem Anzeigen-Detail („Nachricht schreiben“).
  - Unterhaltungsliste und Chat-Ansicht unter `/account/messages`.
  - Realtime für neue Nachrichten und den Ungelesen-Zähler.
  - Gelesen-Markierung.
  - E-Mail-Benachrichtigung mit Drosselung und Abmeldung in den Profileinstellungen.
  - Blockieren und Entsperren, mit einer Liste blockierter Nutzer im Konto.
  - Melden einer Nachricht oder eines Profils aus dem Chat.
  - Sicherheitshinweise (Kontaktdaten, Lage teilen).
  - Rate-Limits.
  - Legal-Gate.
- **Nicht drin:**
  - iOS-Chat und Push (I5, auf denselben RPCs). Die Lücke kommt ins CHANGELOG.
  - Meldungs-Warteschlange und Einsicht gemeldeter Nachrichten im Admin (M9).
  - Account-Löschung samt Chats (M9). SPEC 7.3 „Nachrichten beim Gegenüber“ bleibt eine Anwaltsfrage.
  - Anhänge, Bilder, Bearbeiten und Löschen einzelner Nachrichten.
  - Tipp-Anzeige („schreibt …“).
  - Bewertungen (Phase 2).

## 3. Bestand (M1, Review M1)
- Vorhandene Tabellen mit RLS: `blocks`, `conversations` (unique `listing_id, interested_id`, `owner_id` per Trigger aus der Anzeige, `listing_id` wird beim Löschen der Anzeige `null`) und `messages` (1–2000 Zeichen, `read_at`).
- Vorhandene Policies:
  - Teilnehmer lesen.
  - Schreiben nur ohne Sperre (`can_write_in`) und als aktives Konto.
  - Den Kontakt beginnen nur Interessenten an aktiven Anzeigen (`is_blocked_with`).
  - Gelesen setzt nur der Empfänger.
- Vorhandene Meldungen: `reports.target_type` mit `message` und `profile`, `can_report`.
- Lücken, die M7 schließt:
  - Legal-Gate fehlt (SPEC 3.1: „ab M7 prüfen auch Chat-Policies die Zustimmung“).
  - `read_at` ist frei setzbar: Der Empfänger kann einen beliebigen Zeitpunkt setzen, auch wieder ändern.
  - Rate-Limits fehlen.
  - Der Kontakt zur eigenen Anzeige scheitert erst am `check`, mit einem unklaren Fehler.
  - Eine Unterhaltung kann ohne erste Nachricht entstehen.
  - Das Verhalten bei nicht mehr öffentlichen Anzeigen und gesperrten Konten ist nicht beschrieben.

## 4. Datenmodell und RPCs
### 4.1 Kontakt beginnen
- RPC `start_conversation(p_listing_id uuid, p_body text) returns uuid` (security invoker, durch RLS geschützt):
  - Legt Unterhaltung und erste Nachricht in einer Transaktion an.
  - Gibt es die Unterhaltung schon, hängt sie nur die Nachricht an (idempotent über das Unique).
  - Fehlercodes:
    - `RV001` (Zustimmung fehlt)
    - `42501` (eigene oder nicht öffentliche Anzeige, Sperre, gesperrtes Konto, stets dieselbe Meldung)
    - `22023 body`
    - `RV002 rate_limited` (neu)
- Öffentlich heißt hier dasselbe wie in der Suche: `private.listing_is_public` (ADR 015), nicht nur `status = 'active'`.
- Direkte INSERTs auf `conversations` entfallen (Grant entziehen). Eine Unterhaltung entsteht nur mit Nachricht.

### 4.2 Schreiben
- Direktes INSERT auf `messages` bleibt (Policy `messages_insert_participant`), ergänzt um das Legal-Gate und die Rate-Limits per Trigger (`RV001`, `RV002`).
- In bestehenden Unterhaltungen bleibt Schreiben erlaubt, auch wenn die Anzeige pausiert, abgelaufen, entfernt oder gelöscht ist. Begründung: Absprachen laufen weiter, und Beweise bleiben erhalten (Review M1). Gesperrt ist es nur bei einer Sperre in einer der beiden Richtungen oder bei einem gesperrten Konto.
- `body` wird wie Anzeigentexte getrimmt (`private.trim_all`) und auf Steuerzeichen geprüft (ADR 013).

### 4.3 Gelesen
- RPC `mark_conversation_read(p_conversation_id uuid) returns integer` setzt `read_at = now()` für alle ungelesenen Nachrichten des Gegenübers.
- Ein Trigger erzwingt `read_at` nur von `null` auf `now()`. Danach ist der Wert unveränderlich, auch für die Policy.

### 4.4 Lesen
- RPC `my_conversations(p_cursor text default null, p_limit int default 30)` liefert je Unterhaltung:
  - Gegenüber (`public_profiles`, Anzeigename, Konto-Art, „verifiziert“)
  - Anzeige: Titel, Art und öffentlich ja/nein. Ist die Anzeige nicht mehr öffentlich, sieht nur der Besitzer den Titel, das Gegenüber sieht „nicht mehr verfügbar“.
  - `last_message_at`
  - Vorschau der letzten Nachricht (gekürzt)
  - Zahl der ungelesenen Nachrichten
  - Sperrstatus aus Sicht des Nutzers: „du hast blockiert“ bzw. „Schreiben nicht möglich“, ohne zu verraten, wer blockiert hat
  - Keyset-Cursor wie bei der Suche
- RPC `conversation_messages(p_conversation_id, p_before timestamptz default null, p_limit int default 50)` liefert die Nachrichten rückwärts geblättert.
- RPC `unread_count() returns integer` für die Navigation, mit Index auf ungelesene Nachrichten je Empfänger (siehe 4.6).

### 4.5 Rate-Limits (`app_settings`)
- Neue Unterhaltungen: höchstens 20 je 24 h je Konto (`chat_new_conversations_per_day`).
- Nachrichten: höchstens 30 je 10 Minuten je Konto (`chat_messages_per_10min`) und höchstens 10 Nachrichten in Folge ohne Antwort in einer neuen Unterhaltung (`chat_unanswered_max`). Das bremst Spam an Anbieter.
- Konten jünger als 24 h: halbe Werte.
- Fehler `RV002`, `hint = rate_limited`. Das Web zeigt „Bitte später erneut versuchen“.

### 4.6 Indizes
- `messages (conversation_id, created_at desc, id desc)` für die Ansicht.
- Ungelesen je Empfänger: Der Empfänger steht nicht in `messages`. Vorschlag: Spalte `messages.recipient_id`, gesetzt per Trigger aus der Unterhaltung (nie aus dem Request), mit Teil-Index `(recipient_id) where read_at is null`. Damit werden Zähler und Benachrichtigung billig.

### 4.7 Benachrichtigung
- Tabelle `private.chat_notifications (conversation_id, recipient_id, last_sent_at, primary key (conversation_id, recipient_id))` ohne API-Zugriff.
- Profil: `profiles.notify_chat_email boolean not null default true`, im Profil umschaltbar.
- Edge Function `send-chat-notifications`:
  - Läuft jede Minute per `pg_cron` und `pg_net` (lokal und in der Cloud verfügbar). Alternative fürs Review: Scheduled Function.
  - Wählt Empfänger mit ungelesenen Nachrichten älter als 2 Minuten, deren letzte Mail zu dieser Unterhaltung mindestens 15 Minuten her ist. Ausgenommen sind Abgemeldete, gesperrte Konten, blockierte Paare und gelöschte Konten.
  - Sendet eine Mail je Empfänger mit allen betroffenen Unterhaltungen.
  - Der Aufruf von `pg_cron` trägt ein Secret aus dem Vault.
  - Die Function benutzt `service_role`, nur serverseitig.
- **Inhalt der Mail:**
  - In der bevorzugten Sprache des Empfängers (`preferred_language`).
  - Anzeigename des Absenders, Titel der Anzeige (nur wenn öffentlich oder der Empfänger der Besitzer ist), Link zur Unterhaltung, Link zu den Einstellungen.
  - **Kein Nachrichtentext:** Er kann Kontaktdaten oder Lageangaben enthalten und gehört nicht in Postfächer Dritter. Außerdem macht ein festes Format Phishing schwerer.
- **Zustellung:**
  - SMTP mit `SMTP_HOST`/`PORT`/`USER`/`PASS`/`FROM` als Secrets der Function.
  - Lokal geht sie an Mailpit (SMTP-Port in `config.toml` freigeben).
  - Fehlschläge schreiben kein `last_sent_at`. Beim nächsten Lauf wird erneut versucht, höchstens dreimal je Fenster.
- **Idempotenz:** Ein Sperrschloss (Advisory Lock) je Lauf, und `last_sent_at` wird vor dem Versand gesetzt (lieber eine verlorene Mail als doppelte). Fürs Review.
- **Logging:** keine Inhalte, keine Adressen, nur Zahlen.

### 4.8 Realtime
- Vorschlag: **Broadcast aus der Datenbank** (`realtime.broadcast_changes` bzw. `realtime.send` per Trigger) auf private Kanäle, statt `postgres_changes`:
  - `conversation:<id>`: Ereignis „neue Nachricht“ und „gelesen“, nur mit `id`, `sender_id`, `created_at`. Den Text lädt der Client über die RPC (RLS).
  - `user:<id>`: Ereignis „ungelesen geändert“ für den Zähler in der Navigation.
- RLS auf `realtime.messages`: Lesen nur für Teilnehmer bzw. den Nutzer selbst, Schreiben (Client-Broadcast) für niemanden.
- **Begründung:** `postgres_changes` prüft RLS je Abonnent und je Änderung (skaliert schlecht) und überträgt ganze Zeilen. Broadcast ist von Supabase für diesen Fall empfohlen, und wir senden keine Inhalte über den Kanal.
- **Ohne JavaScript:** Der Chat funktioniert per Formular (POST, Redirect, Neuladen), Realtime ist reine Verbesserung. Nach dem Wiederverbinden lädt der Client die Lücke über die RPC nach.

## 5. Web
### 5.1 Routen (alle hinter Login und Onboarding, `noindex`)
- `/[locale]/account/messages`: Unterhaltungsliste, Seiten per Cursor.
- `/[locale]/account/messages/[id]`: Chat-Ansicht.
- `/[locale]/account/messages/new?listing=<id>`: Kontakt beginnen.
  - Gibt es schon eine Unterhaltung, leitet die Seite dorthin um.
  - Bei der eigenen Anzeige zeigt sie einen Hinweis und keine Eingabe.
  - Bei einer nicht öffentlichen Anzeige: 404.
- `/[locale]/account/blocked`: blockierte Nutzer, Entsperren.
- In `STATIC_ROUTES` ergänzen (QA M5 N3). Unbekannte Unterpfade ergeben 404.

### 5.2 Anzeigen-Detail
- Button „Nachricht schreiben“ als statischer Link auf `/account/messages/new?listing=<id>`. Die öffentliche, gecachte Seite bleibt ohne Personalisierung (ADR 015).
- Login mit Rücksprung. Der Rücksprung trägt nur die Anzeigen-ID, nie Text.

### 5.3 Chat-Ansicht
- Kopf: Anzeige (Titel, Link, wenn öffentlich), Gegenüber, Menü mit „Blockieren“, „Profil melden“.
- Nachrichtenliste mit Datum, eigener und fremder Seite, „gelesen“ beim Absender und Laden älterer Nachrichten.
- Je Nachricht des Gegenübers: „Melden“ mit Grund und optionaler Notiz. Die Meldung landet in `reports` und wird in M9 bearbeitet.
- Eingabe:
  - Zeichenzähler (2000) und „Senden“.
  - Strg/Cmd+Enter sendet.
  - Enter macht eine neue Zeile.
  - Fehler werden lokalisiert angezeigt.
- **Sicherheitshinweise:**
  - Fester, kurzer Hinweis über der ersten Nachricht: keine Vorauszahlung an Unbekannte, Kontakt über den Chat.
  - Enthält der Entwurf eine Telefonnummer, E-Mail-Adresse oder IBAN (Muster in `lib/chat/contact-hints.ts`, nur im Browser), erscheint vor dem Senden ein Hinweis. Senden bleibt möglich.
  - Für den Besitzer einer Anzeige mit Punkt (QA M6, ADR 016 „Lage im Chat geteilt“) erscheint ein Hinweis in der Unterhaltung: Wer die genaue Lage teilt, macht auch die verfremdeten Punkte anderer eigener Anzeigen im Kreis rückrechenbar.
- **Gesperrt:** Statt der Eingabe ein neutraler Satz.
  - Wer blockiert hat, sieht „Du hast diese Person blockiert“ mit der Möglichkeit, die Sperre aufzuheben.
  - Das Gegenüber sieht „In dieser Unterhaltung kann nicht mehr geschrieben werden“, ohne Hinweis darauf, wer gesperrt hat. Fürs Review: Das verrät eine Sperre, ist aber unvermeidbar, weil das Schreiben sonst scheinbar gelingt.
- Barrierefreiheit:
  - Liste als `log` mit `aria-live="polite"` nur für neue fremde Nachrichten.
  - Fokus bleibt in der Eingabe.
  - Tastatur für Menü und Melden.
  - 360 px.

### 5.4 Navigation
- „Nachrichten“ mit Zähler (Server-gerendert, Realtime aktualisiert) für angemeldete Nutzer.
- Der Zähler steht nie auf öffentlich gecachten Seiten. Die Kopfzeile ist schon dynamisch (`AuthNav` in Suspense) und lädt den Zähler dort.

### 5.5 Service-Schicht
- `lib/services/chat.ts`: RPCs, Zod für Eingaben, Fehlercodes in Feldcodes.
- `lib/chat/realtime.ts`: Kanal-Abo, Wiederverbinden, Nachladen der Lücke.
- `lib/chat/contact-hints.ts`: Muster, mit Vitest.

### 5.6 Texte
- Neuer Namespace `Chat` in de/en/cs/pl.
- Glossar: „Unterhaltung“, „Nachricht“, „Blockieren“, „Melden“. cs und pl sind als ungeprüft markiert.

## 6. Sicherheit (für das Review)
- Kein Lesen fremder Unterhaltungen (pgTAP über alle RPCs und Tabellen).
- `sender_id`, `recipient_id` und `owner_id` kommen nie aus dem Request.
- Gelesen ist nicht fälschbar.
- Keine Umgehung über `realtime.messages`.
- Die Sperre wirkt in beide Richtungen und auch auf `start_conversation` bei bestehender Unterhaltung.
- Gesperrte Konten (`is_blocked`) schreiben nicht.
- Kein Orakel:
  - Fremde IDs ergeben überall dieselbe Antwort wie nicht vorhandene.
  - Die Sperre ist nur in der eigenen Unterhaltung erkennbar.
- Admins lesen Chats nicht (M1-Entscheidung). Gemeldete Nachrichten sieht die Moderation erst in M9 gezielt.
- Mails ohne Nachrichtentext. Links ohne Token, Login nötig.
- `service_role` nur in der Edge Function. Das Cron-Secret steht im Vault, nie im Repo.
- Logs ohne Inhalte und Adressen.
- XSS: Nachrichten als Text, Links nicht automatisch klickbar. Fürs Review: Autolinks mit `rel="nofollow ugc noopener"` als spätere Option.

## 7. Tests
- **pgTAP:**
  - RLS und RPCs:
    - Teilnehmer und Fremde
    - Sperre in beide Richtungen
    - gesperrtes Konto
    - Legal-Gate
    - eigene Anzeige
    - nicht öffentliche Anzeige
    - Idempotenz von `start_conversation`
  - Rate-Limits
  - Unveränderliches `read_at`
  - `recipient_id` per Trigger
  - Zähler
  - Policies auf `realtime.messages`
  - Auswahl der Benachrichtigung (Drosselung, Abmeldung, Sperre)
  - Meta-Allowlist ergänzen
- **Vitest:** Kontaktmuster, Fehlerabbildung, Cursor.
- **Integration:** zwei supabase-js-Clients über Realtime-Broadcast (fremder Client erhält nichts), Edge Function gegen Mailpit (genau eine Mail im Fenster, keine bei gelesener Nachricht, Sprache des Empfängers, kein Nachrichtentext).
- **E2E (Playwright, zwei Kontexte):**
  - Akzeptanz a: Nachricht erscheint ohne Neuladen beim Gegenüber, Zähler steigt und fällt beim Öffnen.
  - Akzeptanz b: Nach dem Blockieren ist Schreiben nicht möglich, in beide Richtungen, auch per API.
  - Kontakt aus dem Detail.
  - Melden einer Nachricht.
  - Kontaktdaten-Hinweis.
  - ohne JavaScript
  - axe
  - 360 px
  - vier Sprachen
- CI: Die Edge Function läuft in der CI mit (Mailpit-SMTP).

## 8. Commits (je Commit pushen, CI grün)
1. Plan, ADR 017 (Chat: Realtime per Broadcast, Benachrichtigung, Rate-Limits, Sperren), SPEC v0.9 (7.8 entschieden), Glossar.
2. Migration: `recipient_id`, `read_at`-Trigger, Legal-Gate, Rate-Limits, `start_conversation`, `mark_conversation_read`, Grants. pgTAP.
3. Migration: `my_conversations`, `conversation_messages`, `unread_count`, Indizes. pgTAP und Integration.
4. Migration: Realtime-Broadcast-Trigger und Policies auf `realtime.messages`. Integration mit zwei Clients.
5. Web: Unterhaltungsliste, Chat-Ansicht, Senden ohne JavaScript, Navigation mit Zähler, Kontakt aus dem Detail. E2E.
6. Web: Realtime, Gelesen, Nachladen der Lücke. E2E Akzeptanz a.
7. Blockieren, Entsperren, Liste blockierter Nutzer, Melden aus dem Chat, Sicherheitshinweise. E2E Akzeptanz b.
8. Benachrichtigung: `profiles.notify_chat_email`, `private.chat_notifications`, Edge Function, `pg_cron`, Mailpit-SMTP, Einstellung im Profil. Integration.
9. axe, 360 px, vier Sprachen, CHANGELOG mit Testanleitung, ADR 017 auf „umgesetzt“.

## 9. Fragen an das Review
1. Broadcast aus der Datenbank statt `postgres_changes`: Policies auf `realtime.messages`, Themenformat, Verhalten bei abgelaufenem Token.
2. Benachrichtigung per `pg_cron` und `pg_net` oder Scheduled Function. Exactly-once oder at-most-once.
3. `recipient_id` als Spalte oder Zähler über einen Join.
4. Neutrale Sperr-Meldung beim Gegenüber: Reicht das, oder soll Schreiben scheinbar gelingen (Shadow-Block)? Ich empfehle den neutralen Satz, weil ein Shadow-Block Absprachen ins Leere laufen lässt.
5. Schreiben in Unterhaltungen zu entfernten Anzeigen erlauben (Beweise, Absprachen) oder sperren?
6. Rate-Limit-Werte und die halben Werte für neue Konten.

## 10. Architekt-Review

Stand: 2026-11-05. Geprüft: dieser Plan, SPEC v0.8 (3.1, 3.4, 6 M7/M9/I5, 7.3/7.8/7.11, 8), CLAUDE.md, Migrationen `chat_blocks`, `blocked_oracle`, `review_medium`, `trust_audit`, `profiles_privacy`, `legal_acceptances`, `legal_consent_error`, `listing_rules`, `search_listings`, ADR 008/013/014/015/016, `supabase/config.toml`, `supabase/functions/process-listing-photo`, `.github/workflows/{web,supabase}.yml`, `web/lib/public/sections.ts`, `web/lib/auth/paths.ts`, `web/proxy.ts`, `web/lib/security/csp.ts`, `web/components/auth/AuthNav.tsx`.

**Urteil: freigabefähig mit Auflagen.** Die Richtung stimmt (Broadcast statt `postgres_changes`, kein Nachrichtentext in Kanal und Mail, `recipient_id` aus dem Server, neutrale Sperr-Meldung). Drei Punkte müssen vor Commit 2 bzw. 4/8 im Plan und in ADR 017 geklärt sein (B1–B3), dazu 14 Auflagen und 13 Hinweise.

### 10.1 Blockierend (B)

**B1 – `start_conversation` als security invoker passt nicht zum Entzug des Insert-Grants; Server-Erkennung in Triggern.**
- 4.1 sagt „security invoker, durch RLS geschützt“ und „Direkte INSERTs auf `conversations` entfallen (Grant entziehen)“. Ohne Grant scheitert eine Invoker-Funktion am INSERT. Bleibt der Grant, lassen sich Unterhaltungen ohne Nachricht weiter direkt anlegen.
- Wird die Funktion stattdessen `security definer`, ist `current_user = postgres`. Alle Prüfungen, die `private.is_server()` nutzen (z. B. das Muster aus `listings_guard`), würden die neuen Trigger auf `messages` (Legal-Gate, Rate-Limits) innerhalb der RPC still überspringen.
- **Vorschlag:** `start_conversation`, `send_message` (siehe A1) und `mark_conversation_read` als `security definer`, `set search_path = ''`, mit ausdrücklichen Prüfungen in dieser Reihenfolge: angemeldet → aktives Konto → `RV001` → Text (`22023`) → `RV002` → Sichtbarkeit/Sperre/eigene Anzeige (einheitlich `42501`). INSERT-Grant auf `conversations` entziehen. Trigger auf `messages` erkennen den Server nur über `private.is_server_caller()` (Rolle, siehe `review_medium`), nie über `is_server()`, und zählen auf `auth.uid()`. pgTAP beweist: Kein Pfad erzeugt eine Unterhaltung ohne Nachricht, und Rate-Limit und Legal-Gate greifen auch innerhalb der RPC.
- Bei bestehender Unterhaltung gelten die Regeln aus 4.2 (Schreiben erlaubt, auch wenn die Anzeige nicht mehr öffentlich ist). `listing_is_public` wird nur beim Neuanlegen verlangt. Bitte so in 4.1 festhalten, sonst widersprechen sich 4.1 und 4.2.

**B2 – Die Auswahl der Benachrichtigung verschickt endlos Mails, und die Idempotenz widerspricht sich.**
- 4.7 wählt „ungelesene Nachrichten älter als 2 Minuten, letzte Mail mindestens 15 Minuten her“. Liest der Empfänger nie, geht alle 15 Minuten eine neue Mail zu denselben alten Nachrichten raus, ohne Ende. Das schadet dem Nutzer und der Zustellbarkeit.
- „`last_sent_at` vor dem Versand setzen“ und „Fehlschläge schreiben kein `last_sent_at`, höchstens dreimal“ schließen sich gegenseitig aus.
- Mehrere Unterhaltungen mit versetzten Fenstern ergeben bis zu eine Mail pro Minute an denselben Empfänger.
- **Vorschlag:**
  - Bedingung: Es gibt eine ungelesene Nachricht mit `created_at > coalesce(last_sent_at, '-infinity')` und `created_at < now() - 2 min`. Also nur Nachrichten, die seit der letzten Mail neu sind.
  - Zusätzlich je Empfänger höchstens eine Mail je `chat_email_min_interval_minutes` (Start 15), alle fälligen Unterhaltungen gesammelt.
  - Ablauf „claim/release“: `private.claim_chat_notifications(p_limit)` (definer, nur `service_role`) sperrt mit `for update skip locked`, setzt `last_sent_at` und `attempts` und liefert die Empfänger. Nach einem SMTP-Fehler setzt `release_chat_notifications(ids)` `last_sent_at` auf den alten Wert zurück, solange `attempts < 3`. Stürzt die Function ab, ist die Mail verloren (at-most-once). Das ist gewollt und gehört so in ADR 017.
  - Ausnahmen gelten für beide Seiten: Empfänger *und* Absender aktiv (nicht `is_blocked`, kein `deleted_at`), kein blockiertes Paar, Empfänger nicht abgemeldet. Gesperrte Betrüger lösen keine Mails mehr aus.
  - pgTAP: keine zweite Mail ohne neue Nachricht, Grenze je Empfänger, Rücksetzen nach Fehler, höchstens 3 Versuche.

**B3 – In der CI läuft kein Realtime.**
- `web.yml` (E2E/Integration) und `supabase.yml` (pgTAP) starten mit `supabase start -x realtime,…`. Akzeptanz a, die Integration mit zwei Clients und die Policy-Tests sind so nicht ausführbar.
- `realtime.messages` und `realtime.send()` legt der Realtime-Dienst über seine eigenen Migrationen an. `create policy … on realtime.messages` in unserer Migration kann ohne diesen Dienst oder bei falscher Startreihenfolge bei `supabase start`/`db reset` scheitern (lokal, CI, Cloud-Branching).
- **Vorschlag:** In Commit 4 (oder früher) Realtime in beiden Workflows starten. Mit einer Probe belegen, dass `supabase start` + `db reset` frisch durchlaufen und die Policies danach existieren (pgTAP `has_policy` auf `realtime.messages`). Falls die Reihenfolge nicht hält: Policies und Trigger in einer idempotenten Migration mit Existenzprüfung anlegen und das in ADR 017 begründen. Den Edge-Function-Job in `supabase.yml` um `send-chat-notifications` ergänzen (Commit 8).

### 10.2 Auflagen (A)

**A1 – Schreiben nur über die RPC `send_message(p_conversation_id, p_body)`.** Grants `insert (conversation_id, body)` und `update (read_at)` auf `messages` entziehen und die Policies `messages_insert_participant` und `messages_mark_read` entfernen. Der `read_at`-Trigger bleibt als zweite Sicherung (`null → now()`, sonst `42501`, auch für den Server außer bei Löschjobs). Gründe:
- Ein Pfad für Web und iOS (I5).
- Eindeutige Fehlercodes: Eine Policy kann nur `42501` werfen.
- Kein Orakel durch BEFORE-Trigger. Diese laufen *vor* der RLS-Prüfung, d. h. eine Fehlermeldung aus einem Trigger zu einer fremden `conversation_id` (etwa „Unterhaltung nicht gefunden“ oder ein Rate-Limit aus fremden Zählern) unterschiede fremde von nicht vorhandenen IDs.
- Falls direktes INSERT doch bleibt: Kein BEFORE-Trigger darf einen Fehler werfen, bevor die Teilnahme feststeht, und pgTAP vergleicht fremde mit zufälligen IDs.

**A2 – Der Login-Rücksprung mit `?listing=` geht verloren.** `loginRedirect` im Proxy setzt `next = pathname` ohne Query, und `safeNextPath` gibt für geschützte Pfade nur `url.pathname` zurück. **Vorschlag:** Pfad statt Query: `/[locale]/account/messages/new/[listingId]`, in `STATIC_ROUTES` als `messages/new/:id` (dazu `messages`, `messages/:id`, `blocked`). E2E: abgemeldet „Nachricht schreiben“ → Login → landet in der Eingabe zur richtigen Anzeige. Der Detail-Link bleibt statisch und ohne Personalisierung.

**A3 – Status der Chat-Routen unter `cacheComponents`.** `notFound()` setzt nach dem Streaming-Start keinen Status mehr (siehe Proxy, QA M4 F1/M5 B2).
- **`new/[listingId]`:** Der Proxy nutzt die vorhandene `public_page_state`: `missing` → 404, `gone` → 410 (wie das Detail, SPEC 3.4 „nicht mehr verfügbar“, nie „entfernt“).
- **`messages/[id]`:** Fremd und nicht vorhanden ergeben dieselbe Antwort. Entweder prüft der Proxy mit der Sitzung eine schlanke RPC (`conversation_exists`, invoker), oder die Seite rendert „nicht gefunden“ mit `noindex` und `private, no-store`. Das bitte in ADR 017 entscheiden und in E2E prüfen (fremde, zufällige und ungültige ID, gleiche Antwort).

**A4 – Realtime-Vertrag (zu Frage 1).**
- Senden nur mit `realtime.send(payload, event, topic, private => true)` aus einem AFTER-Trigger (definer). **Nicht `realtime.broadcast_changes`**: Das überträgt `record`/`old_record`, also die ganze Zeile samt `body`, und speichert sie in `realtime.messages`.
- Nutzlast nur `conversation_id`, `message_id`, `sender_id`, `created_at` bzw. `read_up_to`.
- **Empfehlung: nur ein privater Kanal je Nutzer, `user:<uuid>`.** Ereignisse `message.new`, `message.read`, `unread.changed` gehen an beide Teilnehmer (der Absender bekommt sie für weitere eigene Tabs). Policy: `extension = 'broadcast' and realtime.topic() = 'user:' || auth.uid()::text`. Es gibt keine Teilnehmerprüfung je Join, kein UUID-Cast aus dem Topic, ein Abo je Tab, und Sperren oder Löschungen ändern nichts an der Berechtigung. Falls `conversation:<id>` bleibt: Topic per Regex prüfen, bevor nach `uuid` gecastet wird (ein Cast-Fehler darf kein Orakel sein), Teilnahme über `private.is_conversation_participant`.
- Nur eine SELECT-Policy, keine INSERT-Policy. Damit gibt es weder Client-Broadcast noch Presence.
- Cloud: In den Realtime-Einstellungen „nur private Kanäle“ (öffentlichen Zugriff aus) setzen und in die Cloud-Checkliste aufnehmen. Integrationstest: Ein nicht privates Abo auf dasselbe Topic und ein fremder Nutzer erhalten nichts, und der Join mit fremdem Topic scheitert.
- **Token:** Realtime prüft RLS beim Join und behält das Ergebnis für die Dauer des Kanals. Läuft das JWT ab, beendet der Server den Kanal, sofern der Client nicht per `setAuth` erneuert. Der Browser-Client aus `@supabase/ssr` tut das bei `TOKEN_REFRESHED`. Folge: Ein Entzug wirkt spätestens mit dem nächsten Token (`jwt_expiry` 3600 s). Wegen der inhaltsleeren Nutzlast ist das hinnehmbar und gehört so in ADR 017. Beim Abmelden `removeAllChannels()`.
- `realtime.messages` wird nach wenigen Tagen partitionsweise gelöscht, enthält aber nur IDs. In ADR 017 und später in der Datenschutzerklärung erwähnen.

**A5 – Lücke nach dem Wiederverbinden.** `conversation_messages` kennt nur `p_before`. Es fehlt ein Keyset nach vorn, z. B. `p_after_created_at`/`p_after_id`. Nachladen bei `SUBSCRIBED` (auch beim ersten Abo), nach dem Wiederverbinden und bei `visibilitychange`. Weil `created_at = now()` die Startzeit der Transaktion ist und Commits in anderer Reihenfolge eintreffen können, mit Überlappung (einige Sekunden) laden und nach `id` entdoppeln. Dasselbe gilt für Zähler und Liste (`unread_count` neu lesen statt hochzählen).

**A6 – Aufruf der Edge Function (zu Frage 2).** „Scheduled Functions“ sind bei Supabase genau `pg_cron` + `pg_net`, es gibt keine echte Alternative. Also `pg_cron` + `pg_net`, mit diesen Festlegungen:
- Der Cron-Job ruft nur an. Die Auswahl macht `claim_chat_notifications` (B2).
- `[functions.send-chat-notifications] verify_jwt = false`, dafür ein eigenes Secret im Header, in konstanter Zeit verglichen, nur `POST`. **Keinen `service_role`-Key in den Vault legen.** URL und Secret stehen je Umgebung im Vault. Lokal legt sie `seed.sql` an (Dummy-Wert, gleicher Branching-Vorbehalt wie ADR 013), in der Cloud die Checkliste. Die Migration enthält keine URL.
- Fehlt das Vault-Secret, macht der Job nichts. Sonst erzeugt er in der DB-CI ohne Edge Runtime jede Minute Fehlerlogs, und in E2E-Läufen kämen unvorhergesehene Mails.
- Lokal und in der CI erreicht die DB die Function über das Docker-Netz (Kong-Container, nicht `127.0.0.1`, `host.docker.internal` fehlt unter Linux), die Function erreicht Mailpit über dessen Container-Namen. Beides in ADR 017 notieren.
- `pg_net`-Timeout und Stapelgröße so wählen, dass ein Lauf sicher fertig wird (z. B. höchstens 50 Empfänger).
- Die E-Mail-Adresse liefert `claim_chat_notifications` aus `auth.users`, nur für `service_role`. Keine Kopie in `public`.

**A7 – SMTP aus Edge Functions.** Supabase Edge Functions erlauben keine ausgehenden Verbindungen auf Port 25 und 587. In der Cloud geht SMTP nur über 465 (implizites TLS) oder über die HTTP-API eines Anbieters.
- **Vorschlag:** Ein schmales `Mailer`-Interface mit SMTP-Adapter (Mailpit lokal und in der CI) und später einem HTTP-Adapter, Entscheidung in M10 (SPEC 7.11).
- Die SMTP-Bibliothek ist eine neue Abhängigkeit und braucht eine Begründung (CLAUDE.md), gepinnt im Lockfile.
- Nutzerinhalte (Anzeigename, Titel) nur escaped im Text, nie in Betreff, `From`/`Reply-To` oder anderen Headern (Header-Injection, Phishing-Absender).
- Beim Anbieter Öffnungs- und Klick-Tracking abschalten (Punkt der M10-Checkliste).

**A8 – Rate-Limits (zu Frage 6) und Fehlervertrag.**
- `RV002` ist nicht neu (ADR 013: Anzeigen, Fotos). Den Vertrag übernehmen: `hint = {"retry_after": "<ISO UTC>", "scope": "chat_conversations" | "chat_messages" | "chat_unanswered"}` und die Tabelle in ADR 013/017 ergänzen.
- Werte:
  - Neue Unterhaltungen 10 je 24 h, für neue Konten 3. „Neu“ wie bei Anzeigen nach `listing_new_account_days` (7 Tage) bzw. einer eigenen Einstellung `chat_new_account_days`, nicht 24 h.
  - Nachrichten 30 je 10 min, für neue Konten 15.
  - Ohne Antwort 5 statt 10. Gilt, solange das Gegenüber in der Unterhaltung noch nie geschrieben hat.
- Gezählt wird unter `pg_advisory_xact_lock` je Nutzer wie in `claim_listing_creation`, sonst umgehen parallele Requests das Limit.
- `seed.sql` hebt die Grenzen lokal für E2E an, pgTAP prüft die echten Werte.

**A9 – Textregeln für Nachrichten.** ADR 013 enthält keine Steuerzeichen-Regel, auf die 4.2 verweist.
- Festlegen in ADR 017: `trim_all` und Speichern des getrimmten Texts, CRLF/CR → LF, Steuerzeichen außer LF und TAB ablehnen (C0, DEL, C1), Bidi-Steuerzeichen U+202A–U+202E und U+2066–U+2069 ablehnen, Länge 1–2000 Codepoints nach dem Trimmen (`22023`, `hint` mit Feldcode).
- Check-Constraint `btrim` → `trim_all`.
- Zod gleichlautend. Gemeinsame Fixtures `supabase/tests/fixtures/chat_rules.json` für Web und iOS, auch für die Muster der Kontakthinweise. Sonst urteilen Web und I5 verschieden (Gleichverhalten beider Clients).

**A10 – Zustand des Gegenübers.** Ist das Gegenüber gesperrt (`is_blocked`) oder gelöscht (`deleted_at`), darf man ihm ebenfalls nicht schreiben. `can_write_in` prüft heute nur den Schreibenden. Die UI zeigt denselben neutralen Satz.
- `public_profiles` blendet solche Konten aus. `my_conversations` braucht deshalb einen Rückfall („Konto nicht mehr verfügbar“), statt die Unterhaltung zu verlieren.
- `unread_count` und die Liste zählen Nachrichten aus gesperrten Paaren und von inaktiven Konten nicht mit. Sonst bleibt der Zähler für immer stehen.

**A11 – Beweise bei Meldungen von Nachrichten.**
- `reports.target_id` überdauert die Löschung, die Nachricht nicht: `messages.sender_id` hat `on delete cascade`. Ein gemeldeter Betrüger löscht sein Konto, und die Moderation (M9) hat nichts mehr zu prüfen.
- **Vorschlag:** In ADR 017 entscheiden, dass beim Melden einer Nachricht ein Trigger (definer) eine Kopie (`body`, `sender_id`, `created_at`, `conversation_id`) in eine private Tabelle schreibt. Diese ist ohne API-Rechte, in M9 nur für Admins mit aal2 lesbar und hat die Frist `handled_reports_months` (ADR 008 ergänzen, Anwaltsfrage 7.3 vermerken). Umsetzung in M7, oder ausdrücklich nach M9 verschoben und im CHANGELOG vermerkt.
- `can_report('message')` nur für fremde Nachrichten (`sender_id <> auth.uid()`).
- Melden und Blockieren bleiben ohne Legal-Gate und funktionieren auch für gesperrte Konten (SPEC 3.1, App-Store/DSA).

**A12 – XSS und CSP.** Der Chat ist die erste angemeldete Fläche mit fremdem Freitext. Die Session-Cookies sind bewusst nicht `httpOnly` (`cookie-options.ts`), und außerhalb von `/admin` gilt `script-src 'unsafe-inline'`. Eine XSS-Lücke im Chat hieße also Kontoübernahme.
- Prüfen, ob `/account/**` (mindestens `messages`) dynamisch mit der Nonce-CSP wie `/admin` laufen kann. Sonst das Restrisiko in ADR 017 begründen.
- In jedem Fall: Text nur als React-Text (`whitespace-pre-wrap`), keine Autolinks, ESLint-Regel gegen `dangerouslySetInnerHTML` in `components/chat`, E2E mit XSS-Payloads in Text, Anzeigenname und Titel.

**A13 – Realtime nicht auf jeder Seite.** Ein Kanal in `AuthNav` öffnet für jeden angemeldeten Tab auf jeder Seite, auch auf öffentlichen, eine WebSocket-Verbindung. Das kostet Kontingent für gleichzeitige Verbindungen im Supabase-Plan.
- **Vorschlag:** Realtime nur unter `/account/messages*`. Anderswo rendert der Server den Zähler (`AuthNav` in Suspense, Fehler → ohne Zahl, nie die Seite brechen) und aktualisiert ihn bei `visibilitychange`/Fokus.
- Den Zähler nie in einer `use cache`-Funktion lesen (Session-Client).
- Falls doch überall Realtime: die Grenze für gleichzeitige Verbindungen in die M10-Checkliste.

**A14 – Doku und Schema-Vertrag.**
- SPEC v0.9 3.1: `messages.recipient_id`, `profiles.notify_chat_email`, `private.chat_notifications` (mit `attempts`), die Snapshot-Tabelle (A11), die RPC-Liste und den Fehlervertrag.
- ADR 008: Löschregeln der neuen FKs (`recipient_id` und `chat_notifications` → `on delete cascade`).
- RLS auch auf der privaten Tabelle (ohne Policy, ohne Grants), Meta-Allowlist für alle neuen `private`-Funktionen mit API-Rechten.
- Spaltengrant `update (notify_chat_email)` auf `profiles`.
- `database.types.ts` neu erzeugen (CI prüft das).
- Web-Server-Actions des Chats nutzen nur den Session-Client, nie `service_role`.

### 10.3 Hinweise (H)

- **H1 (Frage 4):** Neutraler Satz, kein Shadow-Block. Einverstanden. Auch die Seite „Kontakt beginnen“ verrät eine Sperre durch den Anbieter (die Anzeige ist ja öffentlich), das ist unvermeidbar. In ADR 017 festhalten.
- **H2 (Frage 5):** Schreiben auch bei pausierten, abgelaufenen, entfernten und gelöschten Anzeigen erlauben. Einverstanden. Das Gegenüber sieht nur „nicht mehr verfügbar“, der Besitzer seinen Status. Bei Betrug greift die Kontosperre (A10, B2).
- **H3 (Frage 3):** `recipient_id` als Spalte. Einverstanden, unveränderlich per Trigger, Backfill und `not null` in derselben Migration. Indizes:
  - `(recipient_id, created_at) where read_at is null` für Zähler und Benachrichtigung
  - `(conversation_id, created_at desc, id desc)`
  - Keyset `(owner_id|interested_id, last_message_at desc, id desc)`
  - Der alte `messages_unread_idx` kann entfallen.
- **H4:** Abmeldung per Klick (RFC 8058, `List-Unsubscribe-Post`) braucht ein signiertes Token, das nur `notify_chat_email = false` setzt. Mit M8 (Suchauftrags-Mails) gemeinsam bis M10 lösen, im Plan als offen vermerken. Mailtexte in 4 Sprachen in der Function, Begriffe laut Glossar, Rückfall `de`. Ein Test prüft die Vollständigkeit der Schlüssel.
- **H5 (I5):** `chat_notifications` mit Spalte `channel` (`email`/`push`) im Primärschlüssel, damit I5 die Claim-Logik für APNs wiederverwendet. Das Topic- und Ereignisformat steht in ADR 017 als Vertrag für iOS.
- **H6:** Ohne JavaScript gibt es keinen Kontakthinweis vor dem Senden. Den festen Hinweis zeigen und das in ADR 017 vermerken. Für ADR 016 zusätzlich Muster für Koordinaten und Kartenlinks, damit der Lagehinweis beim Teilen erscheint und nicht nur pauschal.
- **H7:** `blocks` nimmt beliebige `blocked_id`. Der FK-Fehler (`23503`) verrät, ob ein Konto existiert (UUIDs, geringer Wert). Besser `block_in_conversation(p_conversation_id)` und `my_blocks()` (definer, mit Rückfallnamen) für `/account/blocked`.
- **H8:** Lesebestätigungen sind personenbezogene Aktivitätsdaten. Eine spätere Option „Lesebestätigungen aus“ einplanen, nicht in M7. „Gelesen“ als Text bzw. `aria-label`, nicht nur als Farbe. Den Zähler im Menü per `aria-label` vorlesen („Nachrichten, 3 ungelesen“).
- **H9:** Nachrichtentext nie in URLs, Redirects oder Logs. Auch der Fehlerpfad ohne JavaScript behält den Entwurf im Formularzustand, nicht im Query. PRG nach erfolgreichem Senden gegen doppeltes Absenden beim Neuladen.
- **H10:** Tests deterministisch halten:
  - Benachrichtigung ohne Cron-Wartezeit testen (Nachrichten per Server zurückdatieren, Function direkt aufrufen), die Existenz des Cron-Jobs per pgTAP prüfen.
  - E2E erst senden, wenn das Abo aktiv ist (z. B. `data-realtime="subscribed"`).
  - Policies auf `realtime.messages` in pgTAP über `set_config('realtime.topic', …)` und JWT-Claims prüfen.
- **H11 (M9):** Der Datenexport umfasst Unterhaltungen, Nachrichten, `read_at`, Sperren und die Mail-Einstellung. Die Account-Löschung räumt `chat_notifications` und die Snapshots nach Frist ab. Die IDs in `realtime.messages` verfallen von selbst.
- **H12:** SPEC 8 nennt einfache Spam-Erkennung (doppelte Texte). Optional: gleicher Text in mehr als N neuen Unterhaltungen binnen 24 h → `RV002 scope=chat_duplicate`. Sonst als offen für M9/M10 vermerken.
- **H13 (Commit-Schnitt):**
  - CI-Änderung für Realtime spätestens mit Commit 4 (B3).
  - `send_message` und der Entzug der Grants gehören in Commit 2 (A1).
  - Die Pfadform `new/[listingId]` und `STATIC_ROUTES` in Commit 5 (A2).
  - Der Edge-Function-Job in `supabase.yml` in Commit 8.
  - Die iOS-Lücke ins CHANGELOG schon in Commit 1.

### 10.4 Antworten auf Abschnitt 9
1. **Broadcast:** Ja, aber nur mit `realtime.send` und inhaltsleerer Nutzlast, nicht `broadcast_changes` (A4). Empfohlen ist ein privater Kanal `user:<uuid>` mit SELECT-Policy auf `extension = 'broadcast'` und eigenem Topic, ohne INSERT-Policy, in der Cloud nur private Kanäle. Abgelaufenes Token: Der Server beendet den Kanal, `@supabase/ssr` erneuert per `setAuth`, und die Policy wird beim Join neu geprüft. Danach immer die Lücke über die RPC nachladen (A5).
2. **Benachrichtigung:** `pg_cron` + `pg_net`, das ist zugleich die „Scheduled Function“ von Supabase. At-most-once mit Claim vor dem Versand und Rücksetzen bei erkanntem Fehler, höchstens 3 Versuche (B2, A6). Exactly-once ist mit SMTP nicht erreichbar.
3. **`recipient_id`:** als Spalte, per Trigger gesetzt, unveränderlich, mit Teil-Index (H3).
4. **Sperr-Meldung:** neutraler Satz, kein Shadow-Block (H1).
5. **Entfernte Anzeigen:** Schreiben erlauben, solange beide Konten aktiv sind und keine Sperre besteht (H2, A10).
6. **Rate-Limits:** 10 neue Unterhaltungen je 24 h (neue Konten 3), 30 Nachrichten je 10 min (neue Konten 15), 5 ohne Antwort. „Neu“ wie bei Anzeigen nach Tagen statt 24 h, mit Sperre je Nutzer und dem `RV002`-Vertrag aus ADR 013 (A8).

### 10.5 Freigabe
- **Freigabe:** ja, mit Auflagen. Vor Commit 2 B1, A1, A8 und A9 im Plan und in ADR 017 einarbeiten. Vor Commit 4 B3 und A4. Vor Commit 8 B2, A6 und A7.
- **Risiken:** Endlos-Mails (B2), stilles Überspringen der Prüfungen in Definer-Pfaden (B1), nicht testbares Realtime in der CI (B3), Kontoübernahme per XSS wegen schwacher CSP und lesbarer Session (A12), verlorene Beweise nach Kontolöschung (A11), SMTP-Ports in der Cloud (A7).

## 11. Eingearbeitet (Freigabe durch den Nutzer 2026-11-05)
- Freigabe des Plans mit allen Auflagen. Die Sicherung gemeldeter Nachrichten (A11) kommt schon in M7.
- Verbindlich ist ADR 017. Wo Abschnitte 4–8 abweichen, gilt das Review bzw. ADR 017:
  - B1/A1: Schreiben nur per Definer-RPCs (`start_conversation`, `send_message`, `mark_conversation_read`) mit fester Prüfreihenfolge. Direkte Grants entfallen, Trigger nutzen `is_server_caller()`.
  - B2: Mail nur zu Nachrichten seit der letzten Mail, je Empfänger höchstens alle 15 min, Claim/Release at-most-once, höchstens 3 Versuche.
  - B3: Realtime in beiden CI-Workflows (spätestens Commit 4), Probe für `start`/`db reset`.
  - A2: `/account/messages/new/[listingId]`. A3: Status über den Proxy bzw. gleiche „nicht gefunden“-Seite.
  - A4/A5/A13: privater Kanal `user:<uuid>`, `realtime.send` ohne Inhalt, Nachladen nach vorn mit Überlappung, Realtime nur unter `/account/messages*`.
  - A6/A7: `pg_cron` + `pg_net`, eigenes Secret im Vault, `Mailer`-Interface (SMTP lokal, HTTP-API ab M10).
  - A8: Werte 10/3, 30/15, 5; „neu“ = 7 Tage; Vertrag `RV002` mit `scope`.
  - A9: Textregeln mit gemeinsamer Fixture `chat_rules.json`.
  - A10: Gesperrte oder gelöschte Gegenüber, Rückfallname, Zähler ohne solche Nachrichten.
  - A11: `private.reported_message_snapshots`.
  - A12: Nonce-CSP für die Chat-Routen, keine Autolinks, ESLint-Regel, XSS-E2E.
  - A14: SPEC v0.9, ADR 008, Meta-Allowlist, Typen.
- Hinweise: H1–H3 bestätigt. H4 (Abmelden per Klick) in M8–M10. H5 `channel` in `chat_notifications`. H6 Muster für Koordinaten und Kartenlinks. H7 `block_in_conversation`/`my_blocks`. H8 „gelesen“ als Text, Zähler mit `aria-label`. H9 kein Text in URLs, PRG. H10 deterministische Tests. H11 für M9. H12 offen für M9/M10. H13 Commit-Schnitt wie vorgeschlagen.
