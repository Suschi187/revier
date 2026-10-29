# SPEC – Revier (Arbeitstitel), MVP v0.3

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
- `title` text (max 100), `description` text (max 5000)
- `content_language` enum: `de | en | cs | pl`
- `country`, `region_id` fk regions (Landkreis-Ebene)
- `display_location` geography(point) – verfremdet, siehe 3.3
- `price_minor` bigint null, `currency` enum: `EUR | CHF | CZK | PLN`, `price_unit` enum: `total | per_year | per_hectare_year | per_day | per_animal | on_request`
- `area_hectares` numeric null
- `start_date`, `end_date` date null
- `status` enum: `draft | pending_review | active | paused | expired | rejected | removed`
- `reject_reason` text null
- `expires_at` timestamptz (Standard: 60 Tage nach Freigabe)
- `attributes` jsonb (siehe 3.2)
- `search_vector` tsvector (generiert aus Titel, Beschreibung)

**listing_photos**
- `listing_id`, `storage_path`, `sort_order` (max 8 pro Anzeige)

**game_species** (Referenz)
- `code` (z. B. `roe_deer`, `red_deer`, `wild_boar`, `fallow_deer`, `chamois`, `mouflon`, `waterfowl`, `small_game`, …), `name_de/en/cs/pl`

**listing_species** (n:m) – `listing_id`, `species_code` (zusammengesetzter Primärschlüssel statt `id`)

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

### 3.2 `attributes` je Anzeigenart
Validierung im Client und per DB-Check/Edge Function.

- `lease`: `lease_type` (`eigenjagd | genossenschaft | pachtnachfolge | anteil`), `revier_type[]` (`hochwild | niederwild | feld | wald | berg | wasser`), `submission_deadline` (Datum), `lease_duration_years`, `shooting_plan` (Text), `hunting_hut` bool, `co_lessee_slots` int
- `permit`: `paid` bool, `permit_scope` (`selbststaendig | begleitet`), `season`, `species_limits`
- `driven_hunt`: `event_date`, `spots_available`, `meeting_point_description`, `dogs_required` bool
- `trophy_hunt`: `species_targeted[]`, `season`, `includes_accommodation` bool, `import_export_note` (Hinweis auf Trophäen-/Waffenvorschriften, Pflichtfeld-Checkbox „Nutzer kennt rechtliche Voraussetzungen“)
- `helper`: `experience_level`, `tasks[]`

### 3.3 Standortschutz
- Nutzer wählt den Landkreis (Pflicht) und optional einen Punkt auf der Karte.
- Gespeichert wird in `display_location` ein **verfremdeter Punkt** (zufälliger Versatz im Radius ~3–5 km, einmal bei Erstellung festgelegt, nicht bei jedem Abruf neu).
- Exakte Koordinaten werden nicht gespeichert. Die genaue Lage teilen Anbieter selbst im Chat.

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
- Login: iOS mit Sign in with Apple und E-Mail; Web mit E-Mail/Magic Link und Sign in with Apple (Pflicht, sobald es andere Social-Logins gibt)
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
1. **Name und Domain**, Bundle-ID, Entwickler-Account (Privatperson oder Firma)
2. **Anwaltliche Prüfung:** Zulässigkeit der Vermittlung je Land, besonders Trophäenjagd und Gastjagd in CZ/PL; Haftungsausschluss; Pflichtangaben je Anzeigenart; Impressumspflicht und DSA-Pflichten für die Web-Plattform
3. **Retention:** *Technischer Default entschieden (v0.3, ADR 008), anwaltliche Prüfung offen.* Verifizierungsdokument 30 Tage nach Entscheidung löschen, bei Account-Löschung sofort; Metadaten bis zur Account-Löschung. Account-Löschung ist eine echte Löschung inkl. Chats; Audit- und Moderationsdaten bleiben pseudonymisiert. Alle Fristen konfigurierbar (`private.app_settings`). Rechtlich zu prüfen: Dauer für Jagdscheine, DSA-Fristen für Moderationsdaten, Beweissicherung, Nachrichten beim Gegenüber.
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
