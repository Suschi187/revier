# ADR 015: Öffentliche Seiten und Suche

Status: angenommen (M5, Plan `docs/plans/M5-plan.md` mit Architekt-Review, Freigabe durch den Nutzer 2026-10-31)

## Kontext
SPEC 4.2/6 M5: Startseite, Kategorie- und Regionsseiten, Volltextsuche mit Filtern, Anzeigen-Detail, Anbieterprofil, Favoriten, SEO. Nicht freigegebene Anzeigen sind weder abrufbar noch indexierbar. Die Suche gilt später unverändert für Suchaufträge (M8) und iOS (I2). Nutzer-Entscheidungen 2026-10-31: URL-Wörter je Sprache, Regionsseiten für Bundesland und Kreis, Anbieterprofil in M5, sofortige Wirkung von Entfernen, Sperren und Löschen.

Rahmen aus Next 16 mit `cacheComponents` (Belege unter `web/node_modules/next/dist/docs/01-app/`):
- Der Status steht nach dem ersten Chunk fest (`02-guides/streaming.md`). `notFound()` in der Seite setzt nur noch `noindex`.
- Es gibt kein `dynamicParams` (`route-segment-config/dynamicParams.md`).
- `updateTag` geht nur in Server Actions und wirkt auf den Cache der eigenen Instanz (`04-functions/updateTag.md`, `02-guides/self-hosting.md`).

## Entscheidung

### Sichtbarkeit: eine Definition
- `private.listing_is_public(status, expires_at, owner_id)`: `status = 'active' and expires_at > now() and private.is_active_user(owner_id)`.
- Sie gilt in der Policy `listings_select_public`, in `public_profiles`, `search_listings`, `provider_listings`, `public_page_state`, im Regionszähler und in der Sitemap.
- Die RPCs verlassen sich **nicht** auf die RLS. Für eingeloggte Nutzer greifen per ODER auch die Besitzer- und Admin-Policies, und unter `service_role` (M8) gilt gar keine RLS.
- Thumbnails nur aus Fotos mit `processed_at is not null`.

### URLs und Pfad-Parser
- Wörter je Sprache in `web/lib/public/sections.ts`, Liste im Glossar („URL-Wörter“, cs/pl ungeprüft).
- Formen:
  - `/{l}/{kind}`, `/{l}/{kind}/{state}`, `/{l}/{kind}/{state}/{district}`
  - `/{l}/{search}`
  - `/{l}/{detail}/{uuid}`
  - `/{l}/{provider}/{uuid}`
- Regions-Slugs sind sprachunabhängig. Bundesland-Slugs sind über alle Länder eindeutig, Kreis-Slugs je Bundesland. Vor dem Import von CZ/PL/CH erneut prüfen.
- **Ein Parser** `parsePublicPath`/`publicPath` (`web/lib/public/paths.ts`) für Proxy, Seiten, Sprachumschalter, hreflang, Sitemap und `safeNextPath`.
  - Der Sprachumschalter im Layout leitet den Zielpfad selbst aus dem Pfad ab.
  - Ein Wort einer anderen Sprache, ein unbekannter Slug, überzählige Segmente und eine UUID in Großbuchstaben ergeben 404.
  - Eine nicht kanonische Kodierung ergibt 308 auf die kanonische Form.
- Die Regions-Slugs kennt der Proxy aus einer generierten Datei (`web/lib/public/region-slugs.json`). Quelle sind dieselben Daten wie `regions_data.sql`, ein Test gleicht beides mit der DB ab. Kein DB-Aufruf je Kategorieseite.
- Statische Ordner unter `app/[locale]` gehen vor. Ein Test liest sie aus dem Dateisystem und schließt Kollisionen mit Wörtern, Locales und `PROTECTED_SECTIONS` aus.

### Such-RPC und Filterformat v1
`public.search_listings(p_filters jsonb, p_cursor text default null, p_limit int default 20)`, `security invoker`, `stable`.

**Filter**
- `v: 1` ist Pflicht. Unbekannte Schlüssel ergeben einen Fehler.
- Geprüft wird in der DB mit `private.search_filters_error()` und im Web mit Zod. Die gemeinsamen Fälle stehen in `supabase/tests/fixtures/search_filters.json`.
- Grenzen:
  - JSON höchstens 4 KB
  - `species` höchstens 20 bekannte Codes ohne Doppelte
  - `q` 1–200 Zeichen, getrimmt, NFC, tsquery höchstens 32 Knoten
  - Zahlen ab 0 mit Obergrenze, `min ≤ max`, `date_from ≤ date_to`
  - `p_limit` 1–50

| Schlüssel | Bedeutung | Ohne Wert in der Anzeige |
|---|---|---|
| `q` | Volltext: ein tsquery aus `german`, `english` und `simple`, mit ODER verknüpft | – |
| `country` | Land | – |
| `region` | Code eines Bundeslands (inklusive Kreise) oder Kreises; muss zu `country` passen, falls gesetzt | – |
| `kind`, `direction` | Art, Angebot/Gesuch | – |
| `species[]` | mindestens eine Wildart trifft | fällt heraus |
| `currency` | Pflicht bei `price_*` und Preis-Sortierung | – |
| `price_min`, `price_max` | kleinste Einheit, nur Anzeigen in `currency`; keine Umrechnung | fällt heraus (auch „auf Anfrage“) |
| `price_unit` | Preiseinheit; Pflicht bei Preis-Sortierung | – |
| `area_min`, `area_max` | Hektar | fällt heraus |
| `date_from`, `date_to` | Überschneidung mit `start_date`/`end_date`, offene Enden zählen als offen; `event_date` nur mit `kind = driven_hunt` | ohne jedes Datum: fällt heraus |
| `verified_only` | nur verifizierte Anbieter | – |
| `sort` | `newest` (Standard, auch mit `q`), `price_asc`, `price_desc`, `relevance` (nur mit `q`); letzter Schlüssel immer `id` | – |

**Cursor**
- Opak, base64. Er enthält Sortierung, Hash der Filter und die Schlüssel (Rang als `float8`-Text) und ist höchstens 200 Zeichen lang.
- Passt der Cursor nicht zu Sortierung oder Filtern, gibt es einen Fehler.

**Rückgabe**
- Je Treffer:
  - id, kind, direction, title, content_language, country, Kreis- und Bundesland-Code, `postal_prefix`
  - Preisfelder, `area_hectares`, Daten, `published_at`
  - erstes verarbeitetes Foto (`photo_id`, `thumb_path`, Maße)
  - Anbieter (`owner_id`, Anzeigename, `account_type`, `business_name`, `verified`)
- Keine PLZ, kein Ort, keine `display_location` (erst M6).
- Gesamtzahl höchstens 1001, angezeigt als „1000+“.

**Fehler**

| Code | `hint` | Bedeutung |
|---|---|---|
| `22023` | Schlüssel (`q`, `region`, `price_min`, `cursor`, `limit`, `v`, …) | ungültiger oder unbekannter Wert, fehlende Abhängigkeit (`currency`, `price_unit`), unpassender Cursor |

`provider_listings(p_owner uuid, p_cursor text, p_limit int)` liefert dieselbe Rückgabe, sortiert nach `newest`. Sie ist bewusst kein Filter: Suchaufträge auf Personen soll es nicht geben.

### Veröffentlichung: `published_at` und `approved_at`
- `published_at` wird bei der ersten Freigabe gesetzt und nie zurückgesetzt. Damit sortiert „neueste“, und M8 meldet nur echte neue Anzeigen.
- `approved_at` wird bei jeder Freigabe gesetzt. Es dient der Sitemap (`lastModified`).
- Beide setzt ein Trigger auf allen Pfaden. Sie haben keinen GRANT und gehören nicht zum Inhalts-Hash.
- Check: `status <> 'active' or published_at is not null`.

### Zustand nach außen und Statuscodes
- `public.public_page_state(p_kind text, p_id uuid)` (Definer) liefert `public`, `gone` oder `null`.
  - `gone`: einmal veröffentlicht (`published_at`), jetzt nicht öffentlich. Ein Grund wird nicht unterschieden: abgelaufen, pausiert, wieder in der Prüfung, entfernt, Besitzer gesperrt oder gelöscht.
  - Nach außen gibt es **kein** „entfernt“. Den Grund sieht nur der Besitzer im Konto (DSA Art. 17).
  - Entwürfe und nie freigegebene Anzeigen ergeben `null`, also kein Orakel.
- Der Proxy setzt die Statuscodes für Dokumentanfragen. Prefetch- und RSC-Anfragen gehen ohne DB-Aufruf durch.
  - Pfad unbekannt (Parser): 404 ohne DB-Aufruf.
  - Detail und Profil: Die RPC wird ungecacht mit Timeout von 800 ms aufgerufen. `gone` ergibt 410, `null` ergibt 404, beide per Rewrite auf eine statische, lokalisierte Seite mit `X-Robots-Tag: noindex`.
  - Bei einem Fehler geht die Anfrage an die Seite weiter (fail-open). Die Seite prüft selbst mit dem Anon-Client und zeigt dann einen Soft 404 mit `noindex`.
- **Pausierte Anzeigen antworten mit 410.** Das ist bewusst so: Nach außen gibt es nur einen Zustand. Folge: Suchmaschinen entfernen die URL schnell aus dem Index. Nach dem Fortsetzen wird sie langsamer neu indexiert, denn eine 410-URL besucht ein Crawler seltener. Die Sitemap führt die Anzeige nach dem Fortsetzen wieder mit neuem `lastModified`, was die Neuaufnahme beschleunigt.

### Cache
- Öffentliche Daten kommen nur über den Anon-Client ohne Cookies, mit festen Spaltenlisten (keine `listing_places`, kein `select('*')`). Die Module importieren `lib/supabase/server` nicht, ein Test prüft das.
- Profil `publicListings` (`stale` 60, `revalidate` 60, `expire` 300). Es gilt für Start, Kategorie- und Regionsseiten ohne Query, Detail, Profil und Zähler.
  - Die Suche mit `q` oder freien Filtern wird nicht gecacht.
  - Die Sitemap nutzt das Profil `hours`.
- Tags `listings`, `listing:{id}` und `provider:{id}` per `updateTag` in allen Server Actions, die Status oder Inhalt ändern. Das beschleunigt nur die eigene Instanz.
- Für normale Änderungen (Bearbeiten, Pausieren, Ablauf, Fotos aus dem Browser, iOS) gilt deshalb: Listen sind höchstens 5 Minuten alt.
- **Sofortige Wirkung bei Entfernen, Sperren und Löschen (Nutzer-Entscheidung 2026-10-31).**
  - **Zähler:** `private.public_cache_epoch` ist ein einzeiliger Zähler. Trigger erhöhen ihn bei:
    - `listings.status → removed`
    - `profiles.is_blocked → true`
    - `profiles.deleted_at` gesetzt
    - Löschen einer `profiles`-Zeile (Konto-Löschung)
    Auf allen Pfaden, also auch per SQL, Edge Function oder später iOS-Admin.
  - **Seiten:** `public.public_cache_epoch()` (anon, eine Zeile per Primärschlüssel) wird je Anfrage ungecacht gelesen und geht als Argument in jede gecachte Funktion ein. Steigt der Zähler, verfehlt jede Instanz ihren Cache-Schlüssel und liest neu, ohne geteilten Cache-Handler.
  - **Fotos:** Die Foto-Route liefert `Cache-Control: public, no-cache` mit `ETag`. Jeder Abruf prüft die Sichtbarkeit, unverändert gibt es `304` ohne Inhalt. So bleibt auch eine gespeicherte Foto-URL nach dem Entfernen nicht abrufbar.
  - **Detail und Profil:** Sie sind über die Statusprüfung im Proxy ohnehin sofort weg.
  - **Kosten:** eine Abfrage je Seitenaufruf und eine je Foto (304).
  - **Verrät der Zähler etwas?** Nur, dass irgendwo etwas entfernt, gesperrt oder gelöscht wurde, ohne Bezug auf eine Anzeige oder ein Konto.
- Ein CDN cacht kein HTML: Die Seiten haben persönliche Inseln, Next sendet `private, no-store` (`02-guides/cdn-caching.md`).

### Fotos
- Route `GET /api/photos/{photoId}/{thumb|full}`.
  - UUID und Variante werden vor jedem DB-Aufruf geprüft.
  - Die Route liest `listing_photos` per Anon-Client (RLS, `processed_at is not null`), lädt die Datei aus `listing-photos` (Storage-RLS) und streamt sie.
  - Header: `image/jpeg`, `nosniff`, `inline`.
  - 404 mit `public, max-age=60`, 5xx mit `no-store`.
- Im HTML stehen keine Storage-Pfade. Die Maße des Thumbnails werden aus dem Seitenverhältnis berechnet.
- Der Bucket bleibt privat.

### SEO
- **Indexierung**
  - Seiten ohne Query: Canonical auf sich selbst, hreflang auf die vier übersetzten Pfade und `x-default`.
  - Seiten mit Query und die Suche: `noindex, follow` ohne Canonical und hreflang. Das gilt auch per `X-Robots-Tag`.
  - Leere Kategorie- und Regionsseiten haben `noindex` und fehlen in der Sitemap. Links gibt es nur auf Regionen mit Anzeigen (Aggregat-RPC `listing_region_counts`).
- **Titel** ohne Kasusbildung („Pronájem honitby – Bavorsko“).
- **JSON-LD**
  - Startseite: `BreadcrumbList` und `WebSite`. Kategorie, Region und Detail: `BreadcrumbList`.
  - Keine Typen `Product`, `Offer` oder `Event`: Jagdgelegenheiten sind keine Produkte, und Events verlangen einen Ort.
  - Ausgabe nur über `jsonLdScript()`. Sie ersetzt `<`, `>`, `&`, U+2028 und U+2029.
  - Ein Datenblock wird nie ausgeführt und braucht keine Nonce.
- **Anbieterprofil**
  - Gewerbe ist indexierbar. Privatpersonen bekommen `noindex` und fehlen in der Sitemap.
  - Kein „dabei seit“.
- **Sitemap**
  - `generateSitemaps`, eine Datei je Sprache unter `/sitemap/{id}.xml`. Der Proxy-Matcher nimmt `sitemap/` aus.
  - `robots.ts` nennt alle Dateien mit absoluter URL.
  - Die Sitemap wird zur Anfrage erzeugt, nicht beim Build.
  - Außer in Prod (Server-Variable `SITE_INDEXABLE`) gilt `Disallow: /` und überall `X-Robots-Tag: noindex`.

### Rücksprung und Favoriten
- `safeNextPath` erlaubt öffentliche Ziele über den Parser. Die kanonische Form muss dem Eingang gleichen.
  - Query nur für die Suche, neu aufgebaut aus den geparsten Filtern und ohne `q`, höchstens 512 Zeichen.
  - `PROTECTED_SECTIONS` bleibt unverändert.
- Merken nur per POST (Server Action), nie per GET-Parameter nach dem Login.
- Favoriten:
  - Höchstens 500 je Konto (Trigger mit Advisory-Lock, `23514` wie bei `saved_searches`).
  - Nicht mehr verfügbare Favoriten bleiben erhalten (die Anzeige kann zurückkommen), lassen sich aber gesammelt entfernen.

## Folgen
- iOS (I2) nutzt `search_listings`, `provider_listings` und `public_page_state` unverändert und lädt Fotos über die Storage-API mit Anon-Key.
- M8 speichert Filter v1 in `saved_searches.filters` (Check über `private.search_filters_error`).
- Slugs sind ein URL-Vertrag. Umbenennungen brauchen eine Redirect-Tabelle.
- Volltext: Komposita werden nicht zerlegt, für cs/pl gibt es keine Diakritika-Faltung. `unaccent`/`pg_trgm` später bewerten.
- Cloud-Checkliste (M10):
  - Statement-Timeout für `anon`
  - Rate-Limit oder WAF für Suche und Foto-Route
  - `SITE_INDEXABLE` nur in Prod
