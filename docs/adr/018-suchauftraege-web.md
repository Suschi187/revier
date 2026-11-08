# ADR 018: Suchaufträge und Benachrichtigungen im Web

Status: angenommen und umgesetzt (M8, Plan `docs/plans/M8-plan.md` mit Architekt-Review, Freigabe durch den Nutzer 2026-11-06; Umsetzung und QA mit Nachprüfung 2026-11-06/07, Abnahme durch den Nutzer 2026-11-08, CHANGELOG M8)

## Kontext
SPEC 6 M8: Filter speichern, serverseitiger Abgleich bei neuer Freigabe, E-Mail-Benachrichtigung.
- Akzeptanz: Eine neue passende Anzeige löst genau eine E-Mail aus.

Nutzer-Entscheidungen vom 2026-11-06:
- Takt je Suchauftrag wählbar („sofort“ oder „täglich“).
- Abbestellen per Klick (RFC 8058) für Suchauftrags- und Chat-Mails.
- Moderations-Mails an Besitzer.
- Ein Suchauftrag läuft 6 Wochen; pausieren, fortsetzen, verlängern und löschen gehen jederzeit, unabhängig davon, ob er Angebote oder Gesuche sucht.
- Ein mitgespeicherter Kartenausschnitt zählt mit (H1).
- Bei „sofort“ geht die Mail 2 Minuten nach der Freigabe (H7).
- Pausieren hält die Laufzeit nicht an (H4).

`saved_searches` besteht seit M1. Das Filterformat v1 ist in ADR 015 festgelegt, `private.search_conditions` (M6) ist die gemeinsame Quelle für Suche und Karte.

## Entscheidung

### Suchauftrag
- **Neue Spalten:**
  - `cadence` (`instant` | `daily`)
  - `paused_at`
  - `expires_at`: der Server setzt `now() + saved_search_days`, also 42 Tage.
- **Filter:**
  - Nach dem Anlegen fest.
  - Ein Trigger prüft sie mit `search_filters_error` und einem Probelauf von `search_conditions`. Der Probelauf fängt einen Suchbegriff mit mehr als 32 Knoten ab.
  - `sort` wird entfernt.
  - Kein CHECK, weil die Prüfung Referenzdaten liest (Restore-Reihenfolge).
- **Grants:**
  - insert auf `name, filters, cadence, notify_email`
  - update auf `name, cadence, notify_email`
  - Server-Spalten schützt ein Trigger über `private.is_server_caller()`.
- **RPCs** (Definer): `pause_saved_search`, `resume_saved_search`, `extend_saved_search`.
  - Verlängern geht im Fenster der letzten 14 Tage oder nach dem Ablauf und setzt `now() + 42 Tage`. Außerhalb des Fensters gibt es `RV006` mit `hint {"extend_from": "<ISO, UTC>"}`.
  - Fremde und nicht vorhandene IDs liefern denselben Fehler.
  - Anlegen, Fortsetzen und Verlängern verlangen ein aktives Konto und die aktuelle Zustimmung (`RV001`).
  - Pausieren, E-Mail aus, Löschen und Abbestellen gehen immer.
- **E-Mail wieder einschalten** verlangt wie das Fortsetzen ein aktives Konto und `RV001`. Abschalten, Umbenennen, Takt und Löschen gehen immer.
- Die RPCs setzen das transaktionslokale Flag `revier.saved_search_rpc` für den Schutz-Trigger (Muster `revier.moderation`) und geben die ganze Zeile zurück.
- **Limit:** höchstens 25 je Konto, abgelaufene zählen mit. Gesichert mit einem Advisory-Lock je Nutzer.

### Abgleich
- **Auslöser:** Der AFTER-Trigger auf `listings` feuert nur, wenn `published_at` von null auf einen Wert wechselt, also bei der ersten Freigabe. Er schreibt die Anzeige in `private.search_match_queue`.
  - Erneute Prüfung, Pausieren und Fortsetzen lösen nichts aus.
  - Ist die Anzeige beim Abgleich nicht öffentlich, bleibt sie bis zu 24 Stunden in der Warteschlange und wird danach verworfen.
- **Auswertung:** über `private.search_conditions` plus `l.id = any(batch)`.
  - Eine Ausführung je Auftrag über alle Anzeigen eines Laufs.
  - Davor ein Vorfilter in plain SQL (`kind`, `direction`, `country`).
  - Jeder Auftrag hat einen eigenen Ausnahmeblock: ein fehlerhafter wird gezählt und übersprungen.
- **Ein Auftrag kommt in Frage, wenn alles davon gilt:**
  - nicht pausiert, nicht abgelaufen, `notify_email` an;
  - das Konto ist aktiv;
  - der Auftrag wurde vor `published_at` angelegt;
  - die Anzeige ist fremd;
  - keine Sperre in eine der beiden Richtungen.
- **Pause:** Was in einer Pause freigegeben wird, bleibt ohne Mail.

### Genau eine Mail
- **Entdoppelt wird je (Empfänger, Anzeige).** Passt eine Anzeige zu mehreren Aufträgen, geht sie mit dem frühesten Takt („sofort“ vor „täglich“). Die übrigen Treffer werden ohne Mail erledigt.
- **Fällig:**
  - `instant`: 2 Minuten nach `published_at`, und die letzte Mail ist mindestens 10 Minuten her.
  - `daily`: ab `saved_search_daily_hour` (07:00 Europe/Berlin), höchstens einmal je Kalendertag.
  - Je Empfänger eine Mail mit allen fälligen Treffern.
- **Buchführung (höchstens einmal):**
  - Der Zustand je Empfänger wird beim Claim gesetzt (`for update skip locked`).
  - Der Claim liefert eine `claim_id`. Confirm und Release arbeiten nur mit ihr, weil sich Läufe überlappen.
  - Ein geclaimter Treffer wird nur nach einem Release erneut geclaimt, höchstens 3 Versuche.
  - Ein Absturz nach dem Claim verliert die Mail. Die Akzeptanz lautet technisch: höchstens eine, im Normalfall genau eine.
- **Prüfung beim Claim:** Alle Bedingungen von oben werden erneut geprüft, dazu `listing_is_public`. Ungültig gewordene Treffer werden ohne Mail erledigt.
- **Inhalt:**
  - Erlaubte Felder: `id`, `title`, `kind`, `direction`, Kreis und Bundesland, `price_minor`, `currency`, `price_unit`.
  - Nicht `listing_card`, nie `map_point`, nie Koordinaten, Kontaktdaten oder Anbietername.
  - Im Verlängerungsfenster ein Hinweis auf den Ablauf.
  - URL-Wörter und das Preisformat werden mit gemeinsamen Fixtures gegen das Web geprüft.

### Moderations-Mails
- Ein Definer-Trigger auf `listings.status` (wie `listings_audit`) schreibt `private.moderation_notifications` bei Freigabe, Änderungswunsch, Ablehnung und Entfernung.
- **Inhalt:**
  - Titel, Entscheidung, Grund (`reject_code` als Label, `reject_reason` escaped).
  - Nie die Identität des Admins.
  - Ein Hinweis auf den Kontaktweg, als Platzhalter markiert, bis SPEC 7.2 und M9 (Beschwerdeweg) geklärt sind.
- Es sind Dienstmails ohne Abbestellen. Sie gehen auch an gesperrte Besitzer, aber nicht an gelöschte.

### Abbestellen per Klick (RFC 8058)
- **Token:** 32 zufällige Bytes, als Hex in der Mail. Gespeichert wird nur der SHA-256, in `private.unsubscribe_tokens (scope, target_ids)`.
  - Der Scope `saved_search_mail` gilt für die Aufträge dieser Mail, der Scope `chat` für die Chat-Mails.
  - Aufbewahrung 90 Tage.
- **Header:**
  - `List-Unsubscribe: <{SITE_URL}/api/unsubscribe?t=…>`
  - `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
- **`POST /api/unsubscribe`:**
  - Token aus der Query oder dem Formular.
  - Ohne Cookies und ohne CSRF-Prüfung.
  - Antwortet immer 200 mit gleichem Body, `no-store`, ohne Redirect.
  - `unsubscribe(p_token)` macht für gültige und ungültige Token dieselbe Arbeit. Bereits abbestellt ist kein Fehler.
- **GET:** ändert nichts.
  - Der Link im Mailtext führt auf die Bestätigungsseite `/{lang}/unsubscribe?t=…`.
  - Die Seite hat `noindex`, `no-referrer` und `no-store`, kein DB-Aufruf beim GET.
- **Logs:** Der Token steht nie in eigenen Logs. Die Access-Logs des Hosters klärt M10.
- **Wirkung:** Abbestellen setzt `notify_email = false` für die Aufträge der Mail bzw. `notify_chat_email = false`.

### Versand
- **Edge Function** `send-search-notifications`, getrennte Schritte für Suchauftrags- und Moderations-Mails, Logs nur als Zähler.
- **Mailer:** wandert nach `functions/_shared/mail/`.
- **Absicherung** wie ADR 017:
  - eigener Vault-Eintrag (`search_notifications_secret`, `search_notifications_url`)
  - Header `x-search-notify-secret`
  - `verify_jwt = false`, nur POST
  - Ohne URL macht der Cron-Job nichts.

### Aufbewahrung (ADR 008)

| Daten | Frist |
|---|---|
| Warteschlange | nach der Verarbeitung, unverarbeitbar nach 24 h |
| Treffer und Entdopplung | 30 Tage nach Versand oder Erledigung |
| Moderations-Mails | 30 Tage (die Entscheidung bleibt im Audit) |
| Abbestell-Token | 90 Tage |
| abgelaufene Aufträge | 30 Tage nach `expires_at` |

### Fehlercodes (für Web und iOS)

| Code | Wann | Hinweis |
|---|---|---|
| `42501` | nicht angemeldet, Konto nicht aktiv, fremder oder unbekannter Suchauftrag (pause/resume/extend), direktes Setzen von Server-Spalten oder Ändern von `filters`, falsches Secret der Function | gleich für fremd und nicht vorhanden |
| `RV001` | Anlegen, Fortsetzen, Verlängern oder E-Mail wieder an ohne aktuelle Zustimmung | wie ADR 013 |
| `22023` | ungültiger Filter beim Anlegen | `hint` = erster fehlerhafter Schlüssel wie die Suche, `q` auch bei mehr als 32 Knoten |
| `23514` | mit `hint {"reason":"saved_searches_limit"}`: mehr als 25 Suchaufträge (abgelaufene zählen mit); ohne `hint`: Name leer oder länger als 100 Zeichen, Filter größer als 4 KB | nur mit diesem `hint` „Limit erreicht“ anzeigen |
| `RV006` | Verlängern vor dem Fenster | `hint {"extend_from":"<ISO, UTC>"}` |

`unsubscribe` liefert nie einen Fehler (immer `void`).

## Folgen
- iOS (I6) nutzt dieselben RPCs, denselben Takt und dieselbe Entdopplung für Push. `notify_push` bleibt bis dahin ungenutzt.
- In der Cloud (M10) muss DKIM die beiden List-Unsubscribe-Header signieren. Ein Mail-Anbieter mit HTTP-API ist nötig.
- Die Datenschutzerklärung (Platzhalter, M9) nennt Suchaufträge, Benachrichtigungen und Abbestell-Token.
- Der Datenexport (M9) nennt Suchaufträge samt Treffern (Review A9).
