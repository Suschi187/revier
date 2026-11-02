# ADR 016: Karte im Web

Status: angenommen (M6, Plan `docs/plans/M6-plan.md` mit Architekt-Review, Freigabe durch den Nutzer 2026-11-01)

## Kontext
SPEC 6 M6: MapLibre mit Clustern, Bereichssuche, verfremdete Punkte. Akzeptanz: Die Karte zeigt nur verfremdete Positionen, ein Klick öffnet das Detail.

Nutzer-Entscheidungen 2026-11-01:
- Kacheln selbst gehostet, ohne Dritte (SPEC 7.10). M9 wird angepasst.
- Die Punktwahl im Assistenten gehört zu M6.
- Keine Punktwahl in Kreisen unter 400 km².
- Hinweis ab dem zweiten Punkt eines Besitzers in einem Kreis.

Grundtatsache: `anon` und `authenticated` lesen die ganze Tabelle `listings`. Der verfremdete Punkt `display_location` und `owner_id` aller öffentlichen Anzeigen sind daher abrufbar. Die Lage schützt allein die Verfremdung (ADR 006). Grenzen an der Karten-RPC begrenzen nur Last.

## Entscheidung

### Bedrohungsmodell (Review B1)
**Was ein Punkt verrät**
- Die wahre Lage rastet auf eine 1-km-Zelle (EPSG:3035) ein. Der öffentliche Punkt liegt 3–5 km davon entfernt, in einer Richtung, die je Besitzer und Kreis fest ist.
- Ohne weiteres Wissen liegt die wahre Lage auf einem Ring von 3–5 km um den Punkt, etwa 50 km².
- Mit der Unschärfe der Zelle (halbe Diagonale ≈ 0,71 km) sind es 2,29–5,71 km, etwa 86 km².

**Randeffekt**
- Der Kreis ist öffentlich. Nur der Teil des Rings im Kreis kommt in Frage.
- Bei kleinen Kreisen und bei Punkten nahe der Kreisgrenze ist das ein Bruchteil des Rings.
- Liegt der Punkt außerhalb des Kreises, zeigt das zusätzlich die Richtung des Versatzes.
- Gegenmaßnahme: In Kreisen unter `listing_location_min_district_km2` (400 km², `app_settings`) ist kein Punkt erlaubt (`23514`, `hint = location.point.small_district`). Die Karte zeigt dort den Kreismittelpunkt.
- Die Fläche steht als Skalar `regions.area_km2` aus denselben amtlichen Quellen wie die Regionen (ADR 007), ohne Polygone. Die betroffenen Kreise und die zehn kleinsten mit Ring ∩ Kreis stehen unten unter „Zahlen“ (aus Commit 2).

**Mehrere Zellen eines Besitzers**
- Alle Anzeigen eines Besitzers in einem Kreis teilen den Versatz V, und `owner_id` ist öffentlich.
- Jede Anzeige verlangt „Punkt minus V liegt im Kreis“. Je weiter die Reviere eines Besitzers im Kreis verteilt sind, desto enger wird V und damit jede Lage.
- Gegenmaßnahme: Hat der Besitzer im selben Kreis schon eine Anzeige mit Punkt in einer anderen Zelle, zeigt der Assistent vor dem Speichern einen Hinweis. Das Speichern bleibt möglich.

**Zwei Schlüssel für ein Revier (Restrisiko)**
- Ein Revier an der Kreisgrenze mit Anzeigen in beiden Kreisen, oder ein Kreiswechsel, dessen alter Punkt in Caches oder Archiven steht, ergibt zwei Ringe.
- Diese schneiden sich in zwei Linsen von wenigen km².
- Das ist dokumentiert (auch in ADR 006). Der Assistent nennt es beim Kreiswechsel kurz.

**PLZ-Präfix**
- Die zwei Ziffern (ADR 012) verengen nur dort, wo eine Leitgebietsgrenze den Kreis teilt.
- Die volle PLZ bleibt nie öffentlich.

### Kartenpunkt `map_point` (Review B2)
- `listings.map_point geometry(Point, 4326)` = `coalesce(display_location, Mittelpunkt des Kreises)`.
- Gesetzt nur vom Trigger `listings_zzz_map_point` (BEFORE INSERT OR UPDATE ohne Spaltenliste). Er läuft nach `listings_zz_blur_location` und sieht nie den Eingabepunkt. Direkte Schreibversuche überschreibt er.
- Lesbar wie `display_location` (Tabellen-SELECT). Schreibbar nur durch den Trigger. Nicht im Inhalts-Hash, nicht im Guard.
- Teil-Index `gist (map_point) where status = 'active'`.
- `geometry` statt `geography`: `&&` mit `ST_MakeEnvelope` trifft genau das Rechteck der Karte.
- Ändert eine Migration `regions.centroid`, rechnet sie `map_point` nach (ADR 007).

### Punkt setzen (Review B3)
- RPC `set_listing_location(p_listing_id, p_region_id, p_postal_code, p_place_name, p_point text default 'keep', p_lat, p_lng)` mit `p_point` ∈ `keep | set | clear`.
  - Die alte Signatur wird entfernt, nicht überladen.
  - Kreis und Punkt stehen in einem UPDATE.
  - `set` verlangt endliche Werte (−90..90, −180..180), sonst `22023`, `hint = point`.
  - Fehler ohne Koordinaten.
- Das Formular sendet `keep` als Vorgabe. `set` nur nach einer Aktion des Nutzers, `clear` nur über „Punkt entfernen“.
- Der gespeicherte Punkt wird **nie** als Eingabe vorbelegt. Sonst verschiebt jedes Speichern ihn erneut um 3–5 km.
- Ausgegeben wird überall genau der gespeicherte Wert, ohne eigene Rundung.

### Filter `bbox` und Karten-RPC
- `bbox: [west, south, east, north]` additiv im Filterformat v1 (ADR 015).
  - Vier endliche Zahlen, `west < east`, `south < north`, höchstens 30° je Achse. Kein Überqueren der Datumsgrenze.
  - Das Web rundet kanonisch auf 4 Nachkommastellen (Westen und Süden ab, Osten und Norden auf).
  - Treffer, wenn `map_point` im Rechteck liegt. Eine Anzeige ohne Punkt zählt nur, wenn der Kreismittelpunkt im Rechteck liegt.
  - URL-Parameter `bbox=w,s,e,n`. Ansicht `view=map` (kein Filter, mit Query `noindex`).
- Eine gemeinsame private Bedingungsfunktion für `search_listings` und `map_listings`, keine Kopie.
- `public.map_listings(p_filters)`: `security invoker`, `bbox` Pflicht, Sichtbarkeit über `listing_is_public`.
  - Höchstens 2000 Punkte (`published_at desc, id desc`) und `truncated`.
  - Je Punkt `id`, `lng`, `lat`, `kind`, `direction`, `title`, Preisfelder, `district_code`, `approx` (`point` | `district`).
  - Ohne `owner_id`, PLZ und Präfix.
- `listing_card` bekommt `point` und `approx` (Suche, Favoriten, Anbieter).
- Sofortige Wirkung: Der Cache-Zähler (ADR 015) steigt zusätzlich, wenn ein Punkt entfernt wird.

### Auslieferung und Web
- **Kacheln:**
  - Eine PMTiles-Datei (Protomaps-Basemap aus OpenStreetMap) von der eigenen Origin unter `/tiles/<name>.pmtiles`.
  - Den Dateinamen liest der Server zur Laufzeit aus `MAP_TILES_FILE`.
  - Lokal liefert ein Route Handler die Datei aus `MAP_TILES_DIR` mit Range-Requests (206, 416, HEAD, Namensmuster, Pfad im Verzeichnis).
  - In Prod liefert der Objektspeicher bzw. das CDN den Pfad vor Next aus (M10).
  - `npm run map:download` erzeugt den Ausschnitt DE+AT. Quelle, Version und Prüfsumme stehen in `SOURCES.md`.
- **Daten für die Karte:**
  - `GET /api/map` übersetzt die Filter wie die Seiten und liefert GeoJSON.
  - `Cache-Control: private, no-store`, kein Daten-Cache, kein CORS, Fehler 400/502.
- **CSP:** `worker-src 'self'` mit der CSP-Variante von MapLibre, kein `blob:`. Die Admin-CSP bleibt unverändert, der Admin-Bereich hat keine Karte.
- **Stil und Schriften:**
  - Der Stil wird je Sprache vorab erzeugt (`@protomaps/basemaps` nur als devDependency), ohne fremde URLs und ohne Sprites.
  - Schriften: Noto (OFL) mit Latin und Latin Extended-A.
  - Alles unter `/static/map/` mit langen Cache-Headern.
- **Bundle:** MapLibre nur per `dynamic(…, { ssr: false })`. In Listen erst mit `view=map` geladen, am Detail erst auf Klick oder bei Sicht. Ein Test prüft, dass Seiten ohne Karte kein MapLibre laden.
- **Barrierefreiheit:**
  - Punktwahl per Fadenkreuz in der Kartenmitte und Button.
  - Einzelpunkte als HTML-Marker-Buttons.
  - Gleiche Koordinaten öffnen eine Kurzkarte mit allen Anzeigen an dieser Stelle.
  - Fokusführung, `aria-live`, `prefers-reduced-motion`.
  - Die Trefferliste bleibt die vollständige Alternative.
- **Keine Koordinaten** in Logs, URLs, Fehlern, JSON-LD, Meta-Tags oder Sitemap. Keine Geolocation.

### Lizenzen und Datenschutz
- **Attribution:** immer sichtbar, „© OpenStreetMap-Mitwirkende“ (ODbL, Link) und „Protomaps“. Die Seite „Datenquellen“ (M9) nennt den Build.
- **Lizenzfragen:** Die ODbL-Frage geht an den Anwalt (SPEC 7.2). Die Lizenzen aller neuen Pakete inklusive transitiver Abhängigkeiten stehen im CHANGELOG.
- **Einwilligung:** Maßstab ist „kein eigener Verantwortlicher“. Eigene Auslieferung oder ein Auftragsverarbeiter in der EU mit AVV braucht keine Einwilligung. Ein Anbieter, der als eigener Verantwortlicher handelt oder außerhalb der EU verarbeitet, braucht eine Einwilligung (Laden erst nach Zustimmung oder Klick). Das berücksichtigt M9.
- **Datenschutzerklärung:** Sie nennt die Karte und einen möglichen Cache Storage des Browsers (Ergebnis der Prüfung hier nachgetragen).
- **Logs (M10):** Zugriffslogs auf die Kartendatei ohne IP oder mit höchstens 7 Tagen Aufbewahrung. Die Byte-Bereiche verraten die betrachtete Kachel und damit das Revier, in der Größenordnung des Versatzes.

## Zahlen
Flächen aus `regions.area_km2` (VG250 und Statistik Austria, Stand 01.01.2026, EPSG:3035):

| | unter 400 km² | Kreise gesamt |
|---|---|---|
| DE | 110 | 401 |
| AT | 20 | 94 |
| zusammen | 130 (26 %) | 495 |

Ring der möglichen wahren Lage: etwa 86 km² (2,29–5,71 km). In den zehn kleinsten Kreisen ist der ganze Kreis kleiner als der Ring. Ring ∩ Kreis ist dort höchstens die Kreisfläche, also weniger als die Hälfte des Rings, bei Rust nur ein Viertel:

| Kreis | km² |
|---|---|
| AT-102 Rust (Stadt) | 20,0 |
| AT-402 Stadt Steyr | 26,6 |
| DE-09662 Schweinfurt (Stadt) | 35,7 |
| DE-09163 Rosenheim (Stadt) | 37,0 |
| DE-09762 Kaufbeuren | 40,4 |
| DE-09565 Schwabach | 40,8 |
| AT-101 Eisenstadt (Stadt) | 42,9 |
| DE-07318 Speyer | 42,9 |
| DE-07311 Frankenthal (Pfalz) | 43,8 |
| DE-06413 Offenbach am Main | 45,3 |

Bei 400 km² ist der Kreis etwa fünfmal so groß wie der Ring. Ein Punkt nahe der Grenze verengt weiter, aber nicht mehr auf einen Bruchteil des Kreises. Kartenausschnitt DE+AT (Protomaps-Build 20261101, Zoom 0–12): 1,2 GB; Testausschnitt bis Zoom 7: 7,3 MB (Prüfsummen in `web/scripts/MAP-SOURCES.md`). Für M10: eine Datei dieser Größe je Build im Objektspeicher, abgerufen nur in Byte-Bereichen.

## Folgen
- iOS (I3, I4) nutzt `map_listings` und `set_listing_location` mit `p_point` unverändert. MapKit braucht keine Kacheln von uns. Die Hinweise zu mehreren Punkten und zu gestapelten Anzeigen gelten dort ebenso.
- M10: Produktions-Hosting der Kartendatei, mit allen folgenden Anforderungen:
  - Range und stabiler ETag, `immutable`
  - EU mit AVV
  - Logs wie oben
  - Rate-Limit bzw. WAF für `/api/map` und `/tiles/`
- Mehr als 2000 Anzeigen im Ausschnitt: Zählungen je Rasterzelle statt Punkten (Review H1), spätestens bei 1000 Anzeigen.
