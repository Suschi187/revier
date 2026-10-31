# Plan M5 – Öffentliche Seiten, Suche, Detail (Web)

Stand: 2026-10-31, Entwurf für das Architekt-Review.

## 0. Auftrag und Akzeptanz (SPEC 6)
- Startseite, Kategorie- und Regionsseiten, Volltextsuche, Filter, Anzeigen-Detail, Favoriten, Meta-Tags, `hreflang`, Sitemap, strukturierte Daten
- **Akzeptanz:**
  - a) Filtern nach Land/Region/Art/Preis liefert korrekte Ergebnisse
  - b) Preise in Originalwährung mit passender Locale
  - c) Nicht freigegebene Anzeigen sind weder abrufbar noch indexierbar

## 1. Entscheidungen des Nutzers (2026-10-31)
1. **URLs je Sprache:** Kategorie-Wörter übersetzt (`/de/jagdpacht/bayern`, `/en/hunting-lease/bayern`, `/cs/pronajem-honitby/bayern`, `/pl/dzierzawa-obwodu/bayern`). Der Regions-Slug ist in allen Sprachen gleich (`regions.slug`).
2. **Regionsseiten:** Bundesland und Kreis (`/de/jagdpacht/bayern/rosenheim`). Seiten ohne Anzeigen sind `noindex` und fehlen in der Sitemap.
3. **Öffentliches Anbieterprofil kommt in M5** (SPEC 4.3): Anzeigename, Privat/Gewerbe (Firmenname), Badge „verifiziert“, Land, aktive Anzeigen.

## 2. Umfang
- **Drin:** Startseite (Suchfeld, Kategorien, Länderwahl, neueste Anzeigen), Kategorie- und Regionsseiten, Suche mit allen Filtern aus SPEC 4.3, Anzeigen-Detail (Galerie, Eckdaten, Anbieterbadge, Kontakt-Button), Anbieterprofil, Favoriten (Merken auf Liste und Detail, Seite „Favoriten“ im Konto), Meta-Tags, Canonical, `hreflang`, Sitemap je Sprache, `robots.txt`, JSON-LD, Zustände Laden/Leer/Fehler und „abgelaufen/entfernt“.
- **Nicht drin:**
  - Karte (M6). Das Detail zeigt Kreis und PLZ-Bereich (`postal_prefix`), keinen Punkt.
  - Chat (M7). Der Kontakt-Button führt ohne Login zum Login mit Rücksprung. Mit Login sagt er „Nachrichten folgen in Kürze“, ohne Kontaktdaten.
  - Suchaufträge speichern (M8). Das Filterformat wird aber jetzt festgelegt (3.2), damit M8 und iOS (I2) es übernehmen.
  - Melden (M9).
  - Statische Seiten „Über uns“, „So funktioniert es“, FAQ, Richtlinien (M9/M10).

## 3. Datenmodell (Migrationen)
### 3.1 `published_at`
- Neue Spalte `listings.published_at timestamptz null`, gesetzt nur vom Server-Trigger beim Wechsel `pending_review → active` (wie `submitted_at`, ADR 014 A8). Nicht beim Fortsetzen `paused → active`.
- Ohne GRANT und nicht im Inhalts-Hash (wie `submitted_at`; Meta-Test der Hash-Ausschlüsse ergänzen).
- Bestand: aktive Anzeigen bekommen `expires_at - listing_active_days`.
- Sortierung „neueste“ über `(published_at desc, id desc)`. Partieller Index `where status = 'active'`.

### 3.2 Suche als RPC (ein Vertrag für Web, M8 und iOS)
- `public.search_listings(p_filters jsonb, p_cursor text default null, p_limit int default 20)`, `security invoker`, `stable`. Die RLS `listings_select_public` bleibt die einzige Sichtbarkeitsregel. Als anon und als eingeloggter Nutzer liefert die RPC nur öffentliche Anzeigen, auch eigene Entwürfe nicht: Bedingung `status = 'active' and expires_at > now()` zusätzlich in der Abfrage.
- **Filterformat** (`filters` jsonb, Version 1). Unbekannte Schlüssel ergeben einen Fehler (`22023`). Geprüft in der DB mit `private.search_filters_error()` und gleichlautend mit Zod im Web. Gemeinsame Fälle liegen in `supabase/tests/fixtures/search_filters.json`.

  | Schlüssel | Bedeutung |
  |---|---|
  | `q` | Text, 1–200 Zeichen |
  | `country` | Land |
  | `region` | Code eines Bundeslands oder Kreises. Ein Bundesland schließt seine Kreise ein. |
  | `kind` | Art |
  | `direction` | Angebot oder Gesuch |
  | `species[]` | Wildarten, Treffer bei mindestens einer |
  | `currency` | Pflicht, sobald ein Preis gesetzt ist |
  | `price_min`, `price_max` | Ganze Zahlen in der kleinsten Einheit |
  | `price_unit` | Preiseinheit |
  | `area_min`, `area_max` | Fläche in Hektar |
  | `date_from`, `date_to` | Überschneidung mit `start_date`/`end_date`. Bei Gesellschaftsjagd zählt `attributes.event_date`. |
  | `verified_only` | Nur verifizierte Anbieter |
  | `sort` | `newest`, `price_asc`, `price_desc` (beide Preis-Sortierungen nur mit `currency`), `relevance` (nur mit `q`) |
- **Keine Umrechnung:** Ein Preisfilter in EUR findet nur Anzeigen in EUR, „auf Anfrage“ und ohne Preis fallen dann heraus. Die Oberfläche sagt das neben dem Filter (CLAUDE.md „Geld“).
- **Volltext:** `search_vector` ist je Inhaltssprache gebaut (german, english, simple). Die Anfrage verknüpft `websearch_to_tsquery` in allen drei Konfigurationen mit ODER. Damit trifft „Rehwild“ deutsche Anzeigen gestemmt und cs/pl-Anzeigen wörtlich. `websearch_to_tsquery` wirft bei keiner Eingabe einen Fehler, und die Eingabe wird nie als SQL zusammengesetzt.
- **Paging:** Keyset-Cursor (opak, base64 aus Sortierschlüssel und `id`), höchstens 50 je Seite. Zurück gibt es `has_more`, eine Gesamtzahl nur bis 1000 (sonst „1000+“).
- **Rückgabe** je Treffer: id, kind, direction, title, content_language, country, Kreis- und Bundesland-Code, `postal_prefix`, Preisfelder, `area_hectares`, Daten, `published_at`, Thumbnail-Pfad des ersten verarbeiteten Fotos, Anbieter-ID, Anzeigename und `verified`. Keine PLZ, kein Ort, kein Punkt (der kommt in M6).
- `verified_only` liest über `public_profiles` (Definer-View, zeigt nur „verified“ oder „none“).
- Indizes prüfen: `listings_public_idx`, GIN `search_vector`, `listing_species (species_code, listing_id)`. Mit `explain` für die häufigsten Fälle (Art + Land + neueste) im CHANGELOG belegt.
- Meta-Allowlist um die RPC ergänzen, `execute` für anon und authenticated.

### 3.3 Abgelaufene und entfernte Anzeigen (SPEC 4.3)
- RLS verbirgt sie. Für den Zustand „abgelaufen/entfernt“ gibt es eine Definer-RPC `public.listing_public_state(p_id uuid) returns text`. Sie liefert `expired` oder `removed` nur für Anzeigen, die einmal veröffentlicht waren (`published_at is not null`), sonst `null`.
- `paused` gilt nach außen als `expired` („nicht mehr verfügbar“). Entwürfe, Prüfung und abgelehnte Anzeigen ergeben `null`, also 404. Damit gibt es kein Orakel für nie veröffentlichte Anzeigen.
- Die Seite zeigt dann nur den Hinweis ohne Inhalte und ist `noindex`; zum Statuscode siehe 4.6.

### 3.4 Anbieterprofil
- Profil aus `public_profiles` (zeigt schon nur Anbieter mit öffentlicher Anzeige oder Chatpartner).
- Anzeigen des Anbieters über eine eigene RPC `public.provider_listings(p_owner uuid, p_cursor text)` mit derselben Rückgabe wie die Suche, **nicht** als Schlüssel `owner` im Filterformat: Sonst ließen sich Suchaufträge (M8) auf Personen anlegen. Frage 8.3.
- Unbekannte, gesperrte, gelöschte Anbieter und Anbieter ohne aktive Anzeige ergeben 404.

### 3.5 Favoriten
- Tabelle und RLS gibt es (M1). Neu ist ein pgTAP-Nachweis: Favorit auf eine Anzeige, die danach pausiert, abläuft oder entfernt wird, bleibt bestehen, ist aber nicht mehr lesbar (Join). Die Favoritenseite zählt diese als „nicht mehr verfügbar“ über `count` der eigenen Zeilen. Ein Nachweis, dass Fremde nichts sehen, ist schon da.
- Limit gegen Missbrauch: höchstens 500 Favoriten je Konto (Trigger, `54000`).

### 3.6 Regions-Slugs
- Bundesland-Slugs müssen über alle Länder eindeutig sein, Kreis-Slugs je Bundesland (heute: eindeutig je Land, ein Kreis-Slug kommt in DE und AT vor). Neuer Unique-Index `(slug) where level = 'state'` und `(parent_id, slug)`. pgTAP.

## 4. Web
### 4.1 Routen
- Ein dynamisches Segment `app/[locale]/[section]/…` mit fester Liste je Sprache (`lib/public/sections.ts`):

  | | de | en | cs | pl |
  |---|---|---|---|---|
  | lease | jagdpacht | hunting-lease | pronajem-honitby | dzierzawa-obwodu |
  | permit | begehungsschein | hunting-permit | povolenka-k-lovu | zezwolenie-na-polowanie |
  | driven_hunt | gesellschaftsjagd | driven-hunt | spolecny-hon | polowanie-zbiorowe |
  | trophy_hunt | trophaeenjagd | trophy-hunt | trofejovy-lov | polowanie-trofeowe |
  | helper | jagdhelfer | hunting-helper | pomocnik-pri-lovu | pomocnik-mysliwego |
  | Suche | suche | search | hledani | szukaj |
  | Detail | anzeige | listing | inzerat | ogloszenie |
  | Anbieter | anbieter | provider | inzerent | oglaszajacy |

- Die cs/pl-Wörter sind wie im Glossar ungeprüft und stehen dort in einer neuen Tabelle „URL-Wörter“.
- Formen:
  - `/{l}/{kind}`, `/{l}/{kind}/{state}`, `/{l}/{kind}/{state}/{district}`
  - `/{l}/{search}?…`
  - `/{l}/{detail}/{id}`
  - `/{l}/{provider}/{userId}`
- Ein unbekanntes Wort, ein falsches Sprachwort (`/en/jagdpacht`) oder ein unbekannter Slug ergibt 404. Ein Wort einer anderen Sprache wird nicht umgeleitet: Canonical und hreflang bleiben eindeutig.
- Statische Routen (`account`, `admin`, `login` usw.) gehen in Next vor. Ein Vitest prüft, dass kein Wort mit einem statischen Segment oder `PROTECTED_SECTIONS` kollidiert.
- **Sprachumschalter:** Für diese Seiten liefert die Seite die Zielpfade je Sprache (die gleiche Funktion wie für hreflang). `LocaleSwitcher` nimmt sie optional entgegen, sonst bleibt es beim heutigen Präfixtausch.
- Das Detail enthält keinen Titel-Slug in der URL. Die Titel ändern sich, die ID ist stabil.

### 4.2 Daten und Cache
- Öffentliche Seiten lesen nur mit dem Anon-Client ohne Cookies (wie `regions.ts`), nie mit der Session. Damit sieht auch der Besitzer seine Anzeige in der Prüfung auf der öffentlichen URL nicht (404), und die Ergebnisse sind cachebar (`"use cache"`, `cacheLife` kurz, z. B. 5 min, `cacheTag("listings")` und `listing:{id}`).
- Freigabe, Ablehnung, Pausieren, Fortsetzen, Löschen und Bearbeiten rufen `revalidateTag`/`updateTag` für `listings` und `listing:{id}`. Ein Ablauf über `expires_at` wirkt spätestens nach der Cache-Dauer, und die RPC prüft `expires_at > now()` ohnehin.
- Personenbezogenes kommt in eigenen Suspense-Inseln, nicht im Cache: Favorit-Status, Kontakt-Button.
- Service-Schicht `lib/services/search.ts`, `lib/services/public-listings.ts`, `lib/services/favorites.ts`. Filter ↔ URL-Parameter in `lib/search/filters.ts` (Zod, rein, Vitest).

### 4.3 Fotos öffentlich
- Der Bucket `listing-photos` ist privat. Lesen dürfen anon und authenticated nur verarbeitete Fotos sichtbarer Anzeigen (M3).
- Vorschlag: Route Handler `app/api/photos/[id]/[variant]/route.ts` (`thumb` | `full`). Er lädt die Datei mit dem Anon-Client (die RLS entscheidet) und liefert sie mit `Cache-Control: public, max-age=300, s-maxage=300`, `X-Content-Type-Options: nosniff` und festem `Content-Type: image/jpeg`.
  - Nach Pausieren oder Entfernen ist ein Foto spätestens nach 5 min nicht mehr abrufbar.
  - Die URL ist stabil (gut für Cache und Google-Bilder), anders als signierte URLs, die in gecachten Seiten verfallen würden.
- Alternative: öffentlicher Bucket. Abgelehnt, weil Fotos entfernter Anzeigen dauerhaft abrufbar blieben (CLAUDE.md „nicht abrufbar“).
- Alt-Texte aus `alt_text`, sonst „Titel, Foto n von m“ (ADR 011). `<img>` mit `loading="lazy"`, `width`/`height` aus der Tabelle (CLS).

### 4.4 Seiten
- **Startseite:**
  - Suchfeld (GET-Formular auf die Suche, ohne JS)
  - Kacheln der 5 Arten
  - Länderwahl (DE, AT, weitere als „bald“), führt zur Suche mit `country`
  - 8 neueste Anzeigen
  - JSON-LD `WebSite` mit `SearchAction`
- **Kategorie- und Regionsseiten:**
  - H1 aus Art und Region („Jagdpacht in Bayern“)
  - Brotkrumen
  - Liste mit Filtern (die Pfadteile sind fest, der Rest steht im Query-String)
  - Links zu Bundesländern und Kreisen mit Anzahl
  - Canonical ohne Query
  - `noindex`, wenn Query-Filter gesetzt sind oder die Seite leer ist
- **Suche:**
  - GET-Formular mit allen Filtern (ohne JS bedienbar)
  - Ergebnisliste, „Weitere laden“ als Link mit Cursor
  - immer `noindex, follow`, Canonical auf die Suche ohne Parameter
  - Leer-, Fehler- und Ladezustand
- **Detail:**
  - Galerie (Thumbnails, Link zur großen Fassung)
  - Titel und Beschreibung mit `lang` der Inhaltssprache
  - Eckdaten wie `ListingSummary` (Art, Richtung, Kreis, PLZ-Bereich „PLZ 83…“, Preis mit `formatPrice` in der Locale der Seite, Einheit, Fläche, Zeitraum, Wildarten, Attribute)
  - Anbieterbadge mit Link zum Profil
  - Merken
  - Kontakt-Button (ohne Login → Login mit `next`)
  - Datum der Veröffentlichung
  - Keine PLZ, kein Ort, keine Kontaktdaten
  - Der Text bleibt, wie er ist. Kontaktdaten im Text verhindert die Moderation (Grund `contact_in_text`).
- **Anbieterprofil:**
  - Anzeigename (bei Gewerbe der Firmenname), Badge, Land, „dabei seit“ (Monat/Jahr, falls das Feld öffentlich werden darf, sonst weg, siehe 8)
  - Liste der aktiven Anzeigen
  - `noindex`? Vorschlag: indexierbar, weil Gewerbe-Anbieter gefunden werden sollen; Privatpersonen `noindex` (Datensparsamkeit). Frage 8.
- **Favoriten** `/account/favorites` (geschützt): Liste, Entfernen, Hinweis auf nicht mehr verfügbare.
  - Merken ist eine Server Action mit Formular, also ohne JS.
  - Ohne Login führt der Button zum Login mit `next` = aktuelle Seite. Dazu muss `safeNextPath` öffentliche Pfade (Detail, Kategorie, Suche, Profil) zulassen. Die Allowlist wird um die Wörter aus 4.1 erweitert, mit Query-String nur für die Suche (die Parameter prüft die Seite).

### 4.5 SEO
- `generateMetadata` je Seite:
  - Titel und Beschreibung lokalisiert, beim Detail aus Titel und gekürzter Beschreibung
  - `alternates` mit den übersetzten Pfaden (`localeAlternates` bekommt eine Variante mit Pfad je Sprache)
  - Open Graph mit erstem Foto
- **Sitemap:**
  - `app/sitemap.ts` mit `generateSitemaps` (eine je Sprache, später nach Menge teilen)
  - Inhalt: Startseite, Kategorien, Regionsseiten mit Anzeigen, aktive Anzeigen (`lastModified` = `published_at`), indexierbare Profile
  - jeweils mit `alternates.languages`
  - Admin, Konto, Suche und leere Seiten fehlen
  - Gelesen per Anon-Client, damit nie etwas Unveröffentlichtes hineingerät
- **`robots.txt`** (`app/robots.ts`): erlaubt alles, nennt die Sitemaps, kein `Disallow` für `/admin` (ADR 014 H7).
- **JSON-LD:**
  - `BreadcrumbList` auf Kategorie, Region und Detail
  - `WebSite` mit `SearchAction` auf der Startseite
  - am Detail: Vorschlag ohne `Product`/`Offer`, weil Jagdgelegenheiten keine Produkte im Sinne der Rich-Results sind und falsche Typen abgestraft werden; Frage 8
  - Ausgabe als `<script type="application/ld+json">` mit `JSON.stringify` und Ersetzen von `<`, `>`, `&`, U+2028/2029 durch `\u…` (UGC im Titel, XSS-Schutz)
  - CSP: Datenblöcke führen kein Skript aus und brauchen keine Nonce (prüfen, siehe 8)
- **noindex** über Metadaten und zusätzlich `X-Robots-Tag` für Detail-404/410 und Suche.

### 4.6 Statuscodes
- Unbekannte und nicht öffentliche Anzeigen ergeben 404. Abgelaufen oder entfernt sollte 410 ergeben.
- Mit `cacheComponents` steht der Status fest, bevor die Seite `notFound()` aufruft (QA M4 F1). Für die Detailseite ist der Status aber SEO-relevant: Google entfernt 404/410 schneller als einen „Soft 404“.
- **Vorschlag:**
  - Der Proxy prüft für `/{l}/{detail}/{id}` und `/{l}/{provider}/{id}` per Anon-RPC `public_page_state(kind, id)` (kurz gecacht), ob die Seite öffentlich ist, und setzt 404 bzw. 410 (Rewrite auf eine statische Seite wie beim 403).
  - Für Kategorie- und Regionsseiten mit unbekanntem Slug genügt die Prüfung gegen die feste Liste bzw. eine gecachte Slug-Liste im Proxy.
  - Kosten: ein DB-Aufruf je Detail-Aufruf im Proxy. Alternative: `notFound()` in der Seite mit `noindex`-Meta (Soft 404, schwächer). Frage 8.

### 4.7 Texte
- Neue Namespaces `Public` (Start, Kategorie, Suche, Filter, Detail, Profil, Zustände), `Favorites`, `Seo`. Alles in en/de/cs/pl.
- Glossar: URL-Wörter, „Merken/Favoriten“, „Anbieter“, „verifiziert“, „nicht mehr verfügbar“.

## 5. Tests
- **pgTAP:**
  - `search_listings`:
    - nur aktive, nicht abgelaufene Anzeigen nicht gesperrter Besitzer
    - auch eingeloggt keine eigenen Entwürfe
    - jeder Filter einzeln und kombiniert (Land, Bundesland schließt Kreise ein, Art, Richtung, Wildart, Preis nur in der gewählten Währung, Fläche, Zeitraum inklusive `event_date`, verifiziert)
    - Sortierungen
    - Cursor ohne Doppelte und Lücken
    - Fehler bei unbekanntem Schlüssel, Preis ohne Währung, Limit > 50
    - Volltext de/en/cs
    - Sonderzeichen in `q`
    - keine PLZ und kein Ort in der Rückgabe
  - `listing_public_state`: nie veröffentlicht → null, abgelaufen/pausiert → expired, entfernt → removed.
  - Profil-RPC: nur aktive Anzeigen, gesperrter Anbieter → leer.
  - `published_at`: nur Server, nicht beim Fortsetzen, nicht im Hash.
  - Slug-Eindeutigkeit, Favoriten-Limit, Meta-Allowlist.
  - Filter-Fixture gleich in DB und Zod.
- **Integration (PostgREST, anon):** Suche liefert nach Freigabe die Anzeige, nach Pausieren nicht mehr. Profil- und Statusabfragen.
- **Vitest:** Filter ↔ URL (Roundtrip, ungültige Werte fallen weg), Wörter je Sprache und Kollisionen, hreflang-Pfade, JSON-LD-Escaping, `safeNextPath` für öffentliche Pfade, Preisformat je Locale (de `1.234 €`, en `€1,234`, cs `1 234 €`, pl `1234 zł` usw.).
- **E2E:**
  - Startseite in 4 Sprachen
  - Filter nach Land/Region/Art/Preis (Akzeptanz a) mit Testdaten aus mehreren Ländern und Währungen
  - Preis in Originalwährung je Locale (b)
  - Entwurf, Prüfung und abgelehnte Anzeige: Detail-URL ergibt 404 und `noindex`, fehlt in Sitemap und Suche (c)
  - abgelaufene Anzeige zeigt den Hinweis
  - hreflang und Canonical übersetzt
  - Sprachumschalter auf Kategorieseite
  - Merken ohne Login → Login → zurück zur Anzeige, gemerkt
  - Favoritenseite
  - Anbieterprofil
  - Suche ohne JavaScript
  - CSP ohne Verletzungen
  - Foto-Route: entfernte Anzeige → 404
  - Testdaten über die Admin-Freigabe aus M4 bzw. Helfer im Testcode (`service_role` nur in Node)

## 6. Doku
- ADR 015 „Öffentliche Seiten und Suche“: URL-Schema, Such-RPC und Filterformat v1, Cache und Invalidierung, Foto-Route, Statuscodes, JSON-LD, Sitemap.
- SPEC v0.7: 3.1 `published_at`, Filterformat, Anbieterprofil.
- Glossar, CHANGELOG mit Lücken (Karte M6, Kontakt M7, iOS I2 übernimmt Filterformat und RPC).

## 7. Neue Abhängigkeiten
- Keine. Sitemap, robots und Metadaten bringt Next mit. Preisformat über `Intl`, JSON-LD von Hand.

## 8. Offene Fragen an den Architekten
1. Statuscodes 404/410 für Detail und Profil im Proxy per Anon-RPC (4.6), oder Soft 404 in der Seite?
2. Foto-Route mit Anon-Client und 5 min Cache (4.3) statt signierter URLs oder öffentlichem Bucket?
3. Profil-Anzeigen als eigene RPC statt `owner` im Filterformat (3.4)? Profil privater Anbieter indexierbar? „Dabei seit“ öffentlich (heute nicht in `public_profiles`)?
4. JSON-LD am Detail: ohne `Product`/`Offer`? CSP: braucht `application/ld+json` unter der festen CSP etwas?
5. Volltext mit drei verknüpften Konfigurationen performant genug, oder zusätzlich `simple`-Vektor für alle?
6. `listing_public_state` für pausierte Anzeigen als `expired`: Verrät „pausiert“ zu viel?
7. Cache-Dauer 5 min für Suche und Detail ausreichend, wenn Entfernen durch die Moderation (M9) sofort wirken soll (`updateTag` deckt den eigenen Server ab, nicht einen CDN-Cache)?

## 9. Commits (je grün)
1. Plan, ADR 015 (Entwurf), SPEC v0.7, Glossar (URL-Wörter)
2. Migration `published_at`, Slug-Indizes, Favoriten-Limit; pgTAP
3. Migration `search_listings`, Filterprüfung, Fixture; pgTAP
4. Migration `listing_public_state`, Profil-RPC; pgTAP; Meta-Allowlist; Typen; Integration
5. Web: Wörter und Routen, Filter ↔ URL, `safeNextPath`, Sprachumschalter, Vitest
6. Web: Foto-Route, Service-Schicht, Cache-Tags und Invalidierung in bestehenden Actions
7. Web: Startseite
8. Web: Kategorie-, Regions- und Suchseiten mit Filtern
9. Web: Detail mit Zuständen und Statuscodes
10. Web: Anbieterprofil
11. Web: Favoriten
12. Web: Metadaten, hreflang, JSON-LD, Sitemap, robots
13. E2E
14. CHANGELOG, ADR 015 final, QA-Hinweise

## 10. Architekt-Review

Stand: 2026-10-31. Geprüft gegen CLAUDE.md, SPEC v0.6 (3, 4.2, 4.3, 6, 8), ADR 003, 006, 010, 011, 012, 013, 014, die Migrationen `listings`, `favorites_saved_searches`, `storage`, `profiles_privacy`, `listing_photo_processing`, `listing_places`, `moderation_fields`, `regions_species`, den Meta-Test `00_meta.test.sql` sowie `web/proxy.ts`, `web/lib/auth/paths.ts`, `web/lib/security/csp.ts`, `web/next.config.ts`, `web/app/[locale]/layout.tsx`, `web/lib/services/*.ts`, `web/i18n/*`, `web/components/LocaleSwitcher.tsx`. Aussagen zu Next belegt mit der lokalen Doku unter `web/node_modules/next/dist/docs/01-app/` (Pfade unten verkürzt).

**Ergebnis: Freigabe unter Auflagen.** Mit der Umsetzung darf begonnen werden, sobald B1 bis B3 in Plan und ADR 015 eingearbeitet sind (Commit 1). Die A-Auflagen sind Teil der Definition of Done von M5.

### 10.1 Antworten auf die offenen Fragen (Abschnitt 8)
1. **Statuscodes im Proxy, ja.** `02-guides/streaming.md`, „The HTTP contract“: Nach dem ersten Chunk ist `200` gesendet; ein `notFound()` mitten im Stream setzt nur `<meta name="robots" content="noindex">`, Proxy und Redirects laufen vor dem Rendern und können den Status noch setzen. Zusätzlich gibt es unter `cacheComponents` kein `dynamicParams` (`route-segment-config/dynamicParams.md`). Deshalb kommt auch der 404 für unbekannte Wörter und Slugs nur aus dem Proxy, nicht nur der für Detail und Profil (B2). Bedingungen in A3. Ein Soft 404 in der Seite bleibt nur der Rückfall, wenn die Prüfung im Proxy scheitert.
2. **Foto-Route mit Anon-Client, ja** (Bedingungen A5). Signierte URLs scheiden aus: Sie verfallen in gecachten Seiten, und in `use cache` gehören sie nach ADR 014 A10 ohnehin nicht. Einen öffentlichen Bucket lehnt der Plan zu Recht ab.
3. **Eigene RPC `provider_listings`, ja.** Privatpersonen: `noindex` und nicht in der Sitemap. Gewerbe: indexierbar. **„Dabei seit“ entfällt.** Das Feld steht nicht in der Liste der öffentlichen Felder (SPEC 3.4), bringt für eine Kontaktaufnahme nichts und verrät das Alter des Kontos. Dafür bräuchte es eine SPEC-Änderung und eine Entscheidung des Nutzers.
4. **Ohne `Product`/`Offer`, ja.** Auch kein `Event` für Gesellschaftsjagden: Event-Rich-Results verlangen einen Ort, und den geben wir bewusst nicht heraus. Das Detail bekommt nur `BreadcrumbList`. **CSP:** `script-src` regelt die Ausführung. Ein `<script type="application/ld+json">` ist ein Datenblock, den der Browser nie ausführt. Er braucht weder Nonce noch `'unsafe-inline'`, auch nicht unter einer späteren Nonce-CSP (M10). `02-guides/json-ld.md` empfiehlt nur, `<` zu ersetzen; der Plan geht zu Recht weiter. Die Ausgabe läuft nur über eine Funktion (z. B. `jsonLdScript()`) mit Vitest.
5. **Ausreichend ohne zusätzlichen Vektor**, wenn die drei Anfragen zu **einem** tsquery verknüpft werden (`websearch_to_tsquery('german', q) || …('english', q) || …('simple', q)`) und genau ein `search_vector @@ query` den GIN-Index nutzt, statt drei `@@` mit `or`. Grenzen in A2. Bekannte Schwächen stehen in H2.
6. **Ja, „pausiert“ verrät zu viel, „entfernt“ ebenso.** Es gibt nach außen nur einen Zustand (A4).
7. **Für M5 ausreichend, unter B3.** Ein CDN cacht das HTML gar nicht: Die öffentlichen Seiten haben persönliche Inseln (AuthNav, Merken), sind also dynamisch, und Next sendet dann `private, no-cache, no-store, max-age=0, must-revalidate` (`02-guides/cdn-caching.md`, `02-guides/self-hosting.md`). Im CDN landet nur die Foto-Route (`s-maxage`). `updateTag` geht nur in Server Actions (`04-functions/updateTag.md`) und wirkt nur auf den Cache der eigenen Instanz. Der Standard-Cache liegt im Speicher und wird nicht geteilt; bei mehreren Instanzen braucht es einen Cache-Handler mit `refreshTags()` (`02-guides/self-hosting.md`, „Multi-Instance Cache Coordination“). Für M9 heißt das: Das Detail ist über den Proxy sofort weg (B3, A3), Listen und Fotos nach höchstens 5 min. Reicht das für DSA-Fälle nicht, kommt in M9/M10 ein CDN-Purge dazu (in ADR 015 festhalten).

### 10.2 Blockierend
- **B1 Die Sichtbarkeit in den RPCs hängt nicht an der RLS allein.**
  - Für `authenticated` gelten neben `listings_select_public` auch `listings_select_own` und `listings_select_admin`, und die Policies werden mit ODER verknüpft. Die Zusatzbedingung im Plan (`status = 'active' and expires_at > now()`) enthält `private.is_active_user(owner_id)` nicht. Folgen:
    - Ein Admin mit aal2 (z. B. in iOS) sieht aktive Anzeigen gesperrter Konten in der Suche.
    - Ein gesperrter Besitzer sieht seine eigenen.
    - Unter `service_role` (M8, Abgleich der Suchaufträge in einer Edge Function) gilt gar keine RLS.
  - Der Thumbnail-Subselect liest `listing_photos`. Dessen Policy zeigt dem Besitzer auch unverarbeitete eigene Fotos (`processed_at is not null or owner`), deshalb gehört `processed_at is not null` ausdrücklich in die Abfrage.
  - **Lösung:** eine einzige Definition `private.listing_is_public(status, expires_at, owner_id)` (SQL, `stable`). Sie gilt in `listings_select_public` (Policy neu anlegen), in `public_profiles`, `search_listings`, `provider_listings`, `public_page_state` (A3), im Regionszähler (A7) und in der Sitemap. Sie kommt auf die private Allowlist in `00_meta`.
  - pgTAP: Dieselben Filter liefern für anon, einen fremden Nutzer, den Besitzer (mit eigenem Entwurf, eigener Prüfung und gesperrtem Konto), einen Admin mit aal2 und `service_role` dieselbe Menge. Anzeigen gesperrter oder gelöschter Besitzer fehlen überall. Ein unverarbeitetes Foto ist nie Thumbnail.
- **B2 Ein Pfad-Parser für alle öffentlichen URLs.**
  - Der Vorschlag aus 4.1 („die Seite liefert die Zielpfade an `LocaleSwitcher`“) geht nicht. Der Umschalter steckt im Root-Layout (`app/[locale]/layout.tsx`), und eine Seite kann einem Layout keine Props geben. Heute baut er `href={pathname}` mit der Ziel-Locale, also `/en/jagdpacht/bayern`. Das ergäbe auf jeder übersetzten Seite einen 404.
  - Ohne `dynamicParams` kommt der 404 nur aus dem Proxy. Das betrifft unbekannte Wörter, Wörter einer anderen Sprache, unbekannte Slugs und überzählige oder falsche Segmente (`/de/suche/x`, `/de/anzeige/kein-uuid`). Die Formen `{kind}/{state}`, `{detail}/{id}` und `{provider}/{id}` landen alle in derselben Route `[section]/[a]`.
  - Deshalb gibt es eine reine Funktion in `lib/public/paths.ts`: `parsePublicPath(pathname)` liefert `{ locale, route: home | kind | state | district | search | detail | provider, params }` oder `null`, `publicPath(route, params, locale)` baut den Pfad. Sie nutzen:
    - der Proxy (404 und Status)
    - die Seiten (Verteilung im `[section]`-Baum)
    - `LocaleSwitcher` (Client: aus `usePathname()`, bei der Suche mit Query)
    - `localeAlternates`
    - die Sitemap
    - `safeNextPath` (A9)
  - Vitest:
    - Roundtrip je Sprache; Fremdsprachwort ergibt `null`
    - UUID nur in Kleinbuchstaben (Großschreibung: 308 auf die kleine Form oder 404, festlegen)
    - keine Kollision mit den Ordnern unter `app/[locale]`, aus dem Dateisystem gelesen statt von Hand gepflegt (M9 bringt neue statische Seiten)
    - keine Kollision mit `PROTECTED_SECTIONS` und den Locale-Codes
  - **Regions-Slugs im Proxy:** entweder aus einer generierten Datei (gleiche Quelle wie `regions_data.sql`, ein Test gleicht sie mit der DB ab) oder per Modul-Memo mit TTL. Entscheidung in ADR 015. Kein DB-Aufruf je Kategorieseite.
  - **Nicht kanonische Kodierung öffentlicher Pfade** (`/de/%61nzeige/…`): 308 auf die kanonische Form, wie heute für geschützte Pfade. Sonst entstehen doppelte URLs, und der Parser entscheidet über eine andere Form als die, die next-intl rendert.
- **B3 Die Cache-Lebensdauer ist die einzige Garantie für alle Instanzen.**
  - „`cacheLife` kurz, z. B. 5 min“ ist mehrdeutig. Das Preset `minutes` hat `expire` 1 h (`04-functions/cacheLife.md`). Innerhalb dieser Zeit wird nach `revalidate` noch einmal veralteter Inhalt ausgeliefert (stale-while-revalidate). Eine entfernte Anzeige stünde dann bis zu 1 h in Listen.
  - Viele Änderungen laufen nicht durch eine Server Action, dort greifen die Tags nicht:
    - Fotos (der Browser schreibt direkt, `photo-upload.ts`)
    - Ablauf über die Zeit
    - iOS (I4)
    - Sperren und Löschen (M9)
    - Edge Functions
  - **Verbindlich:**
    - Eigenes Profil `publicListings` in `next.config.ts` mit `stale` 60, `revalidate` 60 und `expire` 300 für alle Daten mit Anzeigeninhalt (Listen, Detail, Profil, Zähler). `expire` unter 300 würde den Eintrag aus dem Prerender nehmen (`cacheLife.md`, „Prerendering behavior“); 300 ist zulässig.
    - Die Sitemap darf `hours` nutzen, weil jede gelistete URL beim Aufruf selbst geprüft wird.
    - Detail und Profil prüft der Proxy ungecacht (A3). Für Dokumentaufrufe wirkt Entfernen damit sofort, unabhängig vom Datencache.
    - Tags `listings`, `listing:{id}` und `provider:{id}` per `updateTag` in allen Server Actions, die Status oder Inhalt ändern: Moderation, Absenden, Pausieren, Fortsetzen, Löschen, Bearbeiten, Ort, Wildarten, Alt-Text, Reihenfolge. Das ist eine Beschleunigung, keine Garantie. Kein einargumentiges `revalidateTag` (`04-functions/revalidateTag.md`: veraltet).
    - Nichts Personenbezogenes und keine signierten URLs in `use cache`.
  - E2E: Die Dokumentantwort von Start, Kategorie, Detail und Profil trägt `Cache-Control` mit `private`/`no-store`. Eine anonym gerenderte Seite enthält nach einem Login in einem anderen Kontext keinen Session-Inhalt.

### 10.3 Auflagen
- **A1 Such-Vertrag präzisieren** (ADR 015, Fixture, gilt unverändert für iOS I2 und M8):
  - `v: 1` ist Pflicht im Filterobjekt. M8 speichert es in `saved_searches.filters` und kann später migrieren. Für M8 vormerken: Check-Constraint auf `saved_searches.filters` über `private.search_filters_error`.
  - Null-Semantik je Filter festlegen und testen: Anzeige ohne Zeitraum bei gesetztem `date_*`, ohne Fläche bei `area_*`, ohne Wildart bei `species`, Gesellschaftsjagd ohne `event_date`.
  - `region` muss zu `country` passen, und ein unbekannter Code ergibt `22023`, kein leeres Ergebnis (iOS soll Fehler sehen; das Web verwirft ungültige Werte vorher).
  - Preis: Der Filter verlangt `currency`. Die Preis-Sortierung verlangt zusätzlich `price_unit`, sonst steht „5.000 € gesamt“ zwischen „50 € je Tag“-Anzeigen.
  - Standard-Sortierung festlegen (Empfehlung: `newest`, auch mit `q`). Letzter Sortierschlüssel ist immer `id`.
  - Cursor:
    - Er enthält die Sortierung und einen Hash der Filter. Passt er nicht, gibt es `22023`.
    - Typen werden geprüft, Länge höchstens 200.
    - Bei `relevance` steht der Rang als `float8`-Text im Cursor (seit PG 12 verlustfrei).
  - Grenzen:
    - Filter-JSON höchstens 4 KB (wie `saved_searches`)
    - `species` höchstens 20 bekannte Codes ohne Doppelte
    - `q` getrimmt und NFC
    - `price_*` und `area_*` ab 0, mit Obergrenze, `min ≤ max`; `date_from ≤ date_to`
    - `p_limit` von 1 bis 50, sonst `22023`
  - Rückgabe zusätzlich:
    - `photo_id` und die Maße des Thumbnails (Web-Route) neben `thumb_path` (iOS über die Storage-API)
    - `account_type` und `business_name` (das Badge zeigt bei Gewerbe den Firmennamen)
    - Keine `display_location` vor M6.
  - Fehler als Tabelle in ADR 015: `22023` mit `hint` = Schlüssel, analog zu `fields` in ADR 013, damit iOS lokalisiert.
- **A2 Missbrauch der Such-RPC begrenzen** (anon ruft sie direkt per PostgREST auf):
  - Die Gesamtzahl kommt aus `count(*) from (… limit 1001)`, nicht aus einem vollen `count`.
  - `numnode()` des verknüpften tsquery höchstens 32, sonst `22023`.
  - Der Filter auf `event_date` (Cast aus jsonb, kein Index) greift nur zusammen mit `kind = 'driven_hunt'`.
  - Statement-Timeout der Rolle `anon` in die Cloud-Checkliste. Ein `SET` in der Funktion wirkt nicht auf die laufende Anweisung.
  - `explain (analyze)` im CHANGELOG mit etwa 10.000 synthetischen Anzeigen (Seed im Testcode), nicht mit zehn Zeilen. Fälle:
    - neueste ohne Filter
    - Art und Land
    - Bundesland
    - Volltext
    - Preis mit Währung
    - Wildart
  - Web: Ergebnisse mit `q` oder freien Filtern nicht in `use cache`. Beliebig viele Schlüssel verdrängen sonst den Speicher-Cache. Gecacht werden Start, Kategorie- und Regionsseiten ohne Query, Detail, Profil und Zähler.
  - Rate-Limit oder WAF für Suche und Foto-Route in die Checkliste von M10.
- **A3 Statusprüfung im Proxy:**
  - Eine Definer-RPC `public.public_page_state(p_kind text, p_id uuid) returns text` liefert nur `public`, `gone` oder `null`. Sie ersetzt `listing_public_state`, die Seite nutzt sie ebenfalls. Allowlist.
  - Sie gilt nur für Dokumentanfragen. Prefetch- und RSC-Anfragen (`next-router-prefetch`, `rsc`) gehen ohne DB-Aufruf durch, sonst löst jede Liste mit 20 Links (`partialPrefetching`) 20 RPCs aus. Autoritativ bleibt die Seite (Anon-Client, RLS).
  - Vor jedem DB-Aufruf laufen Parser (B2) und UUID-Prüfung; scheitern sie, gibt es sofort 404.
  - Kein Cache im Proxy (Kosten: ein Lookup per Primärschlüssel).
  - Timeout etwa 800 ms (`AbortSignal.timeout`). Bei Fehler geht die Anfrage an die Seite weiter (fail-open, dort Soft 404 mit `noindex`); geloggt wird ohne Inhalte.
  - `gone` → Rewrite mit Status 410 auf eine statische, lokalisierte Seite. `null` → 404. Beide mit `X-Robots-Tag: noindex`. Session-Cookies laufen weiter über `session.apply`.
  - E2E prüft den Status der Dokumentantwort:
    - Entwurf, Prüfung, abgelehnt (nie veröffentlicht): 404
    - pausiert, abgelaufen, entfernt: 410
    - unbekanntes Wort oder Slug, Wort einer anderen Sprache, `/de/suche/x`: 404
    - öffentliche Anzeige: 200
- **A4 Nach außen nur ein Zustand `gone`.**
  - `gone` gilt, wenn `published_at is not null` und die Anzeige nicht öffentlich ist (B1). Das umfasst jeden Status, auch die erneute Prüfung nach einer Bearbeitung, außerdem Ablauf per Zeit oder Status, Entfernen und gesperrte oder gelöschte Besitzer. Sonst `null`.
  - Ein Text („nicht mehr verfügbar“), Status 410, `noindex`, keine Inhalte.
  - Kein öffentliches „entfernt“. Der Hinweis auf eine Moderationsentscheidung wäre eine öffentliche Bewertung des Anbieters, zurechenbar über die Profil-URL. Den Grund erfährt nur der Besitzer im Konto (DSA Art. 17). SPEC 4.3 („abgelaufene/entfernte Anzeige“) ist damit erfüllt.
  - Der Zustand verrät nur, dass die ID einmal öffentlich war. Das war sie.
- **A5 Foto-Route:**
  - `id` (UUID) und `variant` vor jedem Aufruf prüfen. Dann `listing_photos` per Anon-Client nach `id` lesen (RLS) und aus `listing-photos` herunterladen (Storage-RLS), `processed_at is not null` ausdrücklich prüfen.
  - Den Inhalt streamen statt puffern. Header: `Content-Length`, `Content-Type: image/jpeg`, `nosniff`, `Content-Disposition: inline`.
  - Cache-Header:
    - 200: `public, max-age=300, s-maxage=300`
    - 404: `public, max-age=60` (kein Verstärker für Zufalls-IDs)
    - 5xx: `no-store`
  - Im HTML stehen keine Storage-Pfade (sie enthalten Besitzer- und Anzeigen-ID), nur `/api/photos/{photoId}/…`.
  - `width`/`height` in der Tabelle sind die Maße des großen Bildes. Die Maße des Thumbnails werden über das Seitenverhältnis berechnet (CLS).
  - Open Graph mit absoluter URL der Variante `full`.
  - Tests: Entwurf → 404; entfernte Anzeige → 404 (nach `max-age`); unverarbeitetes Foto → 404; falsche Variante → 404 ohne DB-Aufruf.
- **A6 Semantik von `published_at`:**
  - Erste Freigabe, nie zurückgesetzt (`coalesce`). Sonst stünde jede bearbeitete Anzeige nach der erneuten Freigabe wieder oben bei „neueste“, und M8 meldete bei jeder Freigabe erneut „neue Anzeige“. Für `lastModified` der Sitemap und „aktualisiert am“ gibt es eine zweite Spalte `approved_at` (jede Freigabe) mit denselben Regeln. Sollen Verlängerungen als neu gelten, ist das eine Nutzerentscheidung samt Regel gegen das Hochschieben.
  - Beide setzt ein BEFORE-Trigger auf allen Pfaden, wie `listings_moderation_fields`, nicht der Guard (der überspringt Server-Pfade).
  - Nach dem Backfill gilt ein Check: `status <> 'active' or published_at is not null`.
  - Backfill auch für `paused`, `expired` und `removed` mit `expires_at is not null`. Die waren einmal öffentlich und ergäben sonst 404 statt 410.
  - Beide Spalten in die Ausschlussliste von `private.listing_content_hash`, sonst sind alle pausierten Anzeigen nach der Migration nicht mehr fortsetzbar (wie M4 A6). Meta-Test.
- **A7 Kategorie- und Regionsseiten, SEO-Signale:**
  - Die Zähler je Region liefert eine Aggregat-RPC (z. B. `listing_region_counts(p_kind)`, gecacht, Allowlist) statt N Suchaufrufen. Sie ist zugleich die Quelle für „leer → `noindex`“ und für die Sitemap.
  - Links nur auf Regionen mit Anzeigen. Sonst entstehen rund 5 Arten × 500 Kreise × 4 Sprachen leere, crawlbare Seiten.
  - Seiten mit Query (Filter oder Cursor) und die Suche: `noindex, follow`, **kein** Canonical auf eine andere URL und keine hreflang-Liste (widersprüchliche Signale). Die Planpunkte „Canonical ohne Query“ und „Canonical auf die Suche ohne Parameter“ gelten deshalb nur für Seiten ohne Query.
  - Seiten ohne Query: Canonical auf sich selbst, hreflang auf die vier übersetzten Pfade aus dem Parser und `x-default`. hreflang nur zwischen indexierbaren Seiten.
  - Titel und H1 ohne Kasusbildung. `name_cs`/`name_pl` stehen im Nominativ, „v Bavorsku“ lässt sich daraus nicht bilden. Also z. B. „Pronájem honitby – Bavorsko“.
- **A8 Sitemap und robots:**
  - `app/sitemap.ts` mit `generateSitemaps` liefert `/sitemap/{id}.xml` (`04-functions/generate-sitemaps.md`). Der Proxy-Matcher nimmt nur `sitemap\.xml$` aus, `/sitemap/de.xml` liefe also in next-intl, würde auf `/de/sitemap/de.xml` umgeleitet und ergäbe 404. Matcher um `sitemap/` erweitern, Test dazu, ADR 003 nachziehen.
  - Die Doku nennt keinen automatisch erzeugten Sitemap-Index. `robots.ts` nennt deshalb alle vier Dateien mit absoluter URL.
  - Die Sitemap entsteht zur Anfrage (`use cache`, Tag `listings`, Profil `hours`). Kein DB-Zugriff beim Build.
  - Absolute URLs aus `NEXT_PUBLIC_SITE_URL`, `alternates.languages` aus dem Parser.
  - Es fehlen private Profile, leere Regionsseiten, Suche, Konto und Admin. Test: Die Sitemap enthält keine ID einer nicht öffentlichen Anzeige.
  - **Stage und Previews:** `robots.ts` mit `Disallow: /` und global `X-Robots-Tag: noindex`, gesteuert über eine Server-Variable der Umgebung, nicht über den Host-Header. Indexierbar ist nur Prod (ADR 002).
- **A9 `safeNextPath` und Merken:**
  - Öffentliche Ziele prüft der Parser (B2), keine zweite Regex. Die kanonische Form muss dem Eingang gleichen. `PROTECTED_SECTIONS` bleibt unverändert, sonst erzwingt der Proxy einen Login für öffentliche Seiten.
  - Query nur für die Suche, neu serialisiert aus den geparsten Filtern (unbekannte Parameter fallen weg). Ohne `q` (H10). Gesamtlänge höchstens 512.
  - **Kein Merken per GET-Parameter nach dem Login.** Prefetch und fremde Links lösten sonst eine Zustandsänderung aus. Nach dem Login geht es zurück zur Anzeige, gemerkt wird per POST. Den E2E entsprechend ändern: „Login → zurück zur Anzeige → Merken → gemerkt“.
  - Vitest:
    - `//`, `/\` und `%2f`
    - Wörter einer anderen Sprache, Großschreibung
    - `/{l}/anzeige/{uuid}/../account`
    - verschachteltes `next`, überlange Query
- **A10 Favoriten:**
  - Nicht mehr verfügbare Favoriten müssen sich entfernen lassen („n nicht mehr verfügbar – entfernen“, ohne Titel). Sonst belegen sie das Limit von 500 dauerhaft. Nicht automatisch löschen, denn eine Anzeige kann nach der Prüfung zurückkommen.
  - Limit-Trigger mit `pg_advisory_xact_lock` je Nutzer (parallele Inserts). Fehlercode einheitlich mit `saved_searches` (heute `23514`) oder beide auf einen neuen Code, im Vertrag festhalten.
  - Die Merken-Insel hat eine feste Größe (keine Layoutverschiebung). Der Button trägt `aria-pressed`. Auf der eigenen Anzeige erscheinen weder Merken noch Kontakt.
- **A11 Öffentliche Service-Schicht:**
  - `search.ts` und `public-*.ts` nutzen nur den Anon-Client ohne Cookies und feste Spaltenlisten bzw. DTOs: kein `select('*')`, nie `listing_places`, keine `display_location` vor M6.
  - Ein Vitest oder eine Lint-Regel stellt sicher, dass diese Module `lib/supabase/server` nicht importieren.
  - Die Beschreibung wird als Text gerendert (`whitespace-pre-line`), ohne Autolinks. Kommen später Links, dann mit `rel="ugc nofollow"`.
- **A12 Barrierefreiheit** (im Plan fehlt ein Abschnitt):
  - Filterformular:
    - `fieldset`/`legend` und Labels
    - Hinweis zur Währung per `aria-describedby`
    - Trefferzahl in `aria-live="polite"`
    - „Weitere laden“ setzt mit JS den Fokus auf den ersten neuen Treffer
  - Galerie: Thumbnails als Links mit Alt-Text und sichtbarem Fokus.
  - „verifiziert“ steht als Text, nicht nur als Icon. Preis und Einheit sind ein zusammenhängender Text.
  - Brotkrumen als `nav` mit `aria-label` und `aria-current="page"`.
  - Sprachumschalter behält `lang` und `hrefLang`.
  - Die Seite „nicht mehr verfügbar“ hat eine H1 und einen Link zur Suche.
  - Prüfung im E2E mit axe auf Start, Kategorie, Suche, Detail, Profil und Favoriten. Ist axe noch keine Abhängigkeit, Aufnahme begründen (CLAUDE.md).
- **A13 Preisformat:**
  - Nur serverseitig formatieren (Server Components), sonst weichen Node-ICU und Browser bei der Hydration ab.
  - Tests mit normalisierten Leerzeichen (U+00A0, U+202F) oder gegen `Intl` derselben Laufzeit.
  - Testfälle als Matrix Locale × Währung (EUR, CHF, CZK, PLN). Das Planbeispiel „pl `1234 zł`“ ist PLN; gefordert ist auch EUR in pl und CZK in de (ADR 003).
- **A14 Commit-Reihenfolge** (je grün):
  1. Plan, ADR 015 (Parser, Filter v1, Zustand `gone`, Cache-Profil, Statuscodes), SPEC v0.7, Glossar
  2. Migration `published_at`/`approved_at` mit Trigger, Check, Backfill und Hash-Ausschluss (A6), Slug-Index, Favoriten-Limit; pgTAP; Meta-Test
  3. Migration `listing_is_public` (Policy, View, B1), `search_listings`, Filterprüfung, Fixture, Regionszähler. **Die public- und private-Allowlist kommen im selben Commit**, sonst ist `00_meta` rot (`search_filters_error` und `listing_is_public` braucht anon). pgTAP
  4. Migration `public_page_state`, `provider_listings`; Allowlist; Typen; Integration
  5. Web: Parser, Proxy (404 für Unbekanntes, 308 auf die kanonische Form, Matcher `sitemap/`), `safeNextPath`, `LocaleSwitcher`, `localeAlternates`; Vitest
  6. Web: Cache-Profil, Foto-Route, Service-Schicht, Tags in den Actions
  7. bis 11. wie geplant; Statusprüfung im Proxy für Detail in 9, für Profil in 10
  12. Web: Metadaten, JSON-LD, Sitemap, robots (mit Sperre für Stage)
  13. E2E mit Status-, Header- und axe-Prüfungen
  14. CHANGELOG, ADR 015 final, ADR 003 nachgezogen, QA-Hinweise
- **A15 Doku:**
  - ADR 015: Parser und URL-Wörter, Filter v1 mit Fehlertabelle, `listing_is_public`, Zustand `gone` und Statuscodes, Cache-Profil und die Grenzen der Invalidierung (Instanz-lokal, CDN nur Fotos), Foto-Route, JSON-LD und CSP, Sitemap und robots je Umgebung.
  - ADR 003: Folgen-Satz („wird dort entschieden“) ersetzen, Matcher.
  - SPEC: 3.1 (`published_at`, `approved_at`) und 4.3 (Profilfelder ohne „dabei seit“).
  - CHANGELOG mit Lücken: iOS I2 nutzt `search_listings` und lädt Fotos über die Storage-API mit Anon-Key; Karte M6; Kontakt M7.

### 10.4 Hinweise
- **H1** Die Sitelinks-Suchbox zeigt Google seit Ende 2024 nicht mehr. `WebSite` mit `SearchAction` schadet nicht, bringt aber nichts.
- **H2 Volltext:** Komposita werden nicht zerlegt („Reh“ findet „Rehwild“ nicht), und cs/pl werden ohne Diakritika-Faltung durchsucht. Der Wildartenfilter deckt den häufigsten Fall. Später `unaccent` oder `pg_trgm` für Titel bewerten.
- **H3** Das Detail hat denselben Inhalt unter vier URLs mit übersetzter Oberfläche. hreflang ist dafür richtig, Google wählt trotzdem eventuell eine Fassung. Erwägen, `x-default` beim Detail auf die Inhaltssprache statt auf `de` zu setzen.
- **H4 Slugs sind ein URL-Vertrag.** Umbenennungen (Gebietsreformen) brauchen eine Redirect-Tabelle. Regionscodes in Suchaufträgen (M8) betrifft das ebenso.
- **H5** „Bundesland-Slug global eindeutig“ hält bis CZ/PL/CH. Vor deren Import prüfen, sonst braucht die URL einen Länderteil. Der Index `(parent_id, slug)` folgt schon aus `(country, level, slug)`, schadet aber nicht.
- **H6** Für HTML-limited Bots blockieren die Metadaten, für Googlebot stehen sie im Body (`04-functions/generate-metadata.md`, „Streaming metadata“). `X-Robots-Tag` aus Proxy oder Header ist deshalb die verlässliche Quelle für `noindex` bei der Suche und bei Status ungleich 200.
- **H7** Die Anbieter-URL enthält die `user_id`. Die ist schon über `public_profiles` öffentlich und stabil. Ein späterer Wechsel auf einen Pseudonym-Slug bräuchte Redirects; wenn überhaupt, ist er jetzt am billigsten.
- **H8** `event_date` als generierte Spalte mit Index, falls Gesellschaftsjagden häufig nach Datum gefiltert werden.
- **H9** Der Hinweis „Nachrichten folgen in Kürze“ ist kein Link auf eine leere Seite und kein Formular.
- **H10** Suchtexte können personenbezogen sein (Namen). `q` nicht in Server-Logs und nicht in `next` (es landet sonst in `redirect_to` und in den Auth-Logs).


## 11. Eingearbeitet (2026-10-31)
- **B1–B3** und die Antworten aus 10.1 stehen verbindlich in ADR 015 (eine Sichtbarkeitsdefinition, ein Pfad-Parser, Cache-Profil `publicListings` mit `expire` 300). Abschnitte 3–9 gelten nur, soweit Abschnitt 10 und ADR 015 nichts anderes sagen. Insbesondere: Zustand nach außen nur `gone` (410) über `public_page_state` statt `listing_public_state`, kein „dabei seit“, Profile von Privatpersonen `noindex`, Detail-JSON-LD nur `BreadcrumbList`.
- **Nutzer-Freigabe 2026-10-31** mit zwei Ergänzungen:
  1. **Sofortige Wirkung** bei Entfernen durch die Moderation, Sperrung und Konto-Löschung, die 5 Minuten gelten nur für normale Änderungen. Umsetzung (ADR 015 „Cache“): Zähler `private.public_cache_epoch`, per Trigger auf allen Pfaden erhöht (`status → removed`, `is_blocked → true`, `deleted_at` gesetzt, Profil gelöscht). Die Seiten lesen ihn je Anfrage ungecacht über `public.public_cache_epoch()` und geben ihn als Argument in jede gecachte Funktion, die Foto-Route revalidiert jeden Abruf (`no-cache` + `ETag`). **Test:** pgTAP (jeder Auslöser erhöht den Zähler, normale Änderungen nicht) und E2E (Liste, Detail und Foto gecacht aufrufen, dann je Fall entfernen/sperren/löschen per Testhelfer, sofort erneut aufrufen: Anzeige fehlt in Start, Kategorie und Suche, Detail 410 bzw. 404, Foto 404).
  2. ADR 015 hält fest, dass pausierte Anzeigen mit 410 antworten und nach dem Fortsetzen langsamer neu indexiert werden können.
- SPEC v0.7 mit zwei neuen Rechtsfragen in 7.2: Anbieterangaben gewerblicher Konten nach DSA, Begründung von Entfernungen zusätzlich per E-Mail.
- **Commit-Reihenfolge** nach A14 (ersetzt Abschnitt 9):
  1. Plan, ADR 015, SPEC v0.7, Glossar, ADR 003
  2. Migration `published_at`/`approved_at` (A6), Slug-Index, Favoriten-Limit; pgTAP; Meta-Test
  3. Migration `listing_is_public` (B1), `search_listings`, Filterprüfung, Fixture, Regionszähler, Allowlists; pgTAP
  4. Migration `public_page_state`, `provider_listings`, Cache-Zähler mit Triggern; Allowlist; Typen; Integration
  5. Web: Parser, Proxy (404, 308, Matcher `sitemap/`), `safeNextPath`, `LocaleSwitcher`, `localeAlternates`; Vitest
  6. Web: Cache-Profil, Cache-Zähler, Foto-Route, Service-Schicht, Tags in den Actions
  7. Web: Startseite
  8. Web: Kategorie-, Regions- und Suchseiten mit Filtern
  9. Web: Detail mit Zuständen und Statusprüfung im Proxy
  10. Web: Anbieterprofil (Statusprüfung im Proxy)
  11. Web: Favoriten
  12. Web: Metadaten, JSON-LD, Sitemap, robots (Sperre außer Prod)
  13. E2E mit Status-, Header-, Sofort-Entfernen- und axe-Prüfungen
  14. CHANGELOG, ADR 015 final, QA-Hinweise
- Nach jedem Commit: Push auf `origin/main` und CI prüfen (Nutzer-Anweisung 2026-10-31).
