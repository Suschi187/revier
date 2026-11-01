# Plan M6 – Karte (Web)

Stand: 2026-11-01, Entwurf für das Architekt-Review.

## 0. Auftrag und Akzeptanz (SPEC 6)
- MapLibre mit Clustern, Bereichssuche, verfremdete Punkte.
- **Akzeptanz:**
  - a) Die Karte zeigt nur verfremdete Positionen.
  - b) Ein Klick öffnet das Detail.

## 1. Entscheidungen des Nutzers (2026-11-01)
1. **Kacheln selbst gehostet (SPEC 7.10 entschieden):**
   - Vektorkacheln als PMTiles-Datei (Protomaps-Basemap auf OpenStreetMap-Daten) für DE und AT, ausgeliefert von uns.
   - Kein Dritter sieht die Besucher, daher keine Einwilligung für die Karte.
   - **M9 anpassen:**
     - Der Consent-Banner führt die Karte als technisch notwendigen eigenen Dienst.
     - Die Datenschutzerklärung (Platzhalter) nennt sie.
     - Wechselt der Kachelanbieter später zu einem Dritten, braucht die Karte eine Einwilligung (Laden erst nach Zustimmung oder Klick).
     - Das wird in SPEC (M9) und ADR 016 vermerkt.
2. **Punktwahl im Assistenten gehört zu M6** (SPEC 3.3): Im Schritt „Ort“ setzt oder entfernt der Besitzer optional einen Punkt. Gespeichert wird nur der verfremdete Punkt (ADR 006).

## 2. Umfang
- **Drin:**
  - Kartenansicht für Kategorie-, Regions- und Suchseiten mit Clustern.
  - „In diesem Bereich suchen“ als neuer Filter.
  - Kleine Karte am Detail.
  - Punktwahl im Assistenten.
  - Selbst gehostete Kacheln, Schriften und Sprites.
  - Attribution (OSM/ODbL, Protomaps).
  - Entwicklungsskript für die Kartendatei.
- **Nicht drin:**
  - iOS-Karte (I3, MapKit auf derselben RPC).
  - Produktions-Hosting der Kartendatei (M10: EU-Objektspeicher oder CDN mit Range-Requests; im Plan nur konfigurierbar).
  - Routen, Geosuche nach Ortsnamen.
  - Regionsgrenzen als Polygone (ADR 006: Plausibilität ohne Polygone).

## 3. Datenmodell
### 3.1 Kartenpunkt
- Die Karte zeigt `display_location` (verfremdet). Ohne Punkt zeigt sie den Mittelpunkt des Kreises (öffentliche Referenzdaten).
- Vorschlag: Spalte `listings.map_point geography(point)`, die ein Trigger auf allen Pfaden pflegt (`coalesce(display_location, centroid des Kreises)`), dazu ein GiST-Index.
  - Sonst bräuchte jede Bereichsabfrage zwei Pfade (Punkt bzw. Kreismittelpunkt per Join).
  - Ohne GRANT und nicht im Inhalts-Hash.
- Ausgabe auf 4 Nachkommastellen gerundet (etwa 11 m). Das ist kosmetisch: Der Punkt ist ohnehin verfremdet. Es verhindert aber, dass die volle Genauigkeit der Projektion als Merkmal dient.

### 3.2 Filter `bbox` (Filterformat v1, additiv)
- `bbox: [west, south, east, north]` in Grad.
- Geprüft wird in `private.search_filters_error` und mit Zod, die Fixture `search_filters.json` bekommt neue Fälle:
  - Gültige Bereiche: −180..180 und −90..90, `west < east`, `south < north`.
  - Höchstens 30° je Achse, sonst `22023`, `hint = bbox`.
- Trifft `map_point` im Rechteck (`&&` mit Index).
- Additiv in v1: Alte Filter bleiben gültig, für M8 und iOS ändert sich nichts. Frage an den Architekten: v1 erweitern oder v2?

### 3.3 Kartenpunkte per RPC
- `public.map_listings(p_filters jsonb)`, `security invoker`, gleiche Filterprüfung und Sichtbarkeit wie `search_listings` (`listing_is_public`, B1 aus M5). `bbox` ist Pflicht.
- Rückgabe: höchstens 2000 Punkte, dazu `truncated`. Je Punkt `id`, `lat`, `lng`, `kind`, `direction`, Titel, Preisfelder, Kreis-Code. Keine PLZ, kein Ort.
- Geclustert wird im Browser (MapLibre GeoJSON-Cluster). Ist `truncated`, sagt die Karte „Bitte hineinzoomen“.
- Die Suche (`search_listings`) liefert `point` zusätzlich je Treffer, gerundet wie oben. Das Detail bekommt `point` aus derselben Spalte.

### 3.4 Punkt setzen
- Die Verfremdung bleibt unverändert (Trigger `listings_blur_location`, ADR 006 v2): Nur der Besitzer setzt den Punkt, höchstens 80 km vom Kreismittelpunkt, Raster 1 km plus fester Versatz von 3–5 km.
- Der Assistent schreibt `display_location` per UPDATE (Spalten-GRANT besteht).
- Zu klären: Gehört der Punkt in die RPC `set_listing_location` (Kreis, PLZ, Ort und Punkt in einem Schritt)? Ein Kreiswechsel löscht den Punkt ohnehin (B3).
- Der Eingabepunkt wird nie gespeichert und nie geloggt. Der Server gibt ihn nicht zurück.
- Den gespeicherten, verfremdeten Punkt sieht der Besitzer danach auf der Karte („So erscheint die Lage öffentlich“).

## 4. Web
### 4.1 Kacheln, Stil, Schriften
- **Abhängigkeiten:**
  - `maplibre-gl`: WebGL-Karte, BSD-3, die SPEC verlangt MapLibre.
  - `pmtiles`: Protokoll für Range-Requests auf eine Datei, BSD-3.
  - `@protomaps/basemaps`: Stil aus den Protomaps-Layern erzeugen, BSD-3.
  - Alle mit fester Version und Begründung im CHANGELOG.
- **Kartendatei:**
  - URL aus `NEXT_PUBLIC_MAP_TILES_URL`. Lokal liefert ein Route Handler `/api/tiles/{name}.pmtiles` eine Datei aus `web/.cache/map/` mit Range-Unterstützung (206). Das ist nur für die Entwicklung gedacht, in Prod kommt die Datei aus dem Objektspeicher (M10).
  - Skript `npm run map:download`: holt das `pmtiles`-CLI als Release-Binary mit fester Version und Prüfsumme (kein Homebrew) und schneidet aus dem öffentlichen Protomaps-Build einen Ausschnitt für DE und AT bis Zoom 12 heraus. Der Ausschnitt ist voraussichtlich einige hundert MB groß, die genaue Größe wird im Plan-Review nachgereicht.
  - `.cache/` ist in `.gitignore`. Kein Kartenmaterial im Repo.
- **Schriften (Glyphs) und Sprites:** von Protomaps (Noto, OFL) für die Zeichenbereiche Latin und Latin Extended, unter `public/static/map/` im Repo, wenige MB, Lizenzdateien dabei.
- **CSP:** `worker-src blob:` (MapLibre-Worker), `connect-src` um die Kachel-Origin, `img-src blob: data:`. Gilt für die feste CSP und die Admin-CSP. Tests im Vitest.
- **Attribution:** „© OpenStreetMap-Mitwirkende“ (ODbL) und „Protomaps“, sichtbar in der Karte, Link zur Copyright-Seite.

### 4.2 Kartenansicht in Listen
- Umschalter Liste/Karte über den Query-Parameter `ansicht=karte` (sprachunabhängig `view=map`?). Mit Query sind die Seiten ohnehin `noindex` (ADR 015).
- Die Kartenkomponente ist eine Client-Komponente, erst bei Bedarf geladen (`dynamic`, kein SSR), damit Listen ohne Karte nichts an Bundle laden.
- Ablauf:
  - Startbereich: die Region des Pfads (Bundesland oder Kreis, aus den Referenzdaten), sonst DE+AT.
  - Daten über einen eigenen Route Handler `GET /api/map?…` (Filter aus dem Query-String, Anon-Client, kurzer Cache) oder direkt per PostgREST aus dem Browser mit Anon-Key. Vorschlag: Route Handler, gleiche Filterübersetzung wie die Seiten, kein Supabase-Client im Browser.
  - Klick auf einen Cluster zoomt hinein. Ein Klick auf einen Punkt öffnet eine Kurzkarte (Titel, Art, Preis) mit Link zum Detail (Akzeptanz b). Die Tastatur erreicht die Punkte über die Liste der Treffer im Kartenbereich neben bzw. unter der Karte.
  - „In diesem Bereich suchen“ setzt `bbox` im Query-String und lädt Liste und Karte neu, als normaler Link oder GET-Formular, mit JS per Router.
- **Ohne JavaScript:** Die Liste bleibt vollständig, der Umschalter zeigt „Karte braucht JavaScript“ (`noscript`).
- **Barrierefreiheit:**
  - Die Karte hat ein Label.
  - Steuerelemente sind per Tastatur bedienbar, Fokus sichtbar.
  - Die Trefferliste des Bereichs ist die zugängliche Alternative.
  - Keine Information nur über die Farbe.
  - `prefers-reduced-motion` ohne Flug-Animationen.

### 4.3 Detail
- Kleine Karte mit dem Punkt und dem Hinweis „Ungefähre Lage. Der Punkt ist 3–5 km verschoben, die genaue Lage teilt der Anbieter im Chat.“
- Ohne Punkt ein Kreis um den Kreismittelpunkt (nur Darstellung) mit dem Hinweis „Lage im Landkreis X“.
- Erst bei Sicht laden (IntersectionObserver), ohne JS nur der Text.

### 4.4 Assistent: Punkt wählen
- Im Schritt „Ort“ eine Karte mit dem gewählten Kreis.
  - Klick setzt einen Marker, „Punkt speichern“ sendet `lat`/`lng` als Formularfelder an die bestehende Server Action, „Punkt entfernen“ setzt null.
  - Nur mit JS (optional). Ohne JS bleibt der Schritt wie heute.
- **Hinweis:** „Gespeichert wird nur ein verfremdeter Punkt, 3–5 km vom gewählten entfernt. Er bleibt für alle deine Anzeigen in diesem Kreis gleich verschoben.“
- **Validierung:** Zod (Zahlen, Bereich) und DB (80 km, Fehler `23514` lokalisiert).
- Das gespeicherte Ergebnis zeigt die Karte danach als „öffentliche Lage“.
- Eine Änderung des Punkts an einer aktiven Anzeige führt wie jede Inhaltsänderung in die Prüfung (Guard, `display_location` ist Inhalt).

### 4.5 Texte
- Namespace `Map` in de/en/cs/pl: Umschalter, Bereichssuche, Hinweise, Kurzkarte, Attribution, Fehler, „hineinzoomen“, Punktwahl.
- Glossar: „ungefähre Lage“, „verfremdeter Punkt“, „In diesem Bereich suchen“.

## 5. Tests
- **pgTAP:**
  - `map_point` auf allen Pfaden: Insert, Punkt setzen und entfernen, Kreiswechsel, Server-Pfad.
  - Nicht im Hash, kein GRANT.
  - `map_listings`: nur öffentlich (anon, Besitzer, Admin, `service_role`), `bbox` Pflicht und Grenzen, Limit und `truncated`, gleiche Filter wie die Suche.
  - Rückgabe ohne PLZ und Ort.
  - Der Punkt ist nie der Eingabepunkt: Abstand 3–5 km plus höchstens die halbe Zellendiagonale. Ohne Punkt gilt der Kreismittelpunkt.
  - `bbox` in `search_filters_error`, Fixture.
- **Integration:** `map_listings` als anon, `bbox`-Fälle der Fixture.
- **Vitest:**
  - `bbox` in Zod und URL.
  - CSP mit `worker-src`.
  - Range-Handler (206, 416, ungültiger Name, Pfad-Traversal).
  - Rundung.
- **E2E (Chromium mit WebGL über SwiftShader, sonst als Lücke vermerkt):**
  - Kartenansicht zeigt Cluster und Punkte, Klick auf den Punkt führt zum Detail (Akzeptanz b).
  - Die Koordinaten der Kartendaten entsprechen `display_location` bzw. dem Kreismittelpunkt, nie dem Eingabepunkt (Akzeptanz a).
  - „In diesem Bereich suchen“ filtert die Liste.
  - Punktwahl im Assistenten: Der gespeicherte Punkt ist 3–5 km entfernt, Entfernen ergibt den Kreismittelpunkt.
  - Ohne JS bleibt die Liste vollständig.
  - Keine CSP-Verletzungen, keine Anfragen an fremde Hosts (Netzwerkprotokoll prüfen).
  - axe.
- **Netzwerk-Test:** Alle Kartenanfragen gehen an die eigene Origin bzw. `NEXT_PUBLIC_MAP_TILES_URL`.

## 6. Doku
- ADR 016 „Karte im Web“: Kacheln selbst gehostet, Pfade, Lizenzen und Attribution, Kartenpunkt, `bbox`, `map_listings`, CSP, Consent-Folgen für M9, Produktions-Hosting als M10-Aufgabe.
- SPEC v0.8: 7.10 entschieden, 3.1 `map_point`, M9-Hinweis zur Karte.
- CHANGELOG mit Lücken (iOS I3, Produktions-Hosting).

## 7. Neue Abhängigkeiten
- `maplibre-gl`, `pmtiles`, `@protomaps/basemaps`, siehe 4.1. Feste Versionen, mindestens zwei Wochen alt.
- Entwicklungswerkzeug: das `pmtiles`-CLI als Binary im Cache, keine npm-Abhängigkeit.

## 8. Offene Fragen an den Architekten
1. `map_point` als gepflegte Spalte oder Abfrage mit zwei Pfaden?
2. `bbox` additiv in v1 oder v2?
3. Kartendaten über einen eigenen Route Handler oder direkt per PostgREST aus dem Browser?
4. Punkt über `set_listing_location` (eine RPC) oder per Spalten-UPDATE?
5. Datenschutz: Erlaubt die Kombination aus Kartenpunkt, `postal_prefix` und Kreis eine engere Eingrenzung als gewollt (ADR 006 und 012)? Muss der Punkt bei kleinen Kreisen anders behandelt werden?
6. Produktions-Hosting der PMTiles (Range-Requests, Cache-Header, CORS). Reicht ein Hinweis für M10, oder muss das jetzt festgelegt werden?
7. CSP: `worker-src blob:` vertretbar, oder den Worker als eigene Datei ausliefern (`maplibregl.setWorkerUrl`)?

## 9. Commits (je grün)
1. Plan, ADR 016, SPEC v0.8, Glossar
2. Migration `map_point` mit Trigger und Index, `bbox` im Filter, `point` in der Suche, Fixture; pgTAP; Typen
3. Migration `map_listings`; pgTAP; Meta-Allowlist; Integration
4. Web: Abhängigkeiten, CSP, Kachel-Route (dev), Skript `map:download`, Schriften und Sprites, Kartenkomponente
5. Web: Kartenansicht in Listen mit Clustern, Kurzkarte und Bereichssuche
6. Web: Karte am Detail
7. Web: Punktwahl im Assistenten
8. E2E
9. CHANGELOG, ADR 016 final, QA-Hinweise

## 10. Architekt-Review

Stand: 2026-11-01. Geprüft gegen CLAUDE.md, SPEC v0.7 (3.1, 3.3, 3.4, 4.2, 4.4, 6 M6/M9, 7.10, 8), ADR 006, 010, 012, 014, 015, die Migrationen `listings`, `listing_location_v2`, `listing_places`, `moderation_fields`, `search_listings`, `public_page_state`, `qa_m5_fixes` sowie `web/lib/security/csp.ts`, `web/next.config.ts`, `web/proxy.ts`, `web/lib/search/filters.ts`, `web/lib/services/public-listings.ts`, `web/components/listings/steps/LocationStep.tsx`, `web/app/[locale]/account/listings/[id]/edit/actions.ts`, `web/lib/services/listings.ts`. Aussagen zu Next belegt mit `web/node_modules/next/dist/docs/01-app/` (Pfade verkürzt).

**Ergebnis: Freigabe unter Auflagen.** Mit der Umsetzung darf begonnen werden, sobald B1 bis B3 in Plan und ADR 016 eingearbeitet sind (Commit 1). B1 braucht dafür eine Entscheidung des Nutzers. Die A-Auflagen sind Teil der Definition of Done von M6.

Vorab eine Tatsache, die mehrere Antworten bestimmt: `anon` und `authenticated` haben **SELECT auf die ganze Tabelle** `listings` (`listings.sql`, Zeile 349, kein Spalten-GRANT). Eine neue Spalte `map_point` ist damit automatisch für alle lesbar, „ohne GRANT“ geht nicht. `display_location` und `owner_id` aller öffentlichen Anzeigen lassen sich schon heute per PostgREST seitenweise abrufen. Der Schutz der Lage liegt also ganz in der Verfremdung (ADR 006). Limits an `map_listings` sind Last- und UX-Grenzen, kein Schutz gegen Abschöpfen.

### 10.1 Antworten auf die offenen Fragen (Abschnitt 8)
1. **Gepflegte Spalte, ja,** unter B2: als `geometry(Point, 4326)` statt `geography`, gesetzt von einem eigenen Trigger, der als letzter läuft, und mit Teil-Index. `geography &&` mit einem Rechteck aus Grad rechnet mit Großkreis-Kanten. Bei 30° Breite weicht die Nordkante um mehrere Grad vom Kartenausschnitt ab. `geometry && ST_MakeEnvelope(w, s, e, n, 4326)` trifft genau das Rechteck der Karte. Die Alternative mit zwei Pfaden (`display_location` oder Kreis per Join, OR über zwei Indizes) ginge auch, verteilt die Regel aber auf jede Abfrage (Suche, Karte, M8, iOS).
2. **Additiv in v1, ja.** Unbekannte Schlüssel sind heute ein Fehler, es gibt also keinen Leser, der `bbox` still ignorieren würde. iOS (I2/I3) ist noch nicht gebaut. M8 bekommt `bbox` über den Check `search_filters_error` automatisch, Suchaufträge „in diesem Bereich“ sind gewollt. Vertrag in A3. Ein v2 lohnt erst bei einer nicht abwärtskompatiblen Änderung.
3. **Eigener Route Handler, ja** (A5). Gründe:
   - dieselbe Übersetzung URL → Filter wie die Seiten (`filtersFromParams`)
   - kein Supabase-Client und keine Supabase-Origin auf öffentlichen Seiten
   - eine Stelle für Antwortform (GeoJSON), Header und später Rate-Limit/WAF (M10)
   - iOS ruft die RPC direkt auf, der Vertrag bleibt die RPC.
   Mit `cacheComponents` laufen GET-Route-Handler zur Anfrage, wenn sie Request-Daten lesen; `use cache` nur in einer Hilfsfunktion (`01-getting-started/15-route-handlers.md`, „With Cache Components“). Für `/api/map` gilt: kein Cache (A6).
4. **In `set_listing_location`, ja** (B3). Kreis und Punkt müssen in **einem** UPDATE stehen, sonst hängt das Ergebnis von der Reihenfolge ab. Ein getrenntes UPDATE des Punkts vor dem Kreiswechsel würde vom Trigger sofort wieder gelöscht (ADR 006, B3). Danach hängen Guard, Legal-Gate und Status an einer Transaktion. Außerdem ist es der Vertrag für iOS I4 (ADR 012).
5. **Ja, enger als ADR 006 beschreibt, in drei Fällen.** Details und Lösung in B1. Kurz:
   - Ein öffentlicher Punkt `d` sagt: Die wahre Zelle liegt auf einem Ring von 3–5 km um `d` (mit Zelle etwa 2,3–5,7 km, rund 85 km²).
   - **Randeffekt:** Der Kreis ist öffentlich (und das PLZ-Präfix grenzt ein Leitgebiet ein, dessen Fläche aus OSM öffentlich ist). Ring ∩ Kreis ∩ Präfixgebiet ist bei kleinen Kreisen (kreisfreie Städte, Statutarstädte mit 20–150 km²) oder bei Punkten nahe der Grenze nur ein Bruchteil des Rings. Liegt `d` außerhalb des Kreises, zeigt das die Richtung des Versatzes.
   - **Mehrere Zellen eines Besitzers im Kreis:** Alle Anzeigen teilen den Versatz `V`. `owner_id` ist öffentlich. Jede Anzeige verlangt `d_i − V ∈ Kreis`, also `V ∈ ⋂ (d_i − Kreis)`. Je weiter die Reviere eines Besitzers (Gewerbe, Vermittler) im Kreis verteilt sind, desto enger wird `V` und damit jede Lage. ADR 006 nennt das „Form, nicht Ort“. Mit der öffentlichen Kreisgrenze wird aus der Form ein Ort.
   - **Zwei Schlüssel für ein Revier:** Ein Revier an der Kreisgrenze mit Anzeigen in beiden Kreisen, oder ein Kreiswechsel, dessen alter Punkt in Caches, Crawlern oder Archiven steht. Zwei Ringe schneiden sich in zwei Linsen von wenigen km². ADR 006 nennt das ein Restrisiko, mit M6 wird es real.
   - Die zwei Ziffern der PLZ verengen nur dort, wo eine Leitgebietsgrenze den Kreis teilt; sie sind meist gröber als der Kreis (ADR 012). Die volle PLZ bleibt das stärkere Merkmal und ist nie öffentlich.
6. **Jetzt festlegen, was die App erwartet; den Anbieter in M10 wählen** (A1). Weil `NEXT_PUBLIC_*` beim Build in das Bundle eingesetzt wird (`02-guides/self-hosting.md`, Environment Variables) und die feste CSP beim Build aus `next.config.ts` entsteht, bindet eine Kachel-Origin über `NEXT_PUBLIC_MAP_TILES_URL` das Artefakt an eine Umgebung. Das widerspricht „ein Artefakt für Stage und Prod“ (ADR 015, QA M5 F10). Lösung: eigene Origin, fester Pfad, versionierter Dateiname, Wert zur Laufzeit vom Server. Dann entfallen CORS und eine fremde Origin in `connect-src`.
7. **Eigene Worker-Datei, nicht `blob:`** (A2). Die CSP-Build-Variante von MapLibre (`maplibre-gl-csp.js` und `maplibre-gl-csp-worker.js`, beim Pinnen prüfen, dass die Version sie enthält) mit `setWorkerUrl('/static/map/maplibre-gl-csp-worker.<version>.js')` und `worker-src 'self'`. Fehlt `worker-src`, gilt `script-src`. In der Admin-CSP ignoriert `'strict-dynamic'` aber `'self'`. Die Admin-CSP bleibt deshalb unverändert, im Admin gibt es in M6 keine Karte.

### 10.2 Blockierend
- **B1 Standortschutz: Bedrohungsmodell und Regel für kleine Kreise vor dem ersten Punkt.**
  - Bis M6 setzt kein Client einen Punkt (Web ohne Karte, iOS nicht gebaut). Mit M6 entstehen die ersten echten Punkte, deshalb vorher klären.
  - ADR 016 enthält das Modell aus 10.1 Nr. 5 mit Zahlen: Fläche von Ring und Zelle; Ring ∩ Kreis für die zehn kleinsten Kreise in DE und AT; ein Beispiel mit drei Zellen eines Besitzers.
  - **Entscheidung des Nutzers** zu folgenden Punkten (meine Empfehlung: a und b umsetzen, c dokumentieren):
    - a) **Mindestfläche:** In Kreisen unter `listing_location_min_district_km2` (Vorschlag 400 km², `app_settings`) ist kein Punkt erlaubt, die Karte zeigt den Kreismittelpunkt. Die Fläche kommt als Skalar `regions.area_km2` aus denselben Quellen wie `regions_data.sql` (VG250, Statistik Austria), Polygone braucht es nicht (ADR 006 bleibt). Der Trigger `listings_blur_location` lehnt mit `23514`, `hint = location.point.small_district` ab, ohne Koordinaten. Der Assistent blendet die Punktwahl dort aus. Etwa ein Viertel der Kreise ist betroffen (fast nur kreisfreie Städte). Die genaue Zahl gehört ins ADR.
    - b) **Hinweis bei der zweiten Zelle:** Hat der Besitzer im selben Kreis schon eine Anzeige mit Punkt in einer anderen Zelle, zeigt der Assistent vor dem Speichern: „Mehrere Punkte in einem Kreis zeigen, wie deine Reviere zueinander liegen. Zusammen mit der Kreisgrenze kann das die Lage eingrenzen.“ Die Prüfung läuft serverseitig beim Rendern (eigene Anzeigen), es gibt keine neue RPC.
    - c) **Restrisiko** „zwei Schlüssel“ (Kreisgrenze, Kreiswechsel) in ADR 006 und 016 mit Größenordnung festhalten; im Assistenten beim Kreiswechsel kurz nennen.
  - pgTAP zu a: Punkt in einem kleinen Kreis ergibt `23514` mit dem Hint, bestehender Punkt bleibt bei unverändertem Kreis, Grenze aus `app_settings`.
- **B2 `map_point` darf nie den Eingabepunkt sehen.**
  - `BEFORE`-Trigger laufen in alphabetischer Reihenfolge. Ein Trigger vor `listings_zz_blur_location` kopiert den **Rohpunkt** in eine Spalte, die `anon` lesen kann (siehe Vorbemerkung). Das wäre ein Vorfall nach ADR 006, „Ernstfall“.
  - **Verbindlich:**
    - Eigener Trigger `listings_zzz_map_point`, `BEFORE INSERT OR UPDATE` **ohne Spaltenliste**, setzt immer `new.map_point := coalesce(new.display_location::geometry, centroid::geometry)`. Er überschreibt damit auch direkte Schreibversuche (`service_role` hat Vollrechte). Kein Spalten-GRANT für INSERT/UPDATE, nicht im Inhalts-Hash, nicht im Guard-Vergleich.
    - Meta-Test in `00_meta`: Der Name des Triggers sortiert nach `listings_zz_blur_location`; keine andere Funktion schreibt `map_point`.
    - pgTAP: Nach Insert und Update mit Rohpunkt ist `map_point = display_location` und der Abstand zum Rohpunkt liegt in [2293 m, 5707 m]. Nach Kreiswechsel ohne Punkt gilt der neue Kreismittelpunkt, nach Entfernen durch den Admin ebenso, ein direktes `update … set map_point` als `service_role` wird überschrieben.
    - Index: `create index … using gist (map_point) where status = 'active'` (`now()` darf nicht in ein Index-Prädikat).
    - Ändert eine spätere Daten-Migration `regions.centroid`, rechnet sie `map_point` nach (Hinweis in ADR 007/016, Test „map_point = coalesce(…)“ für alle Zeilen).
  - „Ohne GRANT“ in Plan 3.1 streichen. Richtig ist: lesbar wie `display_location`, schreibbar nur durch den Trigger.
- **B3 Vertrag „Punkt setzen“: eine RPC, drei Zustände, nie vorbelegt.**
  - `set_listing_location(p_listing_id, p_region_id, p_postal_code, p_place_name, p_point text default 'keep', p_lat double precision default null, p_lng double precision default null)`, mit `p_point` in `keep | set | clear`.
    - Die alte Signatur per `drop function` entfernen, nicht überladen (PostgREST löst Überladungen mit benannten Argumenten nicht eindeutig auf). Alte Aufrufe ohne Punkt bleiben gültig, weil die Vorgabe `keep` ist. GRANT, Allowlist in `00_meta` und Typen nachziehen.
    - Kreis und Punkt in **einem** UPDATE: `set region_id = …, display_location = …` nur bei `set`/`clear`; bei `keep` wie heute nur `region_id`, wenn er sich ändert (dann löscht der Trigger den Punkt).
    - `set` verlangt endliche Werte in −90..90 und −180..180 (`isfinite`, NaN ausschließen), sonst `22023`, `hint = point`. `clear` auf einem Punkt, der schon `null` ist, schreibt nichts (sonst prüft der Guard unnötig).
    - Rückgabe weiter `void`. Fehler ohne Koordinaten.
  - **Web:** Das Formular sendet `point=keep` als Vorgabe. `set` mit `lat`/`lng` nur nach einer Aktion des Nutzers (Marker gesetzt), `clear` nur über „Punkt entfernen“. Der gespeicherte Punkt wird **nie** als Vorbelegung von `lat`/`lng` ausgegeben. Sonst verschiebt jedes Speichern des Schritts den Punkt erneut um 3–5 km und nimmt die Anzeige aus der Öffentlichkeit (ADR 006, „nie zurückschicken“).
  - **Keine eigene Rundung der Ausgabe** (Plan 3.1 und 3.3 ändern). Sie schützt nichts: Die volle Genauigkeit liegt per PostgREST ohnehin offen, und der Versatz ist eine stetige Größe aus dem HMAC. Gerundete und ungerundete Werte nebeneinander verleiten aber zum Zurückschicken. Ausgegeben wird überall genau der gespeicherte Wert.
  - ADR 012 (Vertrag) und ADR 006 („Für Clients“) entsprechend ergänzen. pgTAP: `keep` mit Kreiswechsel löscht, `set` mit Kreiswechsel nutzt den neuen Schlüssel und die neue Plausibilität, `clear`, NaN, Fremde und Admin (`42501`), Legal-Gate (`RV001`), unverändert zurückgeschrieben bleibt die Anzeige aktiv.

### 10.3 Auflagen
- **A1 Kacheln: Auslieferung und Datenschutz.**
  - Die App lädt die Kartendatei von der **eigenen Origin** unter einem festen Pfad, z. B. `/tiles/basemap-<YYYYMMDD>.pmtiles`. Den Dateinamen liest der Server zur Laufzeit aus `MAP_TILES_FILE` (ohne `NEXT_PUBLIC_`) und gibt ihn als Prop an die Kartenkomponente. In Prod liefert der Reverse-Proxy bzw. das CDN diesen Pfad aus dem Objektspeicher, bevor die Anfrage Next erreicht (M10). `connect-src` bleibt `'self'`, CORS entfällt.
  - **Dev-Route:** Der Proxy (`PASS_THROUGH`) muss den Pfad durchreichen; sonst `/api/tiles/…`. Die Route ist nur aktiv, wenn `MAP_TILES_DIR` gesetzt ist, sonst 404.
    - Name nur nach `^[a-z0-9-]{1,64}\.pmtiles$`, Pfad aufgelöst und innerhalb des Verzeichnisses.
    - Header: `Accept-Ranges: bytes`, `Content-Type: application/octet-stream`, `ETag`.
    - Antworten: genau ein Bereich mit 206 und `Content-Range`, sonst 416; Mehrfachbereiche 416 oder 200 ganz (festlegen); HEAD.
    - Bereich höchstens 16 MB, kein `Content-Encoding`.
  - **Für M10 festhalten (WEB-RELEASE):**
    - Range-Requests mit 206 und stabilem `ETag`, versionierte Datei mit `public, max-age=31536000, immutable`, HTTP/2.
    - EU-Standort, Auftragsverarbeitungsvertrag.
    - **Zugriffslogs ohne IP oder mit höchstens 7 Tagen Aufbewahrung**, nie mit Konto-IDs zusammengeführt. Grund: Die Byte-Bereiche lassen sich über das öffentliche Verzeichnis der Datei auf Kacheln zurückrechnen. Eine Kachel auf Zoom 12 ist bei 50° N etwa 6 km breit. Wer im Assistenten auf sein Revier zoomt, hinterlässt die Lage im Log, in der Größenordnung des Versatzes. Dasselbe gilt für die Logs der Dev-Route und von Next (keine Zugriffsprotokolle mit Range-Headern).
    - Bandbreiten-Limit/WAF für den Kachelpfad.
  - `map:download`: Quelle (Build-Datum des Protomaps-Builds), `pmtiles`-Version und SHA-256 der erzeugten Datei in `docs/` bzw. einer `SOURCES.md` neben dem Skript festhalten. Die Größe des Ausschnitts gehört ins ADR 016, bevor M10 den Speicher plant.
- **A2 CSP und Worker.**
  - Feste CSP: `worker-src 'self'`, kein `blob:` in `worker-src` oder `script-src`. `img-src` hat `blob:` und `data:` schon. `connect-src` bleibt `'self'` plus Supabase (A1). Das Worker-Skript unter `/static/map/` bekommt die feste CSP über `headers()` (Pfad ist nicht `/admin`), das ist so gewollt.
  - Admin-CSP unverändert, kein Kartencode im Admin. Falls später nötig, `worker-src 'self'` ausdrücklich, weil `'strict-dynamic'` `'self'` verwirft.
  - Kein `setRTLTextPlugin`, keine fremden Stil-, Glyph- oder Sprite-URLs im Stil. Ein Vitest prüft den erzeugten Stil: Alle URLs sind relativ oder `pmtiles:///tiles/…`.
  - Vitest der CSP-Zeichenkette (feste und Admin-CSP). E2E sammelt `securitypolicyviolation`-Ereignisse und Konsolenfehler, Ergebnis leer.
- **A3 `bbox` im Filterformat v1** (ADR 015 Tabelle, Fixture, Zod, iOS I2/I3, M8):
  - Array aus genau vier JSON-Zahlen, endlich, `west < east`, `south < north`, Bereiche wie im Plan, höchstens 30° je Achse. Kein Überqueren der Datumsgrenze (für die Märkte unnötig, im ADR nennen).
  - **Kanonisch auf 4 Nachkommastellen:** Das Web rundet nach außen (Westen/Süden ab, Osten/Norden auf), bevor es den Filter baut. Sonst entstehen beliebig viele Filter-Hashes (Cursor) und lange URLs. Die DB lehnt mehr als 4 Stellen nicht ab, damit iOS frei bleibt. Zum Filter-Hash im Cursor reicht die kanonische Form im Web.
  - Semantik: Treffer, wenn `map_point` im Rechteck liegt. Eine Anzeige ohne Punkt zählt nur, wenn der Kreismittelpunkt im Rechteck liegt, auch wenn der Kreis hineinragt. So im ADR und in der Hilfe-Zeile der Bereichssuche.
  - URL-Parameter `bbox=w,s,e,n` (sprachunabhängig wie `cur`, `pmin`), in `PARAM_NAMES`. Ungültig fällt weg wie die übrigen Werte. `safeNextPath` behält ihn (Länge ≤ 512 bleibt).
  - Ansicht: `view=map`, kein Filter. Ein Test zeigt, dass der Proxy mit `?view=map` `noindex, follow` setzt (`withListRobots`, Query vorhanden).
  - `search_listings` und `map_listings` akzeptieren `bbox`. Für `map_listings` ist er Pflicht (`22023`, `hint = bbox`), und `sort` wird ignoriert.
- **A4 `map_listings`: dieselbe Sichtbarkeit und dieselben Bedingungen wie die Suche, nicht kopiert.**
  - Den Aufbau der Bedingungen aus `search_listings` in eine private Funktion ziehen (z. B. `private.search_conditions(f)`, liefert SQL-Fragment und Parameter), die beide RPCs nutzen. Eine Kopie driftet. Die Funktion kommt auf die Allowlist in `00_meta`.
  - Ausdrücklich `l.status = 'active' and l.expires_at > now() and private.listing_is_public(…)` (M5 B1), `security invoker`, `stable`, `search_path = ''`, nie `definer`.
  - Rückgabe je Punkt: `id`, `lng`, `lat`, `kind`, `direction`, `title`, Preisfelder, `district_code`, dazu `approx: point | district` (Punkt gesetzt oder Kreismittelpunkt). Ohne `owner_id`, `postal_prefix`, PLZ und Ort. `owner_id` ist zwar öffentlich, die Karte braucht ihn aber nicht, und gebündelt wäre er der bequemste Weg zum Angriff aus B1.
  - Limit 2000 über `limit 2001`, deterministische Reihenfolge (`published_at desc, id desc`), `truncated`.
  - pgTAP:
    - Dieselbe Menge für anon, einen fremden Nutzer, den Besitzer (mit Entwurf und gesperrtem Konto), einen Admin mit aal2 und `service_role`.
    - Äquivalenz: Für jede gültige Filterkombination der Fixture plus weite `bbox` liefert `map_listings` dieselben IDs wie `search_listings` über alle Seiten.
    - Ohne Punkt der Kreismittelpunkt, nie der Rohpunkt.
  - `explain (analyze)` mit etwa 10 000 synthetischen Anzeigen im CHANGELOG: DE+AT gesamt, ein Bundesland, ein kleiner Ausschnitt, mit `q`.
  - `listing_card` bekommt `point` und `approx`. Das wirkt auch auf `my_favorites` und `provider_listings`. Zod-Schema in `public-listings.ts` und den Snapshot der Rückgabe nachziehen.
- **A5 Route Handler `GET /api/map`.**
  - Filter nur über `filtersFromParams` aus dem Query-String (dieselben Namen wie die Seite), `bbox` Pflicht, sonst 400 mit `{ error: "invalid", key }`; DB-Fehler 502 ohne Details.
  - Antwort GeoJSON `FeatureCollection` plus `truncated`, `Content-Type: application/geo+json`, `X-Content-Type-Options: nosniff`.
  - Kein `Access-Control-Allow-Origin`.
  - Anon-Client ohne Cookies; das Modul importiert `lib/supabase/server` nicht (bestehender Test).
  - Timeout wie im Proxy (800 ms bis 2 s, festlegen), danach Fehlerzustand „Karte konnte nicht geladen werden“ mit Wiederholen.
  - In die M10-Checkliste (ADR 015 „Cloud-Checkliste“): Rate-Limit/WAF auch für `/api/map` und den Kachelpfad.
- **A6 Cache und sofortige Wirkung.**
  - `/api/map` ohne Daten-Cache und mit `Cache-Control: private, no-store`. Freie `bbox`-Werte würden jeden Cache verdrängen (M5 A2). Ein öffentlicher HTTP-Cache würde entfernte Anzeigen über den Zähler hinaus ausliefern. Die Abfrage ist mit Index billig.
  - Detail: `point` kommt über `getPublicListing` (Zähler im Schlüssel), Listen über `cachedListings` wie bisher.
  - **Neuer Auslöser des Zählers:** Entfernt ein Moderator den Punkt einer fremden Anzeige (`display_location → null`, Ausnahme im Guard von `moderation_fields`), ist das eine Schutzmaßnahme und muss sofort wirken. Trigger `listings_point_removed_bump_cache` (`after update of display_location … when (new.display_location is null and old.display_location is not null)`); der Fall „Besitzer entfernt“ darf mitzählen. pgTAP und ADR 015 „Zähler“ ergänzen.
  - Verschiebt der Besitzer den Punkt, geht die Anzeige in die Prüfung. Gecachte Listen zeigen den alten Punkt höchstens 5 min, das deckt ADR 015 ab. Im Hinweis bei der Punktwahl nicht „sofort“ versprechen.
- **A7 Keine Koordinaten in Logs, URLs und Metadaten.**
  - Server Action: `lat`/`lng` nur im POST-Body. Fehler gehen als Codes in die URL (wie heute), nie Werte. Kein `console.*` mit `FormData`, Zod-Fehlern oder RPC-Argumenten; Zod ohne `reportInput`. Ein Vitest ruft die Action mit ungültigem und gültigem Punkt auf und prüft, dass Redirect-URL und Konsolenausgabe keine Ziffernfolge des Punkts enthalten.
  - Keine Browser-Geolocation (Permissions-Policy `geolocation=()` bleibt), keine Geocodierung.
  - Detail ohne `geo`/`GeoCoordinates`/`Place` im JSON-LD, ohne `geo.position`/`ICBM`-Meta, ohne Koordinaten in OG-Bild, Sitemap und URL. Der HTML-Test aus M5 (keine PLZ) prüft zusätzlich: Koordinaten erscheinen nur im Kartencontainer bzw. im RSC-Payload der Karte.
  - ADR 006, „Logging-Checkliste“, um die Kachel-Logs (A1) und `/api/map` ergänzen (die `bbox` eines Besuchers zeigt Interesse, nicht die Lage eines Reviers; Aufbewahrung wie andere Zugriffslogs).
- **A8 Barrierefreiheit.**
  - **Punktwahl ohne Maus:** ein Fadenkreuz in der Kartenmitte. Pfeiltasten verschieben die Karte (MapLibre-Tastatursteuerung), der Button „Punkt in der Kartenmitte setzen“ setzt den Marker. Klick bleibt zusätzlich. Status per `aria-live` („Punkt gesetzt“, „Punkt entfernt“). Sonst ist die Funktion nur per Maus bedienbar (WCAG 2.1.1).
  - **Punkte in der Liste:** Einzelpunkte im sichtbaren Ausschnitt als HTML-Marker (`maplibregl.Marker` mit `<button aria-label="Titel, Art, Preis">`), Cluster als Layer. Bei mehr als etwa 300 sichtbaren Einzelpunkten nur Layer. Das macht Punkte fokussierbar und im E2E klickbar (A11). Die Trefferliste neben der Karte bleibt die vollständige Alternative und meldet die Zahl per `aria-live`.
  - **Gleiche Koordinaten:** Alle Anzeigen ohne Punkt eines Kreises liegen auf dem Mittelpunkt, Anzeigen eines Besitzers in einer Zelle auf demselben Punkt. Ein Klick darauf öffnet eine Kurzkarte mit **allen** Anzeigen an dieser Stelle (bis 20, dann Link „in der Liste zeigen“ mit `bbox`). Sonst ist Akzeptanz b für diese Fälle nicht erfüllt.
  - Kurzkarte: Fokus geht hinein, `Esc` schließt, der Fokus kehrt zum Auslöser zurück. Link zum Detail ist ein echter `<a>`.
  - `prefers-reduced-motion`: `jumpTo` statt `flyTo`/`easeTo`, auch beim Cluster-Zoom.
  - Attribution und Steuerelemente: Kontrast AA, Fokus sichtbar, Tastaturreihenfolge Karte → Steuerelemente → Liste.
  - axe in E2E auf Liste mit Karte, Detail und Assistent.
- **A9 Bundle und Core Web Vitals.**
  - `maplibre-gl` und `pmtiles` nur per `dynamic(() => import(…), { ssr: false })` in einer Client-Komponente (`02-guides/lazy-loading.md`: `ssr: false` geht nur dort). Auf der Liste geladen erst mit `view=map`. Auf dem Detail erst auf Klick („Karte anzeigen“) oder bei Sicht und Leerlauf (`requestIdleCallback`), nie vor LCP.
  - Ein Test prüft die Build-Ausgabe: Die Chunks von Start, Liste ohne `view=map` und Detail vor Interaktion enthalten kein `maplibre`.
  - `@protomaps/basemaps` als **devDependency**: Ein Skript erzeugt den Stil je Sprache (`lang` für Beschriftungen) als JSON unter `public/static/map/` (klein, im Repo, mit Version im Namen). Die Bibliothek gelangt nicht ins Bundle.
  - `public/` liefert `Cache-Control: public, max-age=0` (`03-file-conventions/public-folder.md`). Für die versionierten Dateien unter `/static/map/` (Worker, Stil, Glyphs) per `headers()` `max-age=31536000, immutable` setzen.
  - Container mit fester Höhe (kein CLS), Platzhalter bis zum ersten Rendern.
  - Werte (gzip-Größe der Karten-Chunks, LCP/INP der Liste mit Karte auf einem Mittelklasse-Telefon) im CHANGELOG, Abnahme in M10.
- **A10 Lizenzen und Attribution.**
  - Immer sichtbar, nicht eingeklappt (`AttributionControl` ohne `compact`): „© OpenStreetMap-Mitwirkende“ mit Link auf `openstreetmap.org/copyright` und „Protomaps“. So auch auf der kleinen Detail-Karte und im Assistenten.
  - Seite „Datenquellen“ (M5/M9): Basiskarte aus OSM (ODbL) über den Protomaps-Build mit Datum. Die Kartendatei ist öffentlich abrufbar und damit eine öffentlich genutzte Datenbank; sie bleibt unverändert und unter ODbL, der Hinweis nennt die Quelle. In SPEC 7.2 (Anwalt) zur ODbL-Frage aus ADR 012 dazunehmen.
  - Schriften: Noto (OFL 1.1), Lizenztext neben den Dateien. Zeichenbereiche mindestens 0–255 und 256–511 (cs/pl brauchen Latin Extended-A). Fehlende Bereiche erzeugen Anfragen auf 404, im E2E sichtbar.
  - **Sprites weglassen:** Der Stil braucht keine POI-Symbole (Geschäfte und Ähnliches helfen bei Jagdgelegenheiten nicht). Das spart Dateien und eine Lizenzprüfung. Werden sie doch gebraucht, Lizenz je Datei prüfen und festhalten.
  - Lizenzen aller neuen Pakete einschließlich der transitiven Abhängigkeiten im CHANGELOG (Ausgabe von `npm ls --all` für die drei Pakete, nur MIT/BSD/ISC).
- **A11 Testbarkeit.**
  - **Ohne Kartendatei lauffähig:** CI hat keine Datei von mehreren hundert MB. Fehlt die Datei, zeigt die Karte Punkte auf neutralem Hintergrund plus Hinweis, ohne Fehlerschleife. Für E2E eine kleine Fixture-Datei (ein Ausschnitt mit Zoom 0–8, unter 5 MB). Sie wird im Testlauf erzeugt oder aus dem Cache geladen, nicht ins Repo eingecheckt, wenn sie größer als 1 MB ist. Range-Vitest mit einer synthetischen Datei.
  - **WebGL in headless Chromium:** Neuere Chromium-Versionen fallen nicht mehr still auf SwiftShader zurück. Im Playwright-Projekt für Kartentests `--use-angle=swiftshader --enable-unsafe-swiftshader` setzen und mit einem Smoke-Test absichern (`canvas.getContext('webgl2')` nicht null). Läuft WebGL in CI nicht, ist das ein roter Test, keine stille Lücke.
  - Akzeptanz a ohne Pixelvergleich: Die Antwort von `/api/map` (Netzwerkprotokoll) und die Positionen der HTML-Marker entsprechen `display_location` bzw. dem Kreismittelpunkt aus der DB (`service_role` im Test). Der eingegebene Rohpunkt erscheint in **keiner** Antwort (HTML, RSC, `/api/map`, Server-Action-Antwort), geprüft als Zeichenkette mit 3 bis 6 Nachkommastellen.
  - Akzeptanz b: Klick auf HTML-Marker und auf einen Eintrag der gestapelten Kurzkarte führt zum Detail.
  - Netzwerk: Alle Anfragen gehen an die eigene Origin. Keine Testhilfen im Produktions-Bundle (kein `window.__map`).
- **A12 Consent und Datenschutz (M9, SPEC, ADR 016).**
  - Der Maßstab ist nicht „eigener Server“, sondern „kein eigener Verantwortlicher“: Ein CDN oder Objektspeicher als Auftragsverarbeiter in der EU mit AVV braucht keine Einwilligung. Eine Einwilligung (Laden erst nach Klick) braucht ein Anbieter, der als eigener Verantwortlicher handelt oder Daten außerhalb der EU verarbeitet. So in SPEC M9 und ADR 016 formulieren.
  - MapLibre legt Kacheln ggf. im Cache Storage des Browsers ab (`clearStorage()`). Bei einer vom Nutzer aufgerufenen Karte ist das technisch notwendig (§ 25 Abs. 2 TDDDG), muss aber in der Datenschutz-Platzhalterseite stehen. Prüfen, ob das über das `pmtiles`-Protokoll überhaupt passiert, und das Ergebnis ins ADR schreiben.

### 10.4 Hinweise
- **H1 Viele Anzeigen:** Ab über 2000 Anzeigen in DE+AT ist der Startausschnitt immer `truncated`, und „hineinzoomen“ ist dann der erste Eindruck. Besser gleich mitbauen: Bei `truncated` liefert die RPC statt Punkten Zählungen je Rasterzelle (`ST_SnapToGrid`, Raster ≈ Ausschnitt/32). Aggregiert ist das unkritisch. Spätestens bei 1000 Anzeigen nachziehen.
- **H2 Größe der Antwort:** 2000 Punkte mit Titel und Preis sind ungezippt etwa 300–400 KB. Alternativ die Punkte schlank halten (`id`, Koordinaten, `kind`, `direction`, `approx`) und die Kurzkarte über die Karten-Daten der Treffer nachladen. Messen und entscheiden.
- **H3 Startausschnitt:** `regions` hat nur Mittelpunkte. Eine Bounding Box je Region als vier Zahlen in `region-slugs.json` (aus VG250/Statistik Austria, kein Polygon) passt besser als ein fester Zoom je Ebene.
- **H4 Zoom:** Zoom 12 reicht. Der Punkt rastet ohnehin auf 1 km ein. Im Assistenten `maxZoom` 13 und der Hinweis „Auf wenige hundert Meter genau reicht“. Das senkt auch die Aussagekraft der Kachel-Logs (A1).
- **H5 Kreis am Detail:** Den Kreis um den Mittelpunkt nicht mit einem Radius zeichnen, der Genauigkeit vortäuscht. Besser nur der Text „Lage im Landkreis X“ und ein Marker mit anderem Symbol (nicht nur Farbe, A8).
- **H6 Label-Sprache:** Beschriftungen je Locale (`name:de`, `name:cs`, `name:pl`, Rückfall `name`). Ortsnamen in DE/AT bleiben meist deutsch, das ist richtig so.
- **H7 Kompression:** Next komprimiert `application/octet-stream` nicht. Trotzdem im Range-Test prüfen, dass eine 206-Antwort kein `Content-Encoding` hat.
- **H8 iOS (I3/I4):** MapKit braucht keine Kacheln von uns, nutzt aber `map_listings` und `set_listing_location` mit `p_point` unverändert. Die Hinweise aus B1 b/c und A8 (Stapel) gelten dort genauso. Im CHANGELOG als Lücke vermerken.
- **H9 Commit-Reihenfolge** (je grün, Tests mit dem Feature statt gesammelt am Ende):
  1. Plan, ADR 016 mit B1 (Entscheidung des Nutzers), SPEC v0.8, Glossar
  2. Migration `regions.area_km2` (falls B1 a), `map_point` mit Trigger, Index und Meta-Test (B2), `bbox` im Filter mit Fixture, Bedingungs-Funktion für beide RPCs (A4); pgTAP; Typen
  3. Migration `map_listings`, `point`/`approx` in `listing_card`, Zähler bei entferntem Punkt (A6); pgTAP; Integration
  4. Migration `set_listing_location` mit `p_point` (B3); pgTAP; Service und Server Action mit Vitest (A7), noch ohne Karte
  5. Web: Abhängigkeiten, CSP mit Worker-Datei (A2), Stil-Skript, Glyphs, Dev-Route und `map:download` (A1), Fixture-Kacheln, Kartenkomponente mit WebGL-Smoke-Test
  6. Web: Kartenansicht in Listen, `/api/map`, Bereichssuche, Stapel-Kurzkarte; E2E a/b
  7. Web: Karte am Detail; Bundle-Test (A9)
  8. Web: Punktwahl im Assistenten mit Tastatur (A8) und Hinweisen (B1 b); E2E
  9. Querschnitt-E2E (Netzwerk, CSP, axe), CHANGELOG, ADR 016 final, M10-Checkliste ergänzt

## 11. Eingearbeitet (2026-11-01)
- **Nutzer-Entscheidungen zu B1:** a) keine Punktwahl in Kreisen unter 400 km² (`regions.area_km2`, `app_settings.listing_location_min_district_km2`); b) Hinweis im Assistenten ab dem zweiten Punkt eines Besitzers in einer anderen Zelle desselben Kreises; c) Restrisiko „zwei Schlüssel“ in ADR 006 und 016 dokumentiert, Hinweis beim Kreiswechsel.
- **B1–B3** und die Antworten aus 10.1 stehen verbindlich in ADR 016. Abschnitte 3–9 gelten nur, soweit Abschnitt 10 und ADR 016 nichts anderes sagen. Insbesondere: `map_point` als `geometry`, lesbar und nur vom Trigger geschrieben; keine eigene Rundung; Kacheln von der eigenen Origin mit `MAP_TILES_FILE` zur Laufzeit statt `NEXT_PUBLIC_MAP_TILES_URL`; `worker-src 'self'`; Parameter `view=map` und `bbox=`.
- SPEC v0.8: 7.10 entschieden, `map_point` und `area_km2` (3.1), Regel kleine Kreise (3.3), Karte in M9, ODbL der Basiskarte in 7.2. ADR 006 nachgetragen, Glossar „Karte“.
- **Commit-Reihenfolge** nach H9 (ersetzt Abschnitt 9):
  1. Plan, ADR 016, SPEC v0.8, Glossar
  2. Migration `regions.area_km2`, `map_point` mit Trigger, Index und Meta-Test, `bbox` im Filter mit Fixture, gemeinsame Bedingungsfunktion; pgTAP; Typen
  3. Migration `map_listings`, `point`/`approx` in `listing_card`, Zähler bei entferntem Punkt; pgTAP; Integration
  4. Migration `set_listing_location` mit `p_point` und Regel kleine Kreise; pgTAP; Service und Server Action mit Vitest, noch ohne Karte
  5. Web: Abhängigkeiten, CSP mit Worker-Datei, Stil-Skript, Glyphs, Dev-Route, `map:download`, Fixture-Kacheln, Kartenkomponente mit WebGL-Smoke-Test
  6. Web: Kartenansicht in Listen, `/api/map`, Bereichssuche, Stapel-Kurzkarte; E2E a/b
  7. Web: Karte am Detail; Bundle-Test
  8. Web: Punktwahl im Assistenten mit Tastatur und Hinweisen; E2E
  9. Querschnitt-E2E (Netzwerk, CSP, axe), CHANGELOG, ADR 016 final, M10-Checkliste
- Nach jedem Commit: Push und CI prüfen.
