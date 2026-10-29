# Quellen der Postleitzahlen

Erzeugt mit `generate.py` am 2026-10-29 (Migration `20261029104300_postal_codes_data.sql`). Ins Repo kommen
nur PLZ, die Zuordnung zu Kreisen/Bezirken und Ortsnamen. Polygone werden nicht weitergegeben.
Siehe docs/adr/012-postleitzahlen.md.

## Deutschland: PLZ-Gebiete aus OpenStreetMap
- **Abfrage:** Overpass API (`https://overpass-api.de/api/interpreter`), je Bundesland
  `area["ISO3166-2"="DE-<Land>"]["admin_level"="4"]->.a;relation["boundary"="postal_code"](area.a);out geom;`
- **Datenstand OSM:** 2026-10-29T16:31:11Z
- **Ortsnamen:** aus dem Tag `note` der Relation („80331 München“)
- **Lizenz:** Open Database License 1.0 (ODbL). **Pflichtvermerk:** © OpenStreetMap-Mitwirkende
  (https://www.openstreetmap.org/copyright). Die erzeugte PLZ-Tabelle ist eine abgeleitete Datenbank und
  steht ebenfalls unter ODbL (Download-Pflicht, ADR 012).
- **SHA-256 der Exporte (erste 16 Zeichen):**
  - `osm-DE-BB.json` 3b8ab1bf46668b1e
  - `osm-DE-BE.json` 3703781f9accbc1e
  - `osm-DE-BW.json` 93dfd391ab0d606b
  - `osm-DE-BY.json` 81be1b62a0f5ae24
  - `osm-DE-HB.json` 836c59d896f211d4
  - `osm-DE-HE.json` 1058fb108ceca401
  - `osm-DE-HH.json` 609319c82f27ae1c
  - `osm-DE-MV.json` a8799776f00f497e
  - `osm-DE-NI.json` f6af7a453b40b109
  - `osm-DE-NW.json` f7baa66a1fa4e187
  - `osm-DE-RP.json` d1b23364bbf51114
  - `osm-DE-SH.json` 33c7c512b142e3af
  - `osm-DE-SL.json` d6e4095a914e638d
  - `osm-DE-SN.json` 4d0cfbdb9b74adec
  - `osm-DE-ST.json` 988b0a5a83741a6f
  - `osm-DE-TH.json` edbb90517d847b3c

## Deutschland: Kreisgrenzen für die Verschneidung
- **Datensatz:** BKG VG250 (Ebenen, Stand 01.01.), dieselbe Quelle wie `regions` (ADR 007), `vg250_krs` mit `GF = 4`
- **Datei:** `vg250_01-01.utm32s.gpkg.ebenen.zip`, MD5 `912ebecfc58bade695cf31271f4e0e85` (abgerufen 2026-10-29;
  die MD5 weicht von der Datei der Regionen ab, alle 401 Kreisschlüssel stimmen überein, geprüft vom Generator)
- **Lizenz:** dl-de/by-2-0, **Pflichtvermerk:** © GeoBasis-DE / BKG (2026)
- **Regel:** Eine PLZ gehört zu einem Kreis, wenn mindestens 1 % ihrer Fläche oder 0,5 km² darin liegen, und
  immer zum Kreis mit dem größten Anteil. Ergebnis: 15 785 Schnittpaare vor, 8 975 nach der Schwelle.

## Österreich
- **Datensatz:** Statistik Austria, Gemeindeliste mit Postleitzahlen, Gebietsstand 2026
- **URL:** https://www.statistik.at/verzeichnis/reglisten/gemliste_knz.csv
- **SHA-256:** `38adfdc919cac32a26bd2e731db8b9d18351179c72ffdc7a9734620f915b8919`
- **Verwendet:** „PLZ des Gem.Amtes“ und „weitere Postleitzahlen“ je Gemeinde; Bezirk = erste drei Ziffern der
  Gemeindekennziffer, Wien als Ganzes (900). Ortsname ist der Gemeindename.
- **Lizenz:** CC BY 4.0, **Pflichtvermerk:** Datenquelle: Statistik Austria

## Ergebnis
DE 8 170 PLZ (778 in mehreren Kreisen), AT 2 232 PLZ (304 in mehreren Bezirken), 12 PLZ ohne Ortsnamen.
Jeder Kreis und Bezirk hat mindestens eine PLZ (Abbruchprüfung im Generator, pgTAP `13_postal_codes`).

## Korrekturen
`overrides.csv` (Spalten `action` = add/remove, `country`, `code`, `region_code`, `reason`). Meldet ein Nutzer, dass
eine echte Kombination abgelehnt wird, kommt hier eine Zeile mit Begründung dazu und die Daten werden neu erzeugt.

## Neu erzeugen
```sh
supabase start   # Docker-CLI im PATH, alle anderen Migrationen eingespielt
python3 -I supabase/data/postal_codes/generate.py --osm-dir <dir> --vg250 <pfad>/DE_VG250.gpkg \
  --at <pfad>/gemliste_knz.csv --overrides supabase/data/postal_codes/overrides.csv \
  --out supabase/migrations/<neuer-timestamp>_postal_codes_data.sql
```
Eine Aktualisierung kommt als **neue** Migration, die bestehende Zeilen ersetzt (Referenzdaten ohne FK von Anzeigen).
