# Quellen der Kartendateien (ADR 016)

## Basiskarte (nicht im Repo)
- **Daten:** OpenStreetMap-Mitwirkende, Open Database License (ODbL) 1.0. Pflichtvermerk in der Karte: „© OpenStreetMap-Mitwirkende“ mit Link auf https://www.openstreetmap.org/copyright.
- **Aufbereitung:** Protomaps Basemap, täglicher Build `https://build.protomaps.com/<YYYYMMDD>.pmtiles` (Schema 4.15.2), Liste unter https://build-metadata.protomaps.dev/builds.json.
- **Ausschnitt:** `npm run map:download` schneidet DE+AT (`5.8,45.8,17.2,55.1`) bis Zoom 12 aus dem Build `20261101`, `--fixture` bis Zoom 7. Ergebnis unter `web/.cache/map/` (in `.gitignore`).
- **Größe und SHA-256** des Ausschnitts gibt das Skript aus. Sie gehören hier und in ADR 016 eingetragen, bevor M10 den Speicher plant:
  - `basemap-20261101.pmtiles`: 1 250 842 409 Bytes (1,2 GB), SHA-256 `03184e51223b362f5b40c81fd074713a3144df2936c4219258976522377ab287` (2026-11-02)
  - `basemap-fixture.pmtiles`: 7 608 313 Bytes (7,3 MB), SHA-256 `6a955f6a8fbd2de827f26c15e27c3a506d1e1d6ccda26522564347da0f4da505` (2026-11-02)

## Werkzeug
- **pmtiles-CLI** (go-pmtiles) v1.31.2, BSD-3-Clause, https://github.com/protomaps/go-pmtiles/releases/tag/v1.31.2.
- Das Release veröffentlicht keine Prüfsummen. Die SHA-256 der Archive wurden beim ersten Laden am 2026-11-02 berechnet und stehen fest in `map-download.mjs`. Weicht ein Download ab, bricht das Skript ab.

## Stil, Schriften, Worker (im Repo bzw. erzeugt)
- **Stil:** `@protomaps/basemaps` 5.7.2 (BSD-3-Clause, devDependency), erzeugt mit `npm run map:style` als `public/static/map/style-<lang>.v5.7.2.json`. Ohne Sprites und ohne fremde URLs.
- **Schriften:** Noto Sans Regular, Medium, Italic aus https://github.com/protomaps/basemaps-assets (Commit `028c18f713baecad011301ff7a69acc39bcc2ae7`), Bereiche 0-255, 256-511 (Latin Extended-A für cs/pl) und 8192-8447. SIL Open Font License 1.1, Text in `public/static/map/fonts/OFL.txt`.
- **Worker:** `maplibre-gl` 6.15.0 (BSD-3-Clause), vor `dev` und `build` kopiert nach `public/static/map/maplibre-<version>/` (`npm run map:worker`, in `.gitignore`).
