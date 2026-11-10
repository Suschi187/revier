# SPEC – Revier (Arbeitstitel), MVP v0.11

v0.11: M9 geteilt in M9a „Konto und Datenschutz“ und M9b „Vertrauen und Moderation“ mit je eigener Akzeptanz (6). Account-Löschung mit frischer Anmeldung und festem Ablauf, Datenexport als JSON (ADR 019); Cookie-Einstellungen ohne Banner, solange nur Notwendiges läuft (ADR 021); Verifizierung freiwillig (7.5 entschieden), Meldungen mit Ergebnis, Sperre, Beschwerden (ADR 020). Neue Tabellen und Spalten (3.1), Admin-Bereich (5), Retention (7.3), Anwaltsfragen (7.2).

v0.10: M8 Suchaufträge (ADR 018): Laufzeit 6 Wochen, Takt sofort/täglich, Pausieren/Verlängern, Abgleich bei erster Freigabe, genau eine Mail je Empfänger und Anzeige, Abbestellen per Klick (RFC 8058), Moderations-Mails (3.1).
v0.9: M7 Chat (ADR 017): Kontaktdaten im Chat erlaubt mit Hinweis (7.8 entschieden), Schreibwege nur per RPC, `messages.recipient_id`, `profiles.notify_chat_email`, Benachrichtigung mit Drosselung, Sicherung gemeldeter Nachrichten (3.1, 3.4).
v0.8: M6 Karte (ADR 016): Kacheln selbst gehostet (7.10 entschieden), `map_point` und `regions.area_km2` (3.1), keine Punktwahl in Kreisen unter 400 km² (3.3), Karte in M9 (Consent, Datenschutz), ODbL der Basiskarte in 7.2.
v0.7: M5 Öffentliche Seiten (ADR 015): `published_at`/`approved_at` (3.1), Sichtbarkeit über eine Definition und Zustand „nicht mehr verfügbar“ (3.4), Anbieterprofil ohne „dabei seit“ (4.3), Suche als RPC mit Filterformat v1, Rechtsfragen 7.2.
v0.6: M4 Moderation (ADR 014): `reject_code` plus optionaler Freitext, `submitted_at`, Entscheidungen nur per RPC `moderate_listing` (Freigeben, Bearbeitung anfordern, Ablehnen), Admins per UI mit Step-up, Karenz und Limits (3.1, 3.4, 5).
v0.5: Stand nach M3 (Plan M3 8, QA M3 F8): Fotospalten und Verarbeitung (3.1, ADR 011), `listing_places` und `postal_prefix` (3.1, 3.3, ADR 012), Attribute und Pflichtangaben je Art (3.2, ADR 013), Wildart `other_predators`.
v0.4: Anmeldung passwortlos per Link und Code, AGB-Zustimmung je Version in `legal_acceptances` (3.1, 4.4, ADR 010); Cloud-Projekt erst nach 7.1/7.9/7.11.
v0.3: Startregion (7.4) und Retention-Default (7.3) entschieden, Pausieren/Fortsetzen durch Besitzer (3.4), Schema-Ergänzungen für M1 (3.1).
v0.2: Web-App als gleichwertige Plattform ergänzt, Android ausdrücklich ausgeschlossen. Offene Punkte stehen in Abschnitt 7. Änderungen an der Spezifikation werden hier versioniert, nicht nur im Chat.

## 1. Produkt in einem Satz
Marktplatz für Jagdgelegenheiten in DACH, Tschechien und Polen als **Web-App und iOS-App** mit verifizierten Anbietern, Suchaufträgen und Chat. Beide Clients greifen auf dasselbe Backend und dieselben Konten zu.

## 2. Umfang MVP
**Plattformen:** Web-App (Desktop und mobiler Browser) und iOS-App. Kein Android.

**Enthalten**
- Registrierung/Login (Sign in with Apple, E-Mail; im Web zusätzlich Magic Link)
- Öffentliche, suchmaschinenfähige Anzeigenseiten im Web (Landingpage, Kategorie- und Regionsseiten, Anzeigen-Detail)
- Anzeigen erstellen, bearbeiten, pausieren, löschen (Angebot oder Gesuch)
- Moderationsfreigabe jeder neuen Anzeige durch das Team
- Suche mit Filtern, Listen- und Kartenansicht
- Favoriten, Suchaufträge mit Benachrichtigung (iOS: Push, Web: E-Mail)
- Chat 1:1 pro Anzeige (in Web und iOS, synchron über dasselbe Konto)
- Melden, Blockieren, Account löschen (in Web und iOS)
- Verifizierung (Jagdschein-Upload, manuelle Prüfung)
- Sprachen de/en/cs/pl, Preise in EUR/CHF/CZK/PLN
- Admin-Bereich (Web, unter `/admin`) für Moderation und Verifizierung
- Cookie-Consent, Impressum, Datenschutz, Nutzungsbedingungen im Web

**Nicht enthalten (später)**
- Bezahlte Features (Boosts, Abos, In-App-Käufe, Web-Zahlungen)
- Automatische Übersetzung von Anzeigentexten
- Bewertungen (Tabelle wird angelegt, UI erst in Phase 2)
- **Android** (nicht geplant), iPad-optimiertes Layout, native macOS-App
- Vertragsabschluss oder Zahlungsabwicklung in der App oder im Web

## 3. Datenmodell (Postgres / Supabase)

Alle Tabellen: `id uuid pk default gen_random_uuid()`, `created_at timestamptz default now()`. RLS überall aktiv.

### 3.1 Tabellen

**profiles** (1:1 zu `auth.users`)
- `user_id` (fk auth.users, unique)
- `display_name` text
- `account_type` enum: `private | business`
- `business_name` text null
- `country` enum: `DE | AT | CH | CZ | PL`
- `preferred_language` enum: `de | en | cs | pl`
- `verification_status` enum: `none | pending | verified | rejected`
- `is_blocked` bool default false
- `deleted_at` timestamptz null

**verifications**
- `user_id`, `document_path` (privater Storage-Bucket), `document_type` (`jagdschein | jagdkarte | revierbescheinigung | gewerbe`), `status`, `reviewed_by`, `reviewed_at`, `reject_reason`
- Zusätzlich `decided_at`, `document_deleted_at`; `document_path` ist nullable. Nach Ablauf der Frist wird nur das Dokument gelöscht, die Zeile (Typ, Status, Prüfer, Datum) bleibt bis zur Account-Löschung (siehe 7.3, ADR 008).
- v0.11 (M9b, ADR 020): `submitted_at` (nur Server). Zeile zuerst: Der Server setzt `document_path = {user_id}/{id}`, der Upload ist nur auf genau diesen Pfad möglich. Dateien JPEG, PNG oder PDF (≤ 10 MB, kein HEIC). `gewerbe` nur für gewerbliche Konten. Entscheidung, Widerruf und Zurückziehen nur per RPC; nie über das eigene Konto. Grund-Codes `unreadable | expired | mismatch | wrong_document | other`.

**regions**
- `country`, `level` enum (`state | district`), `parent_id` null, `code` text (state: ISO 3166-2, z. B. `DE-BY`; district: amtlicher Schlüssel mit Länderpräfix, z. B. `DE-09162`), `slug` text, `name_de`, `name_en`, `name_cs`, `name_pl`, `centroid` geography(point); unique (`country`, `level`, `code`)
- Anzeigen sind nur in Ländern möglich, für die `district`-Daten vorliegen (zunächst DE, AT).
- `area_km2` (v0.8): Fläche aus den amtlichen Quellen (ADR 007), als Zahl ohne Polygon; steuert die Punktwahl (3.3)
- Befüllt mit Bundesländern/Kantonen/Kraje/Woiwodschaften und Landkreisen/Bezirken.

**listings**
- `owner_id` fk profiles
- `kind` enum: `lease | permit | driven_hunt | trophy_hunt | helper`
  (Jagdpacht, Begehungsschein, Gesellschafts-/Drückjagd, Trophäen-/Gastjagd, Jagdhelfer/Mitjäger)
- `direction` enum: `offer | wanted`
- `title` text (3–100 Zeichen), `description` text (max 5000; zum Absenden mindestens 30). Längen in Codepoints, Leerraum am Rand zählt nicht (ADR 013).
- `content_language` enum: `de | en | cs | pl`
- `country`, `region_id` fk regions (Landkreis-Ebene)
- `display_location` geography(point) – verfremdet, siehe 3.3
- `map_point` geometry(point) (v0.8): `display_location` oder Mittelpunkt des Kreises, nur vom Trigger gesetzt, für Karte und Bereichssuche (ADR 016)
- `postal_prefix` text null – die ersten beiden Ziffern der PLZ, einzige öffentliche Ortsangabe außer dem Kreis (v0.5, nur vom Server gesetzt)
- `price_minor` bigint null, `currency` enum: `EUR | CHF | CZK | PLN`, `price_unit` enum: `total | per_year | per_hectare_year | per_day | per_animal | on_request`
- `area_hectares` numeric null
- `start_date`, `end_date` date null
- `status` enum: `draft | pending_review | active | paused | expired | rejected | removed`
- `reject_code` text null (v0.6): Grund-Vorlage der Moderation (`incomplete | wrong_category | weapons | prohibited_content | duplicate | contact_in_text | implausible | other`), nur bei `draft` (Bearbeitung angefordert) und `rejected`
- `reject_reason` text null: optionaler Freitext zum Code (Pflicht bei `other`)
- `submitted_at` timestamptz null (v0.6): letzter Wechsel nach `pending_review`, nur Server
- `expires_at` timestamptz (Standard: 60 Tage nach Freigabe, `app_settings.listing_active_days`)
- `published_at` timestamptz null (v0.7): erste Freigabe, nie zurückgesetzt (Sortierung „neueste“, neue Anzeige für Suchaufträge); `approved_at` (v0.7): letzte Freigabe. Beide nur Server, nicht im Inhalts-Hash
- `attributes` jsonb (siehe 3.2), bei jedem Schreiben geprüft (`private.listing_attributes_error`)
- `search_vector` tsvector (generiert aus Titel, Beschreibung)
- v0.11 (M9b, ADR 020): `edited_at` (letzte Änderung durch den Besitzer, auch an Fotos, Wildarten und Ort; nur Server, nicht im Inhalts-Hash; Bestand `greatest(created_at, submitted_at)`) und `draft_notice_at` (Hinweis vor dem Löschen eines verlassenen Entwurfs, nur Server). Entfernen (`→ removed`) nur per `moderate_listing` mit der Entscheidung `remove` aus `active`, `paused`, `pending_review` oder `expired`; Rücknahme nach erfolgreicher Beschwerde `removed`/`rejected → pending_review`.

**listing_photos** (v0.5, ADR 011)
- `listing_id`, `sort_order` (0–7, max 8 pro Anzeige, unique je Anzeige)
- `upload_path` – Eingang im privaten Bucket `listing-uploads` (nur JPEG, vom Server vergeben, nach der Verarbeitung gelöscht)
- `storage_path`, `thumb_path` – verarbeitete Dateien in `listing-photos` (ohne Metadaten, lange Seite ≤ 2048 bzw. Thumbnail), nur vom Server gesetzt
- `processed_at`, `width`, `height`, `processing_attempts` (höchstens 3) – nur Server
- `alt_text` text null (1–200 Zeichen; ohne Angabe „Titel, Foto n von m“)
- Ablauf: Client legt die Zeile an, lädt in den Eingang, ruft die Edge Function `process-listing-photo`; öffentlich sind nur verarbeitete Fotos aktiver Anzeigen.

**listing_places** (v0.5, ADR 012) – `listing_id` (PK), `postal_code`, `place_name`, `updated_at`; nur Besitzer und Admins mit 2FA, nie öffentlich. Schreiben über die RPC `set_listing_location` (Kreis, PLZ, Ort in einem Schritt).

**postal_codes**, **postal_code_places**, **postal_code_regions** (v0.5, ADR 012) – PLZ-Verzeichnis DE und AT mit Ortsnamen und Kreiszuordnung (Referenzdaten, öffentlich lesbar).

**game_species** (Referenz)
- `code` (z. B. `roe_deer`, `red_deer`, `wild_boar`, `fallow_deer`, `chamois`, `mouflon`, `waterfowl`, `small_game`, `other_predators`, …), `name_de/en/cs/pl`; vollständige Liste im Glossar

**listing_species** (n:m) – `listing_id`, `species_code` (zusammengesetzter Primärschlüssel statt `id`); Pflicht (mindestens eine) bei Angeboten für Pacht, Begehungsschein und Trophäenjagd (3.2)

**favorites** – `user_id`, `listing_id` (unique)

**saved_searches**
- `user_id`, `name`, `filters` jsonb, `notify_push` bool, `notify_email` bool (Web, M8), `last_notified_at` (nur Server); max. 25 je Konto
- v0.10 (ADR 018): `cadence` (`instant | daily`), `paused_at`, `expires_at` (42 Tage, nur Server; Pausieren hält sie nicht an); Filter nach dem Anlegen fest, ohne `sort`; Pausieren, Fortsetzen, Verlängern nur per RPC

**Suchauftrags-Benachrichtigung** (v0.10, privat) – `search_match_queue`, `saved_search_matches`, Entdopplung je Empfänger und Anzeige, Zustand je Empfänger mit `claim_id`; `moderation_notifications`; `unsubscribe_tokens` (nur SHA-256, Scope `saved_search_mail` | `chat`)

**conversations**
- `listing_id` (nullable: wird beim Löschen der Anzeige leer, der Chat bleibt), `owner_id` (aus der Anzeige), `interested_id`, `last_message_at`, unique (`listing_id`, `interested_id`)

**messages**
- `conversation_id`, `sender_id`, `recipient_id` (v0.9, vom Server aus der Unterhaltung), `body` text (1–2000 Zeichen nach dem Trimmen, ohne Steuer- und Bidi-Zeichen), `read_at` (nur `null → now()`)
- Schreiben nur über die RPCs `start_conversation`, `send_message`, `mark_conversation_read` (v0.9, ADR 017); Rate-Limits `RV002` (neue Unterhaltungen, Nachrichten, ohne Antwort)

**chat_notifications** (v0.9, privat) – `conversation_id`, `recipient_id`, `channel` (`email` | `push`), `last_sent_at`, `attempts`; Mail nur zu Nachrichten seit der letzten Mail, ohne Nachrichtentext; Abmeldung über `profiles.notify_chat_email`

**reported_message_snapshots** (v0.9, privat) – Kopie einer gemeldeten Nachricht (`body`, `sender_id`, `created_at`, `conversation_id`) für die Moderation, Frist wie bearbeitete Meldungen

**blocks** – `blocker_id`, `blocked_id` (unique)

**reports**
- `reporter_id`, `target_type` enum (`listing | message | profile`), `target_id` (ohne FK, überdauert Löschungen), `reason` enum (`scam | illegal | weapons | harassment | wrong_category | other`), `note`, `status` (`open | handled`), `handled_by`, `handled_at`; max. 20 Meldungen je Konto in 24 h
- v0.11 (M9b, ADR 020): `outcome` (`no_action | content_removed | point_removed | account_warned | account_blocked | target_gone`, nur Server, für Meldende lesbar) und `decision_audit_id` (fk audit_log, set null); höchstens eine offene Meldung je Meldendem und Ziel; `reporter_id` ist `null` bei Meldungen, die der Admin aus dem Kontaktweg im Impressum anlegt

**appeals** (v0.11, M9b, ADR 020) – `user_id`, `decision_audit_id` (fk audit_log, set null), `text` (10–2000), `status` (`open | upheld | reversed`), `decided_at`, `decision_note`; höchstens eine je Entscheidung; Schreiben nur per RPC `submit_appeal`, ohne Legal-Gate, auch für gesperrte Konten

**reviews** (Phase 2) – `conversation_id`, `author_id`, `target_id`, `rating` 1–5, `text`

**devices** (nur iOS-Push) – `user_id`, `apns_token`, `platform` (`ios`), `language`; Registrierung nur über die RPC `register_device` (hängt das Token beim Kontowechsel um)

**audit_log** – Admin-Aktionen (Freigabe, Ablehnung, Sperre, Verifizierung). Ab v0.11 auch die Quelle für Entscheidungen nach DSA Art. 17 (Begründung, `my_decisions`, Beschwerden, Export) und für die Einsicht in Verifizierungsdokumente und gesicherte Nachrichten (`verification.document_viewed`, `report.message_viewed`).

**legal_acceptances** (v0.4) – `user_id`, `document` (`terms` | `privacy`), `version`, `source` (`web` | `ios`), `accepted_at`; schreibbar nur über die RPC `accept_legal`, die gegen die aktuellen Versionen prüft. Ohne Zustimmung zur aktuellen Version führt der Client ins Onboarding; ab M3/M7 prüfen auch Anzeigen- und Chat-Policies die Zustimmung (`private.has_accepted_current_legal()`), Meldungen bewusst nicht. Ausnahme (v0.9, ADR 017): Unterhaltungsliste, Chat-Ansicht, Melden und blockierte Personen bleiben ohne aktuelle Zustimmung erreichbar (Lesen, Blockieren, Melden; App Store, DSA), statt der Eingabe zeigt der Client den Weg zur Zustimmung. Gilt auch für iOS (I5). Ab v0.11 ebenso Konto löschen, Datenexport, „Meine Meldungen“, Entscheidungen und Beschwerde (ADR 019, 020).

**Konto und Moderation, privat** (v0.11)
- `account_deletions` (M9a, ADR 019) – Anker der Löschung ohne FK: `user_id`, E-Mail-Snapshot bis zum letzten Schritt, Versuche, nächster Versuch, Lease (`claim_id`, `claimed_until`)
- `data_exports` (M9a) – Zähler für das Export-Limit (3 je 24 h), 7 Tage
- `verification_attempts` (M9b) – Zähler für das Verifizierungs-Limit (3 je 30 Tage)
- `account_notifications` (M9b) – Warteschlange der Dienstmails (`kind` mit fester Liste, `ref_id` auf Audit- bzw. Fachdatensatz, keine E-Mail), 30 Tage

### 3.2 `attributes` je Anzeigenart
Validierung in der DB bei jedem Schreiben (`private.listing_attributes_error`) und gleichlautend im Client (Zod im Web, gemeinsame Fälle in `supabase/tests/fixtures/listing_rules.json`). Unbekannte Schlüssel sind Fehler. Verbindlich ist ADR 013; die endgültigen Pflichtangaben prüft der Anwalt (7.2).

- `lease`: `lease_type` (`eigenjagd | genossenschaft | pachtnachfolge | anteil`), `revier_type[]` (`hochwild | niederwild | feld | wald | berg | wasser`), `submission_deadline` (Datum), `lease_duration_years` (1–99), `shooting_plan` (Text ≤ 2000), `hunting_hut` bool, `co_lessee_slots` (0–50)
- `permit`: `paid` bool, `permit_scope` (`selbststaendig | begleitet`), `season` (≤ 200), `species_limits` (≤ 1000)
- `driven_hunt`: `event_date` (nicht in der Vergangenheit), `spots_available` (1–500), `meeting_point_description` (≤ 500), `dogs_required` bool
- `trophy_hunt`: `legal_ack` bool (Pflicht-Häkchen „Nutzer kennt die rechtlichen Voraussetzungen“), `trophy_details` (≤ 1000), `season`, `includes_accommodation` bool, `import_export_note` (≤ 1000). `species_targeted[]` entfällt (v0.5): Wildarten stehen wie bei allen Arten in `listing_species`.
- `helper`: `experience_level` (≤ 200), `tasks[]` (1–20 Einträge, je ≤ 100)

**Pflichtangaben zum Absenden** (Bereitschaftsprüfung, ADR 013):
- alle: Beschreibung ≥ 30 Zeichen; eine angegebene PLZ muss existieren und zum Kreis passen; `event_date` nie in der Vergangenheit; Fotos verarbeitet
- Trophäenjagd, Angebot und Gesuch: `legal_ack = true`
- nur Angebote: PLZ und Ort, dazu je Art Pacht `lease_type`, `revier_type`, `area_hectares`, Wildart; Begehungsschein `permit_scope`, `paid`, Wildart; Gesellschaftsjagd `event_date`, `spots_available`; Trophäenjagd Wildart; Jagdhelfer `tasks`
- Gesuche sonst ohne weitere Pflichtfelder

### 3.3 Standortschutz
- Nutzer wählt den Landkreis (Pflicht) und optional einen Punkt auf der Karte.
- Gespeichert wird in `display_location` ein **verfremdeter Punkt** (v0.5, ADR 006 v2): Der Eingabepunkt rastet auf die Mitte seiner 1-km-Zelle ein und wird um einen festen Vektor von 3–5 km verschoben, der je Besitzer und Kreis gleich bleibt (HMAC mit Secret). So mittelt sich der Versatz auch über viele Anzeigen nicht heraus. Den Punkt setzt nur der Besitzer; er liegt höchstens 80 km vom Kreismittelpunkt. Ohne Punkt zeigen Clients den Kreismittelpunkt. In Kreisen unter 400 km² (`app_settings.listing_location_min_district_km2`) ist kein Punkt erlaubt, weil die Kreisgrenze den Ring sonst stark eingrenzt; setzt ein Besitzer im selben Kreis einen weiteren Punkt in einer anderen Zelle, weist der Client darauf hin (v0.8, ADR 016). Der gespeicherte Punkt wird nie als Eingabe zurückgeschickt.
- Exakte Koordinaten werden nicht gespeichert. Die genaue Lage teilen Anbieter selbst im Chat.
- Ort mit PLZ (ADR 012): Angebote brauchen PLZ und Ortsnamen, die PLZ muss zum Kreis passen; bei Gesuchen (gesuchtes Gebiet) reicht der Kreis. Volle PLZ und Ort sind nie öffentlich und nie Such- oder Filterkriterium, öffentlich erscheinen nur die ersten beiden Ziffern.

### 3.4 Wichtige RLS-Regeln
- `listings`: jeder darf `status = 'active'` mit `expires_at > now()` von nicht gesperrten Besitzern lesen; Besitzer liest/ändert eigene; Admin liest alles. Statuswechsel prüft ein Trigger:
  - Besitzer: `draft → pending_review`, `pending_review → draft`, `active → paused`, `paused → active` (Fortsetzen ohne erneute Prüfung, nur solange `expires_at` nicht abgelaufen ist).
  - Jede Inhaltsänderung an einer `active`- oder `paused`-Anzeige setzt sie auf `pending_review`.
  - Nur Admin: `pending_review → active | rejected`, `* → removed`. `expires_at`, `reject_reason`, `owner_id` setzt nur der Server.
- `messages`/`conversations`: nur Teilnehmer lesen; Schreiben nur per RPC (v0.9); gesperrte (blockierte) Paare sowie gesperrte oder gelöschte Konten auf einer der beiden Seiten dürfen nicht schreiben. Eine neue Unterhaltung nur zu öffentlichen, fremden Anzeigen; bestehende Unterhaltungen bleiben beschreibbar, wenn die Anzeige nicht mehr öffentlich ist.
- `verifications` und Dokument-Bucket: nur Besitzer (Insert/Read eigene) und Admin.
- `profiles`: öffentlich lesbar nur `display_name`, `account_type`, `verification_status`, `business_name`, `country` (über die View `public_profiles`); alles andere nur Besitzer/Admin. Öffentlich erscheinen nur Anbieter mit mindestens einer öffentlichen Anzeige, außerdem sehen Chatpartner einander. Der öffentliche Status zeigt nur „verifiziert“ oder nichts, `pending`/`rejected` sieht nur der Nutzer selbst (v0.3).
- `reports`: Insert für eingeloggte Nutzer (nur sichtbare Ziele); Meldende lesen den Stand ihrer eigenen Meldungen (DSA), ohne den bearbeitenden Admin zu sehen; alles andere nur Admin.
- Rolle `admin` über Custom Claim, nie über Client-Felder.
- Öffentlich ist eine Anzeige genau dann, wenn `private.listing_is_public` zutrifft (aktiv, nicht abgelaufen, Besitzer aktiv); Policy, View, Such-RPCs und Sitemap nutzen dieselbe Definition (v0.7, ADR 015). Nach außen gibt es für einmal veröffentlichte, jetzt nicht öffentliche Anzeigen nur den Zustand „nicht mehr verfügbar“ (410), nie „entfernt“.

## 4. Screens

Die Web-App und die iOS-App bieten dieselben Funktionen mit plattformgerechter Bedienung. Unterschiede stehen unten.

### 4.1 iOS

**Onboarding / Auth**
1. Sprachwahl + Land (Standard aus Gerätesprache)
2. Login/Registrierung (Apple, E-Mail), Zustimmung AGB/Datenschutz (Pflicht-Checkbox, Verlinkung)

**Tab-Navigation (5 Tabs)**
1. **Entdecken**: Suchfeld, Kategorie-Chips (Pacht, Begehungsschein, Gesellschaftsjagd, Trophäen, Helfer), Umschalter Angebote/Gesuche, Liste neuester Anzeigen, Filter-Button, Karten-Umschalter
2. **Karte**: MapKit mit Clustern, Tap öffnet Kurzkarte, „In diesem Bereich suchen“
3. **Inserieren** (zentraler Button): Assistent in Schritten (Art → Angebot/Gesuch → Details → Fotos → Ort/Zeitraum/Preis → Vorschau → Absenden)
4. **Nachrichten**: Unterhaltungsliste, Chat-Ansicht (Anzeigenkopf, Melden/Blockieren im Menü)
5. **Profil**: Meine Anzeigen (mit Status), Favoriten, Suchaufträge, Verifizierung, Einstellungen

### 4.2 Web-App

**Öffentlich (ohne Login, SEO-fähig, serverseitig gerendert)**
- Startseite mit Suchfeld, Kategorien, Länderwahl und neuesten Anzeigen
- Kategorie- und Regionsseiten (z. B. `/de/jagdpacht/bayern`), Listenansicht mit Filtern, Karte
- Anzeigen-Detail: Galerie, Eckdaten, Anbieterbadge, Karte mit verfremdetem Punkt. **Kontakt-Button führt zum Login**, keine Kontaktdaten sichtbar
- Statische Seiten: Über uns, So funktioniert es, Hilfe/FAQ, Impressum, Datenschutz, Nutzungsbedingungen, Richtlinien (verbotene Inhalte)
- Sprachumschalter (de/en/cs/pl) mit Sprachpräfix in der URL, `hreflang`, Sitemap je Sprache

**Mit Login**
- Dashboard: Meine Anzeigen (Status, Fristen, Verlängern/Pausieren), Favoriten, Suchaufträge, Nachrichten, Verifizierung, Einstellungen
- Inserieren: gleicher Assistent wie in iOS, Foto-Upload per Drag-and-drop
- Chat im Browser mit Realtime und Ungelesen-Zähler
- Einstellungen: Sprache, E-Mail-Benachrichtigungen, Blockierte Nutzer, Datenexport, **Account löschen**

### 4.3 Gemeinsame Screens und Zustände
- Filter (Land, Region, Art, Wildarten, Preis mit Währung, Fläche, Zeitraum, nur verifizierte Anbieter)
- Suchauftrag speichern/bearbeiten
- Öffentliches Anbieterprofil (v0.7): Anzeigename bzw. Firmenname, Privat/Gewerbe, Badge „verifiziert“, Land, aktive Anzeigen; kein „dabei seit“. Profile von Privatpersonen sind `noindex`
- Suche und Filter über die RPC `search_listings` mit Filterformat v1 (ADR 015), gleich für Web, Suchaufträge und iOS; Preisfilter nur in der gewählten Währung, keine Umrechnung
- Verifizierung (Dokument fotografieren/hochladen, Status)
- Melden-Dialog für Anzeigen, Nachrichten und Profile
- **Zustände, die immer gebaut werden:** Laden, Leer, Fehler, Offline-Hinweis, abgelaufene/entfernte Anzeige

### 4.4 Unterschiede nach Plattform
- Benachrichtigungen: iOS per Push (APNs), Web per E-Mail (Push im Browser erst Phase 2)
- Login: iOS mit Sign in with Apple und E-Mail; Web mit E-Mail/Magic Link und Sign in with Apple (Pflicht, sobald es andere Social-Logins gibt). E-Mail ist passwortlos: eine Mail mit Link und 6-stelligem Code, der Link bestätigt erst per Button (v0.4, ADR 010). iOS nutzt denselben Code.
- Kamera/Dokumentenscan: iOS direkt aus der App, Web per Datei-Upload
- Karte: iOS MapKit, Web MapLibre mit OpenStreetMap-Kacheln (Anbieter und Datenschutz in ADR festlegen)

## 5. Admin-Bereich (Web, `/admin`)
- Zugriff nur mit Admin-Rolle, zusätzlich Zwei-Faktor-Authentifizierung (TOTP); Nicht-Admins erhalten 403 (v0.6, ADR 014)
- Übersicht mit Zählern (v0.11): Anzeigen, Verifizierungen, Meldungen, Beschwerden und „Löschungen hängen“ (nur Anzahl, ohne Identität; ADR 019)
- Warteschlange „Anzeigen zur Freigabe“ (Freigeben, Ablehnen mit Grund, Bearbeitung anfordern); Grund als Vorlage plus Freitext, der Besitzer sieht ihn in seiner Sprache (M4)
- Admins ernennen und entziehen (M4): Suche per exakter E-Mail, frische 2FA-Bestätigung, Limits, 7 Tage Karenz, letzter Admin geschützt. Konten mit Rolle können weder gesperrt noch gelöscht werden, bevor die Rolle entzogen ist (v0.11, ADR 005)
- Warteschlange „Verifizierungen“ (v0.11, M9b, ADR 020): nur eingereichte Anträge; Dokument nur über einen auditierten 60-Sekunden-Link (ohne Audit-Eintrag kein Zugriff, auch nicht über die Storage-API); Entscheidung mit Grund-Code und Begründung, Widerruf; nie über das eigene Konto
- Meldungen bearbeiten (v0.11, M9b): gruppiert je Ziel; gemeldete Nachricht nur per Klick und auditiert; Maßnahmen keine Maßnahme, Anzeige entfernen, Kartenpunkt entfernen, Konto verwarnen, Konto sperren; Ergebnis an die Meldenden
- Nutzer suchen (exakte E-Mail oder UUID, Rate-Limit, auditiert) und sperren, entsperren, verwarnen; nie das eigene Konto (v0.11, M9b)
- Beschwerden (v0.11, M9b): Liste und Entscheidung (bestätigt oder aufgehoben, mit Rückgängigmachen der Maßnahme); nicht der Admin der ursprünglichen Entscheidung, außer es gibt keinen anderen aktiven Admin (im Audit markiert)
- Audit-Log einsehen
- Admin-Seiten sind `noindex` und nicht in der Sitemap

## 6. Backlog (in dieser Reihenfolge, je Schritt eigener Arbeitsauftrag)

Jeder Schritt endet mit Build, Tests, Changelog-Eintrag. Die Reihenfolge ist **Web zuerst, dann iOS**: Das Backend und die Kernflows werden im Web schneller getestet, die iOS-App setzt auf einem erprobten Backend auf.

**M0 Fundament**
- Repo-Struktur (`web/`, `ios/`, `supabase/`, `docs/`), Next.js-Projekt mit TypeScript, Tailwind, `next-intl` (4 Sprachen), Lint/Typecheck/Tests, Supabase-Projekt (EU), `.gitignore`, Umgebungen dev/prod
- Xcode-Projekt (SwiftUI, iOS 17) wird jetzt nur als leeres Grundgerüst angelegt und erst in M10 weitergebaut
- *Akzeptanz:* `npm run dev` zeigt die lokalisierte Startseite in allen 4 Sprachen; Lint, Typecheck und ein Beispieltest laufen grün; Supabase-Verbindung funktioniert

**M1 Datenbank und Sicherheit**
- Migrationen für alle Tabellen aus Abschnitt 3, Enums, Indizes, Seed für `game_species` und `regions` (DE/AT zuerst)
- RLS-Policies und automatisierte Policy-Tests
- *Akzeptanz:* Test beweist, dass Nutzer A weder Nachrichten, Verifizierungsdokumente noch Entwürfe von Nutzer B lesen kann

**M2 Auth und Profil (Web)**
- Registrierung/Login (E-Mail/Magic Link, Sign in with Apple), Profil anlegen, AGB-Zustimmung, Session-Handling mit `@supabase/ssr`
- *Akzeptanz:* Registrieren, ausloggen, wieder einloggen; Profil bearbeiten; geschützte Seiten leiten auf Login um

**M3 Anzeigen erstellen (Web)**
- Assistent für alle 5 Arten, Foto-Upload (Verkleinerung, max 8), Preisfeld mit Währung, Entwurf speichern, Absenden → `pending_review`
- *Akzeptanz:* Anzeige erscheint in „Meine Anzeigen“ mit Status; Pflichtfelder je Art werden validiert

**M4 Admin-Bereich (Freigabe)**
- `/admin` mit Admin-Rolle und 2FA, Freigabe/Ablehnung inkl. Grund, Audit-Log
- *Akzeptanz:* Freigegebene Anzeige wird sichtbar, abgelehnte zeigt Grund im Dashboard; Nicht-Admins erhalten 403

**M5 Öffentliche Seiten, Suche, Detail (Web)**
- Startseite, Kategorie- und Regionsseiten, Volltextsuche, Filter, Anzeigen-Detail, Favoriten, Meta-Tags, `hreflang`, Sitemap, strukturierte Daten
- *Akzeptanz:* Filtern nach Land/Region/Art/Preis liefert korrekte Ergebnisse; Preise in Originalwährung mit passender Locale; nicht freigegebene Anzeigen sind weder abrufbar noch indexierbar

**M6 Karte (Web)**
- MapLibre mit Clustern, Bereichssuche, verfremdete Punkte
- *Akzeptanz:* Karte zeigt nur verfremdete Positionen; Klick öffnet Detail

**M7 Chat (Web)**
- Unterhaltung pro Anzeige, Realtime, Ungelesen-Zähler, E-Mail-Benachrichtigung bei neuer Nachricht (mit Drosselung), Blockieren/Melden im Chat
- *Akzeptanz:* Zwei Browser-Sitzungen tauschen Nachrichten in Echtzeit; blockierter Nutzer kann nicht mehr schreiben

**M8 Suchaufträge (Web)**
- Filter speichern, serverseitiger Abgleich bei neuer Freigabe (Edge Function), E-Mail-Benachrichtigung
- *Akzeptanz:* Neue passende Anzeige löst genau eine E-Mail aus

**M9 Vertrauen und Compliance (Web)** – geteilt in M9a und M9b (v0.11), jeweils mit eigener QA-Abnahme; M9 gilt erst nach M9b als abgeschlossen.

**M9a Konto und Datenschutz** (ADR 019, 021)
- Account-Löschung (inkl. Daten und Storage) mit frischer Anmeldung, Datenexport, Cookie-Inventar und Seite „Cookie-Einstellungen“ (ohne Banner, solange nur Notwendiges läuft), Rechtstext-Platzhalter (Datenschutz, Nutzungsbedingungen, Richtlinien) und Seite „Datenquellen“, Aufräumjobs für Löschung, nie bestätigte Konten, Foto-Eingang, Fotos ohne Zeile, Meldungs- und Audit-Fristen, Export-Zähler
- Karte (v0.8, ADR 016): Die Seite „Cookie-Einstellungen“ führt die selbst gehostete Karte als technisch notwendigen eigenen Dienst; die Datenschutzerklärung (Platzhalter) nennt sie (Kacheln landen nicht im Cache Storage des Browsers, geprüft in M6). Wechselt der Kachelanbieter zu einem eigenen Verantwortlichen oder außerhalb der EU, lädt die Karte erst nach Einwilligung.
- *Akzeptanz:* Gelöschter Account verschwindet aus allen Tabellen/Buckets (bis auf gesetzlich nötige Reste, siehe Abschnitt 7); ohne Einwilligung laufen keine nicht notwendigen Cookies
- *Nachweis:* der erste Punkt ausschließlich über den Integrationstest gegen den echten lokalen Stack (GoTrue, Storage-API, Inventar über alle Nicht-System-Schemas), der zweite über das E2E-Inventar von Cookies und Browser-Speicher mit Selbsttest

**M9b Vertrauen und Moderation** (ADR 020)
- Verifizierung (Upload, Admin-Entscheidung, Widerruf, Badge), Melden von Anzeigen/Profilen mit „Meine Meldungen“, Meldungs-Warteschlange im Admin mit Maßnahmen, Nutzer suchen und sperren/verwarnen, Begründungen und Beschwerden (DSA Art. 17/20, Platzhalter), Moderations-Mails auch für Server-Pfade, allgemeine Warteschlange für Dienstmails, verlassene Entwürfe, Aufräumjobs für Dokumente, verwaiste Anträge und Beschwerden
- *Akzeptanz:*
  - Upload eines Dokuments → Entscheidung im Admin → Badge „verifiziert“ öffentlich sichtbar (und nach Widerruf wieder weg)
  - Meldung einer Anzeige → Entfernen im Admin → Mail an den Besitzer mit Begründung und an die Meldenden mit dem Ergebnis
  - Sperre eines Kontos → Beschwerde des Betroffenen → Entsperrung durch einen anderen Admin
  - Ein Verifizierungsdokument ist ohne frischen Audit-Eintrag `verification.document_viewed` nicht lesbar, auch nicht für Admins über die Storage-API

**M10 Web-Release**
- Accessibility-Durchlauf, Performance (Core Web Vitals), Fehlerseiten, Monitoring, Backups, Domain/Deployment, Staging-Test mit echten Testnutzern
- *Akzeptanz:* Checkliste in `docs/WEB-RELEASE.md` komplett abgehakt

— **Ab hier iOS-App auf dem erprobten Backend** —

**I1 iOS Fundament, Auth und Profil**
- Xcode-Projekt ausbauen, String Catalog (4 Sprachen), `supabase-swift`, Service-Schicht, Sign in with Apple, E-Mail-Login, Profil
- *Akzeptanz:* Konto aus der Web-App funktioniert auch in der iOS-App; Sprache wechselt mit Systemsprache

**I2 iOS Entdecken, Suche, Detail, Favoriten**
- Liste, Filter, Detailansicht, Favoriten, Preisformatierung mit Locale
- *Akzeptanz:* Gleiche Filter liefern in iOS und Web dieselben Ergebnisse

**I3 iOS Karte**
- MapKit mit Clustern, Bereichssuche, verfremdete Punkte
- *Akzeptanz:* Karte zeigt nur verfremdete Positionen

**I4 iOS Inserieren und Meine Anzeigen**
- Assistent für alle 5 Arten, Foto-Upload, Entwurf, Status, Ablehnungsgrund
- *Akzeptanz:* In iOS erstellte Anzeige erscheint in der Web-Warteschlange

**I5 iOS Chat und Push**
- Unterhaltungen, Realtime, Ungelesen-Zähler, APNs-Push (Edge Function), Blockieren/Melden
- *Akzeptanz:* Nachrichten zwischen Web und iOS kommen in Echtzeit an; Push kommt auf dem Testgerät an

**I6 iOS Suchaufträge, Verifizierung, Konto**
- Suchaufträge mit Push, Verifizierung per Kamera/Upload, Melden, Blockieren, **Account löschen**, Datenexport, Rechtstexte
- *Akzeptanz:* Alle App-Store-Pflichten aus Abschnitt 8 erfüllt

**I7 iOS Feinschliff und App-Store-Release**
- Accessibility, Fehler-/Leerzustände, Performance, Privacy Manifest, App-Store-Assets, Datenschutzangaben, Review-Notizen mit Demo-Account, TestFlight
- *Akzeptanz:* Checkliste in `docs/APPSTORE.md` komplett abgehakt

**Phase 2:** Bewertungen, bezahlte Hervorhebungen (Regeln für In-App-Käufe und Web-Zahlungen prüfen), CZ/PL-Regionendaten vollständig, CH, Anzeigen-Übersetzungshilfe, Browser-Push. **Android ist nicht geplant.**

## 7. Offene Entscheidungen (bitte vor M1/M3 klären)
1. **Name und Domain**, Bundle-ID, Entwickler-Account (Privatperson oder Firma). *Blockiert:* Sign in with Apple (Web ist eingebaut, aber ausgeschaltet) und das Supabase-Cloud-Projekt (ADR 002).
2. **Anwaltliche Prüfung:** Zulässigkeit der Vermittlung je Land, besonders Trophäenjagd und Gastjagd in CZ/PL; Haftungsausschluss; Pflichtangaben je Anzeigenart; Impressumspflicht und DSA-Pflichten für die Web-Plattform Außerdem: ODbL der PLZ-Daten aus OpenStreetMap, ob die Produktdatenbank als Sammlung (Collective Database) gilt und die Anzeigen nicht unter Share-Alike fallen (ADR 012). Ebenso die Basiskarte aus OpenStreetMap (ODbL), die als Datei öffentlich abrufbar ist (ADR 016).
   - **Anbieterangaben gewerblicher Konten (DSA, v0.7):** Welche Angaben muss ein gewerblicher Anbieter nach DSA (Art. 30 Nachverfolgbarkeit, Art. 31) hinterlegen und öffentlich zeigen (Name, Anschrift, Kontakt, Register), und wie prüft die Plattform sie? Heute zeigt das Profil nur Firmenname, Land und das Badge.
   - **Begründung von Entfernungen per E-Mail (DSA Art. 17, v0.7):** Reicht die Begründung im Konto, oder muss jede Entfernung, Ablehnung und Sperre zusätzlich per E-Mail begründet werden (Inhalt, Frist, Hinweis auf Rechtsbehelf)?
   - **Vertrauen und Moderation (v0.11, ADR 020).** Bis zur Antwort bleiben alle Texte, Fristen und Verfahren markierte Platzhalter und gelten nicht als „DSA-konform“:
     - *Melden ohne Konto (Art. 16, Go-live-Bezug):* Reicht „nur eingeloggt“ plus Kontaktadresse im Impressum (der Admin legt die Meldung von Hand an), oder braucht es ein anonymes Formular (dann mit Captcha in M10)?
     - *Meldungen (Art. 16):* Wortlaut der Zusicherung „in gutem Glauben“; ob die Eingangsbestätigung zusätzlich per Mail nötig ist.
     - *Begründung (Art. 17):* Wortlaut von Begründung und Rechtsbehelf in Konto und Mail.
     - *Beschwerden (Art. 20):* Frist (technisch 183 Tage), ob die Ausnahme für Kleinst- und Kleinunternehmen (Art. 19) greift und genutzt werden soll, ob die Ausweichregel „derselbe Admin, wenn kein anderer da ist“ dem Erfordernis qualifizierten Personals (Abs. 6) genügt, Aufbewahrung der Beschwerden (technisch 24 Monate).
     - *Außergerichtliche Streitbeilegung (Art. 21):* Hinweistext in den Mails.
     - *Sperren (Art. 23):* „angemessener Zeitraum“, also befristete statt unbefristeter Sperren; ob ein Hash der Adresse gesperrter Konten gegen Sperrumgehung zulässig ist.
     - *Weitere DSA-Pflichten:* Kontaktstellen für Behörden und Nutzer (Art. 11/12), Meldepflicht bei Straftaten (Art. 18), Transparenzbericht (Art. 15/24).
     - *Badge „verifiziert“:* was es zusagt (Dokument gesehen, keine Identitätsgarantie) und ob das Ablaufdatum eines Jagdscheins zählt.
     - *Verifizierungsdokumente:* Frist von 30 Tagen nach der Entscheidung; EXIF/GPS in Fotos von Dokumenten.
   - **Konto und Datenschutz (v0.11, ADR 019, 021):**
     - *Reste nach der Löschung (Art. 17 Abs. 3 DSGVO):* pseudonymisiertes Audit, Meldungen gegen das Konto und Kopien gemeldeter Nachrichten bis zur Frist; Aufbewahrung des Zustimmungsnachweises (`legal_acceptances`) nach der Löschung.
     - *Cookies:* Einordnung der Session- und PKCE-Cookies als unbedingt erforderlich (§ 25 Abs. 2 TTDSG, seit 2024 TDDDG, und die Umsetzungen in AT, CZ, PL); Laufzeit und Nachweis einer künftigen Einwilligung.
     - *Backups und Logs:* Fristen bei Hoster und Mail-Anbieter in der Datenschutzerklärung (M10).
3. **Retention:** *Technischer Default entschieden (v0.3, ADR 008), anwaltliche Prüfung offen.* Verifizierungsdokument 30 Tage nach Entscheidung löschen, bei Account-Löschung sofort; Metadaten bis zur Account-Löschung. Account-Löschung ist eine echte Löschung inkl. Chats; Audit- und Moderationsdaten bleiben pseudonymisiert. Alle Fristen konfigurierbar (`private.app_settings`). Rechtlich zu prüfen: Dauer für Jagdscheine, DSA-Fristen für Moderationsdaten, Beweissicherung, Nachrichten beim Gegenüber.
   - **Verlassene Entwürfe** (Entscheidung 2026-10-29, Umsetzung M9b): Entwürfe samt Fotos werden nach 12 Monaten ohne Bearbeitung des Entwurfs (`edited_at`) gelöscht, mit Hinweis an den Besitzer 30 Tage vorab; eine Bearbeitung nach dem Hinweis setzt die Frist neu (ADR 020). *Anwaltlich zu prüfen:* Frist, Form und Vorlauf des Hinweises.
   - **Account-Löschung** (Entscheidung 2026-11-08, ADR 019): sofort nach Bestätigung mit frischer Anmeldung (E-Mail-Code bzw. Apple, höchstens 10 Minuten alt), ohne Karenz, auch für gesperrte Konten und ohne aktuelle Zustimmung; Konten mit Admin-Rolle erst nach Entzug. Fester Ablauf mit Wiederholung ohne Abbruch. Es bleiben nur: `audit_log` pseudonymisiert (24 Monate), Meldungen gegen das Konto und Kopien gemeldeter Nachrichten (12 Monate nach Bearbeitung). Nie gemeldete Nachrichten verschwinden auch beim Gegenüber.
   - **Weitere Fristen (v0.11, Platzhalter):** nie bestätigte Konten 7 Tage (über denselben Löschweg); Foto-Eingang und Dateien ohne Zeile 24 h; Export-Zähler 7 Tage; Dienstmail-Warteschlange 30 Tage; Beschwerden 24 Monate nach Entscheidung; Verifizierungsanträge ohne Datei und Dateien ohne Antrag 24 h.
4. **Startregion:** *Entschieden (v0.3, ADR 007).* DE und AT vollständig (Länder und Kreise/Bezirke) aus amtlichen Quellen. CZ, PL, CH folgen vor dem jeweiligen Marktstart.
5. **Verifizierungspflicht:** *Entschieden (v0.11, Nutzerentscheidung 2026-11-08):* Die Verifizierung ist freiwillig, für keine Anzeigenart Pflicht. Sie bringt nur das Badge „verifiziert“ und den Filter „nur verifizierte Anbieter“ (ADR 020).
6. **Glossar:** Jagdfachbegriffe in cs/pl durch Muttersprachler prüfen lassen (`docs/GLOSSARY.md`)
7. **Moderationsprozess:** Wer prüft wie schnell? (Ziel: Freigabe < 24 h)
8. **Kontaktdaten im Chat:** *Entschieden (v0.9, ADR 017):* erlaubt; enthält eine Nachricht Telefonnummer, E-Mail-Adresse, Bankverbindung oder Koordinaten, zeigt der Chat vor dem Senden einen Sicherheitshinweis.
9. **Hosting Web-App:** Anbieter mit EU-Region wählen (z. B. Vercel mit EU-Funktionen oder ein EU-Hoster); Auftragsverarbeitungsvertrag klären
10. **Kartenanbieter Web:** *Entschieden (v0.8, ADR 016):* Vektorkacheln (PMTiles, Protomaps-Basemap aus OpenStreetMap) von der eigenen Origin, kein Dritter; Produktions-Hosting (EU, AVV, Logs ohne IP oder höchstens 7 Tage) in M10.
11. **E-Mail-Versand:** Anbieter mit EU-Hosting für Transaktionsmails (Bestätigung, Benachrichtigung)

## 8. Nicht-funktionale Anforderungen
- Datenschutz: DSGVO, Hosting in der EU, Datensparsamkeit, Cookie-Consent im Web, Privacy Manifest in Xcode
- Performance: Liste lädt unter 1 s bei guter Verbindung; Web mit guten Core Web Vitals; Bilder in Thumbnails und Originalgröße
- SEO: Sprachpräfix in URLs, `hreflang`, Sitemap, strukturierte Daten, `noindex` für Admin, Entwürfe und nicht freigegebene Anzeigen
- Sicherheit Web: Security-Header (CSP, HSTS), CSRF-Schutz, Eingabevalidierung serverseitig, kein `service_role`-Key im Browser
- App-Store-Pflichten (iOS): Melden, Blockieren, Account-Löschung in der App, Sign in with Apple bei Social-Login, Nutzungsbedingungen, Moderationsprozess
- Verfügbarkeit: Backups täglich, Wiederherstellung getestet
- Missbrauchsschutz: Rate-Limits für Anzeigenerstellung, Nachrichten und Meldungen; einfache Spam-Erkennung (z. B. Links, doppelte Texte)
- Logging ohne personenbezogene Inhalte
