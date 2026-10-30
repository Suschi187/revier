# SPEC – Revier (Arbeitstitel), MVP v0.5

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

**regions**
- `country`, `level` enum (`state | district`), `parent_id` null, `code` text (state: ISO 3166-2, z. B. `DE-BY`; district: amtlicher Schlüssel mit Länderpräfix, z. B. `DE-09162`), `slug` text, `name_de`, `name_en`, `name_cs`, `name_pl`, `centroid` geography(point); unique (`country`, `level`, `code`)
- Anzeigen sind nur in Ländern möglich, für die `district`-Daten vorliegen (zunächst DE, AT).
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
- `postal_prefix` text null – die ersten beiden Ziffern der PLZ, einzige öffentliche Ortsangabe außer dem Kreis (v0.5, nur vom Server gesetzt)
- `price_minor` bigint null, `currency` enum: `EUR | CHF | CZK | PLN`, `price_unit` enum: `total | per_year | per_hectare_year | per_day | per_animal | on_request`
- `area_hectares` numeric null
- `start_date`, `end_date` date null
- `status` enum: `draft | pending_review | active | paused | expired | rejected | removed`
- `reject_reason` text null
- `expires_at` timestamptz (Standard: 60 Tage nach Freigabe, `app_settings.listing_active_days`)
- `attributes` jsonb (siehe 3.2), bei jedem Schreiben geprüft (`private.listing_attributes_error`)
- `search_vector` tsvector (generiert aus Titel, Beschreibung)

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

**conversations**
- `listing_id` (nullable: wird beim Löschen der Anzeige leer, der Chat bleibt), `owner_id` (aus der Anzeige), `interested_id`, `last_message_at`, unique (`listing_id`, `interested_id`)

**messages**
- `conversation_id`, `sender_id`, `body` text (max 2000), `read_at`

**blocks** – `blocker_id`, `blocked_id` (unique)

**reports**
- `reporter_id`, `target_type` enum (`listing | message | profile`), `target_id` (ohne FK, überdauert Löschungen), `reason` enum (`scam | illegal | weapons | harassment | wrong_category | other`), `note`, `status` (`open | handled`), `handled_by`, `handled_at`; max. 20 Meldungen je Konto in 24 h

**reviews** (Phase 2) – `conversation_id`, `author_id`, `target_id`, `rating` 1–5, `text`

**devices** (nur iOS-Push) – `user_id`, `apns_token`, `platform` (`ios`), `language`; Registrierung nur über die RPC `register_device` (hängt das Token beim Kontowechsel um)

**audit_log** – Admin-Aktionen (Freigabe, Ablehnung, Sperre, Verifizierung)

**legal_acceptances** (v0.4) – `user_id`, `document` (`terms` | `privacy`), `version`, `source` (`web` | `ios`), `accepted_at`; schreibbar nur über die RPC `accept_legal`, die gegen die aktuellen Versionen prüft. Ohne Zustimmung zur aktuellen Version führt der Client ins Onboarding; ab M3/M7 prüfen auch Anzeigen- und Chat-Policies die Zustimmung (`private.has_accepted_current_legal()`), Meldungen bewusst nicht.

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
- Gespeichert wird in `display_location` ein **verfremdeter Punkt** (v0.5, ADR 006 v2): Der Eingabepunkt rastet auf die Mitte seiner 1-km-Zelle ein und wird um einen festen Vektor von 3–5 km verschoben, der je Besitzer und Kreis gleich bleibt (HMAC mit Secret). So mittelt sich der Versatz auch über viele Anzeigen nicht heraus. Den Punkt setzt nur der Besitzer; er liegt höchstens 80 km vom Kreismittelpunkt. Ohne Punkt zeigen Clients den Kreismittelpunkt (Web in M3 ohne Karte).
- Exakte Koordinaten werden nicht gespeichert. Die genaue Lage teilen Anbieter selbst im Chat.
- Ort mit PLZ (ADR 012): Angebote brauchen PLZ und Ortsnamen, die PLZ muss zum Kreis passen; bei Gesuchen (gesuchtes Gebiet) reicht der Kreis. Volle PLZ und Ort sind nie öffentlich und nie Such- oder Filterkriterium, öffentlich erscheinen nur die ersten beiden Ziffern.

### 3.4 Wichtige RLS-Regeln
- `listings`: jeder darf `status = 'active'` mit `expires_at > now()` von nicht gesperrten Besitzern lesen; Besitzer liest/ändert eigene; Admin liest alles. Statuswechsel prüft ein Trigger:
  - Besitzer: `draft → pending_review`, `pending_review → draft`, `active → paused`, `paused → active` (Fortsetzen ohne erneute Prüfung, nur solange `expires_at` nicht abgelaufen ist).
  - Jede Inhaltsänderung an einer `active`- oder `paused`-Anzeige setzt sie auf `pending_review`.
  - Nur Admin: `pending_review → active | rejected`, `* → removed`. `expires_at`, `reject_reason`, `owner_id` setzt nur der Server.
- `messages`/`conversations`: nur Teilnehmer; gesperrte (blockierte) Paare dürfen nicht schreiben.
- `verifications` und Dokument-Bucket: nur Besitzer (Insert/Read eigene) und Admin.
- `profiles`: öffentlich lesbar nur `display_name`, `account_type`, `verification_status`, `business_name`, `country` (über die View `public_profiles`); alles andere nur Besitzer/Admin. Öffentlich erscheinen nur Anbieter mit mindestens einer öffentlichen Anzeige, außerdem sehen Chatpartner einander. Der öffentliche Status zeigt nur „verifiziert“ oder nichts, `pending`/`rejected` sieht nur der Nutzer selbst (v0.3).
- `reports`: Insert für eingeloggte Nutzer (nur sichtbare Ziele); Meldende lesen den Stand ihrer eigenen Meldungen (DSA), ohne den bearbeitenden Admin zu sehen; alles andere nur Admin.
- Rolle `admin` über Custom Claim, nie über Client-Felder.

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
- Öffentliches Anbieterprofil
- Verifizierung (Dokument fotografieren/hochladen, Status)
- Melden-Dialog für Anzeigen, Nachrichten und Profile
- **Zustände, die immer gebaut werden:** Laden, Leer, Fehler, Offline-Hinweis, abgelaufene/entfernte Anzeige

### 4.4 Unterschiede nach Plattform
- Benachrichtigungen: iOS per Push (APNs), Web per E-Mail (Push im Browser erst Phase 2)
- Login: iOS mit Sign in with Apple und E-Mail; Web mit E-Mail/Magic Link und Sign in with Apple (Pflicht, sobald es andere Social-Logins gibt). E-Mail ist passwortlos: eine Mail mit Link und 6-stelligem Code, der Link bestätigt erst per Button (v0.4, ADR 010). iOS nutzt denselben Code.
- Kamera/Dokumentenscan: iOS direkt aus der App, Web per Datei-Upload
- Karte: iOS MapKit, Web MapLibre mit OpenStreetMap-Kacheln (Anbieter und Datenschutz in ADR festlegen)

## 5. Admin-Bereich (Web, `/admin`)
- Zugriff nur mit Admin-Rolle, zusätzlich Zwei-Faktor-Authentifizierung
- Warteschlange „Anzeigen zur Freigabe“ (Freigeben, Ablehnen mit Grund, Bearbeitung anfordern)
- Warteschlange „Verifizierungen“ (Dokument ansehen, Entscheidung)
- Meldungen bearbeiten (Anzeige entfernen, Nutzer verwarnen/sperren)
- Nutzer suchen und sperren
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

**M9 Vertrauen und Compliance (Web)**
- Verifizierung (Upload, Admin-Entscheidung, Badge), Melden von Anzeigen/Profilen, Meldungs-Warteschlange im Admin, Account-Löschung (inkl. Daten und Storage), Datenexport, Cookie-Consent, Rechtstext-Platzhalter
- *Akzeptanz:* Gelöschter Account verschwindet aus allen Tabellen/Buckets (bis auf gesetzlich nötige Reste, siehe Abschnitt 7); ohne Einwilligung laufen keine nicht notwendigen Cookies

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
2. **Anwaltliche Prüfung:** Zulässigkeit der Vermittlung je Land, besonders Trophäenjagd und Gastjagd in CZ/PL; Haftungsausschluss; Pflichtangaben je Anzeigenart; Impressumspflicht und DSA-Pflichten für die Web-Plattform Außerdem: ODbL der PLZ-Daten aus OpenStreetMap, ob die Produktdatenbank als Sammlung (Collective Database) gilt und die Anzeigen nicht unter Share-Alike fallen (ADR 012).
3. **Retention:** *Technischer Default entschieden (v0.3, ADR 008), anwaltliche Prüfung offen.* Verifizierungsdokument 30 Tage nach Entscheidung löschen, bei Account-Löschung sofort; Metadaten bis zur Account-Löschung. Account-Löschung ist eine echte Löschung inkl. Chats; Audit- und Moderationsdaten bleiben pseudonymisiert. Alle Fristen konfigurierbar (`private.app_settings`). Rechtlich zu prüfen: Dauer für Jagdscheine, DSA-Fristen für Moderationsdaten, Beweissicherung, Nachrichten beim Gegenüber.
   - **Verlassene Entwürfe** (Entscheidung 2026-10-29, Umsetzung M9): Entwürfe samt Fotos werden nach 12 Monaten Inaktivität gelöscht, mit Hinweis an den Besitzer vorab. *Anwaltlich zu prüfen:* Frist, Form und Vorlauf des Hinweises.
4. **Startregion:** *Entschieden (v0.3, ADR 007).* DE und AT vollständig (Länder und Kreise/Bezirke) aus amtlichen Quellen. CZ, PL, CH folgen vor dem jeweiligen Marktstart.
5. **Verifizierungspflicht:** Muss jeder Anbieter verifiziert sein, oder nur für Pachtanzeigen?
6. **Glossar:** Jagdfachbegriffe in cs/pl durch Muttersprachler prüfen lassen (`docs/GLOSSARY.md`)
7. **Moderationsprozess:** Wer prüft wie schnell? (Ziel: Freigabe < 24 h)
8. **Kontaktdaten im Chat:** Telefonnummern/Mails sperren oder zulassen?
9. **Hosting Web-App:** Anbieter mit EU-Region wählen (z. B. Vercel mit EU-Funktionen oder ein EU-Hoster); Auftragsverarbeitungsvertrag klären
10. **Kartenanbieter Web:** Kachel-Anbieter mit DSGVO-konformer Einbindung wählen (ADR)
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
