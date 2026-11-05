# ADR 017: Chat im Web

Status: angenommen (M7, Plan `docs/plans/M7-plan.md` mit Architekt-Review, Freigabe durch den Nutzer 2026-11-05)

## Kontext
SPEC 6 M7: Unterhaltung pro Anzeige, Realtime, Ungelesen-Zähler, E-Mail-Benachrichtigung mit Drosselung, Blockieren und Melden im Chat.

Akzeptanz:
- a) Zwei Browser-Sitzungen tauschen Nachrichten in Echtzeit.
- b) Ein blockierter Nutzer kann nicht mehr schreiben.

Nutzer-Entscheidungen vom 2026-11-05:
- Kontaktdaten sind erlaubt, mit Sicherheitshinweis (SPEC 7.8).
- Der Mailversand ist konfigurierbar, lokal über Mailpit. Der Anbieter folgt in M10 (SPEC 7.11).
- Drosselung: 2 Minuten ungelesen, höchstens eine Mail je 15 Minuten.
- Gemeldete Nachrichten werden schon in M7 gesichert.

Tabellen `blocks`, `conversations` und `messages` bestehen seit M1 (Review M1: `is_blocked_with` statt `is_blocked_pair`, Chats überdauern die Anzeige).

## Entscheidung

### Schreibwege nur über RPCs (Review B1, A1)
- `start_conversation(p_listing_id, p_body)`, `send_message(p_conversation_id, p_body)` und `mark_conversation_read(p_conversation_id)`.
  - Alle drei sind `security definer` mit `set search_path = ''`.
  - Sie prüfen ausdrücklich in fester Reihenfolge: angemeldet → aktives Konto → Zustimmung (`RV001`) → Text (`22023 body`) → Rate-Limit (`RV002`) → Teilnahme, Sichtbarkeit, Sperre, Zustand des Gegenübers.
  - Die Fehler der letzten Stufe sind einheitlich `42501`, ohne Unterschied zwischen fremd und nicht vorhanden.
- Direkte INSERT-Grants auf `conversations` und `messages` sowie der UPDATE-Grant auf `messages.read_at` entfallen, ebenso die Policies dazu. SELECT bleibt für Teilnehmer.
- Eine Unterhaltung entsteht nur mit erster Nachricht. Gibt es sie schon, hängt `start_conversation` nur die Nachricht an und gibt die bestehende ID zurück.
- **Neue Unterhaltung:** verlangt `private.listing_is_public` (ADR 015) und eine fremde Anzeige.
- **Bestehende Unterhaltung:** Schreiben bleibt erlaubt, auch wenn die Anzeige pausiert, abgelaufen, entfernt oder gelöscht ist (Absprachen, Beweise). Es endet nur in diesen Fällen:
  - Sperre in einer der beiden Richtungen
  - Schreibender oder Gegenüber gesperrt (`is_blocked`) oder gelöscht (`deleted_at`) (Review A10)
- Trigger auf `messages` erkennen den Server nur über `private.is_server_caller()` (Rolle), nie über `is_server()`. Sonst übersprängen Definer-Pfade die Prüfungen still.
- **`recipient_id`:**
  - Neue Spalte, per Trigger aus der Unterhaltung gesetzt, nie aus dem Request.
  - Unveränderlich und `not null`.
  - Teil-Index `(recipient_id, created_at) where read_at is null`.
- **`read_at`:** Ein Trigger lässt nur `null → now()` zu. Danach ist der Wert unveränderlich, auch für den Server; Ausnahme ist die Löschung mit dem Konto.

### Textregeln (Review A9)
- Gespeichert wird der getrimmte Text (`private.trim_all`). CRLF und CR werden zu LF.
- Abgelehnt werden:
  - Steuerzeichen außer LF und TAB (C0, DEL, C1)
  - Bidi-Steuerzeichen U+202A–U+202E und U+2066–U+2069
- Länge 1–2000 Codepoints nach dem Trimmen.
- Fehler `22023`, `hint = body`.
- Zod im Web prüft gleichlautend. Gemeinsame Fälle stehen in `supabase/tests/fixtures/chat_rules.json` (auch für I5), ebenso die Muster der Kontakthinweise.
- Darstellung nur als Text (React, `whitespace-pre-wrap`), keine Autolinks.

### Rate-Limits (Review A8)
- Vertrag wie ADR 013: `RV002` mit `hint = {"retry_after": "<ISO UTC>", "scope": "chat_conversations" | "chat_messages" | "chat_unanswered"}`.
- Werte in `app_settings`:

  | Grenze | Konto | Konto „neu“ |
  |---|---|---|
  | Neue Unterhaltungen je 24 h | 10 | 3 |
  | Nachrichten je 10 min | 30 | 15 |
  | Nachrichten, solange das Gegenüber nie geantwortet hat | 5 | 5 |

  „Neu“ heißt jünger als `chat_new_account_days` (7).
- Gezählt wird unter `pg_advisory_xact_lock` je Nutzer.
- `seed.sql` hebt die Grenzen lokal an, pgTAP prüft die echten Werte. Den Vorbehalt zu Supabase Branching aus ADR 013 gibt es hier ebenso.

### Realtime (Review A4, A5, A13, B3)
- **Kanal:** ein privater Broadcast-Kanal je Nutzer, `user:<uuid>`.
- **Senden:** Ein AFTER-Trigger (definer) sendet per `realtime.send(…, private => true)` an beide Teilnehmer, mit den Ereignissen:
  - `message.new`: `conversation_id`, `message_id`, `sender_id`, `created_at`
  - `message.read`: `conversation_id`, `read_up_to`
  - `unread.changed`
- **Kein Inhalt** im Kanal. Nicht `realtime.broadcast_changes`, das die ganze Zeile samt Text überträgt und speichert.
- **Policy auf `realtime.messages`:** nur SELECT mit `extension = 'broadcast' and realtime.topic() = 'user:' || auth.uid()`. Keine INSERT-Policy, also weder Client-Broadcast noch Presence.
- **Cloud:** Realtime nur mit privaten Kanälen (Cloud-Checkliste).
- **Token:** RLS gilt beim Join. Läuft das JWT ab, endet der Kanal, sofern der Client nicht erneuert (`@supabase/ssr`, `setAuth` bei `TOKEN_REFRESHED`). Ein Entzug wirkt spätestens mit dem nächsten Token. Das ist hinnehmbar, weil die Nutzlast keine Inhalte trägt. Beim Abmelden `removeAllChannels()`.
- **Lücke:** Nach `SUBSCRIBED`, nach dem Wiederverbinden und bei `visibilitychange` lädt der Client über `conversation_messages(…, p_after_*)` nach.
  - Er lädt mit einigen Sekunden Überlappung und entdoppelt nach `id`, weil `created_at` die Startzeit der Transaktion ist.
  - Zähler und Liste liest er neu, statt hochzuzählen.
- **Nur unter `/account/messages*`:** Anderswo rendert der Server den Zähler in der Navigation und liest ihn bei Fokus neu. So gibt es keine WebSocket je Tab auf jeder Seite.
- **`realtime.messages` speichert nur IDs** und wird vom Dienst nach wenigen Tagen gelöscht (Datenschutzerklärung M9).
- **Realtime in der CI:** Beide Workflows starten Realtime. Eine Probe belegt, dass `start` und `db reset` die Policies frisch anlegen. Falls die Reihenfolge nicht hält, wird die Migration idempotent mit Existenzprüfung.

### Benachrichtigung per E-Mail (Review B2, A6, A7)
- **Tabelle:** `private.chat_notifications (conversation_id, recipient_id, channel, last_sent_at, attempts)`. `channel` (`email`, später `push` für I5) steht im Primärschlüssel. RLS ohne Policy und ohne Grants.
- **Fällig** ist eine Mail, wenn es eine ungelesene Nachricht gibt, die seit der letzten Mail zu dieser Unterhaltung neu ist (`created_at > last_sent_at`) und älter als 2 Minuten (`chat_email_delay_minutes`). Zusätzlich gilt je Empfänger höchstens eine Mail je `chat_email_min_interval_minutes` (15), mit allen fälligen Unterhaltungen gesammelt. Liest der Empfänger nie, kommt keine zweite Mail zu denselben Nachrichten.
- **Ausgenommen:**
  - abgemeldete Empfänger (`profiles.notify_chat_email = false`)
  - gesperrte oder gelöschte Empfänger und Absender
  - blockierte Paare
- **Ablauf at-most-once:**
  - `private.claim_chat_notifications(p_limit)` (definer, nur `service_role`) sperrt mit `for update skip locked`, setzt `last_sent_at` und `attempts` und liefert Empfänger, Adresse aus `auth.users`, Sprache und Unterhaltungen.
  - Nach einem erkannten Versandfehler setzt `release_chat_notifications` den alten Stand zurück, höchstens 3 Versuche.
  - Ein Absturz verliert die Mail. Das ist gewollt: lieber eine verlorene als eine doppelte Mail.
- **Auslöser:** `pg_cron` jede Minute, per `pg_net` an die Edge Function `send-chat-notifications`.
  - `verify_jwt = false`, dafür ein eigenes Secret im Header, in konstanter Zeit verglichen, nur `POST`.
  - Der Job liest URL und Secret aus dem Vault (lokal aus `seed.sql`, in der Cloud aus der Checkliste). Fehlt das Secret, macht der Job nichts.
  - Kein `service_role`-Key im Vault, keine URL in Migrationen. Lokal laufen die Aufrufe über das Docker-Netz.
- **Inhalt:**
  - in der bevorzugten Sprache des Empfängers, Rückfall `de`
  - Anzeigename des Absenders und Titel der Anzeige (nur wenn öffentlich oder der Empfänger Besitzer ist)
  - Link zur Unterhaltung und zu den Einstellungen
  - **kein Nachrichtentext**, ohne Tracking
  - Nutzerinhalte nur escaped im Text, nie in Betreff oder Headern
- **Versand:** ein schmales `Mailer`-Interface.
  - SMTP-Adapter für Mailpit lokal und in der CI.
  - Ein HTTP-Adapter eines EU-Anbieters folgt in M10, weil Supabase Edge Functions in der Cloud nicht auf Port 25 und 587 verbinden.
- **Logs:** nur Zahlen, keine Adressen und keine Inhalte.
- **Abmelden:** in den Profileinstellungen. Abmelden per Klick aus der Mail (RFC 8058) kommt mit M8 bis M10.

### Blockieren und Melden (Review A11, H1, H7)
- Blockieren und Entsperren erfolgen aus der Unterhaltung (`block_in_conversation`). `my_blocks()` liefert die Liste unter `/account/blocked`, mit Rückfallnamen, damit nichts über fremde Konten verrät, ob es sie gibt.
- **Sperrmeldung:**
  - Wer blockiert hat, sieht „Du hast diese Person blockiert“ mit der Möglichkeit, die Sperre aufzuheben.
  - Das Gegenüber sieht einen neutralen Satz, kein Shadow-Block.
  - Dass eine Sperre besteht, wird dabei erkennbar. Das ist unvermeidbar, auch auf „Kontakt beginnen“.
- **Melden einer Nachricht:**
  - Gemeldet werden kann nur eine fremde Nachricht in der eigenen Unterhaltung.
  - Ein Trigger (definer) sichert eine Kopie (`body`, `sender_id`, `created_at`, `conversation_id`) in `private.reported_message_snapshots`. Die Tabelle hat keine API-Rechte und ist in M9 nur für Admins mit aal2 lesbar.
  - Frist wie bearbeitete Meldungen (`handled_reports_months`, ADR 008). So bleiben Beweise, auch wenn der Absender sein Konto löscht.
- Melden und Blockieren bleiben ohne Legal-Gate und funktionieren auch für gesperrte Konten (App Store, DSA).
- Admins lesen Chats nicht pauschal.

### Web (Review A2, A3, A12)
- **Routen** (in `STATIC_ROUTES`):
  - `/account/messages`
  - `/account/messages/:id`
  - `/account/messages/new/:id` (Anzeigen-ID im Pfad, damit der Login-Rücksprung sie behält)
  - `/account/blocked`
- **Status:**
  - `new/:id` nutzt im Proxy `public_page_state` (404 bzw. 410 wie das Detail).
  - Fremde, nicht vorhandene und ungültige Unterhaltungs-IDs ergeben dieselbe Seite „nicht gefunden“ mit `noindex` und `private, no-store`.
- **Detail:** „Nachricht schreiben“ ist ein statischer Link. Die gecachte öffentliche Seite bleibt unpersonalisiert.
- **Ohne JavaScript:** Senden per Formular, PRG, der Entwurf bleibt im Formular und nie in einer URL. Kein Kontakthinweis vor dem Senden, dafür der feste Hinweis.
- **CSP:** Die Chat-Routen (`/account/messages*`, `/account/blocked`) bekommen die Nonce-CSP wie `/admin`. Sie rendern ohnehin dynamisch, und dort gibt es keine Karte.
  - Begründung: Session-Cookies sind nicht `httpOnly` (ADR 010), und der Chat ist die erste angemeldete Fläche mit fremdem Freitext.
  - Zusätzlich verbietet eine ESLint-Regel `dangerouslySetInnerHTML` in `components/chat`, und E2E prüft mit XSS-Texten.
- **Hinweise:**
  - Fest: Sicherheitshinweis gegen Vorauszahlungsbetrug.
  - Vor dem Senden bei Telefonnummer, E-Mail, IBAN, Koordinaten oder Kartenlinks. Der Hinweis zur Lage für Besitzer verweist auf ADR 016 „Lage im Chat geteilt“.

## Folgen
- iOS (I5) nutzt dieselben RPCs, Fixtures, Kanäle und Ereignisse. Push nutzt `chat_notifications` mit `channel = 'push'`.
- M9: Meldungs-Warteschlange mit den gesicherten Kopien, Datenexport (Unterhaltungen, Nachrichten, `read_at`, Sperren, Mail-Einstellung), Account-Löschung räumt Benachrichtigungen und Kopien nach Frist.
- M10: Mail-Anbieter (EU, AVV, Tracking aus), Realtime nur privat, Grenze gleichzeitiger Verbindungen, Abmelden per Klick.
- Offen:
  - Lesebestätigungen abschaltbar (später).
  - Spam-Erkennung über gleiche Texte (M9/M10).
  - SPEC 7.3 „Nachrichten beim Gegenüber“ nach Kontolöschung (Anwalt).
