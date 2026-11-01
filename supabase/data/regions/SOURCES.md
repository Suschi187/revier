# Quellen der Regionendaten

Erzeugt mit `generate.py` am 2026-10-29. Ins Repo kommen nur Namen, Codes und je ein Punkt
(`ST_PointOnSurface`, gerundet auf 4 Nachkommastellen). Polygone werden nicht weitergegeben.
Siehe docs/adr/007-regionendaten.md.

## Deutschland
- **Datensatz:** BKG, Verwaltungsgebiete 1:250 000 (VG250), Ebenen, Stand 01.01.2026
- **Datei:** `vg250_01-01.utm32s.gpkg.ebenen.zip`, MD5 `0534985f15355c591feacedd3a2b1d5d` (Punkte, 2026-10-29). Für die Flächen (2026-11-01) neu geladen: MD5 `912ebecfc58bade695cf31271f4e0e85`, gleicher Stand 01.01.2026 (`dokumentation/aktualitaet.txt`), alle 401 Schlüssel gleich
- **URL:** https://daten.gdz.bkg.bund.de/produkte/vg/vg250_ebenen_0101/aktuell/
- **Verwendet:** `vg250_lan` (16 Länder) und `vg250_krs` (401 Kreise und kreisfreie Städte), jeweils `GF = 4`
- **Lizenz:** Datenlizenz Deutschland – Namensnennung – Version 2.0 (dl-de/by-2-0), siehe `dokumentation/nutzungsbedingungen_vg250.pdf` im Archiv
- **Pflichtvermerk:** © GeoBasis-DE / BKG (2026)

## Österreich
- **Datensatz:** Statistik Austria, Gliederung Österreichs in Politische Bezirke, Stand 01.01.2026
- **URL (WFS):** https://www.statistik.gv.at/gs-open/GEODATA/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=GEODATA:STATISTIK_AUSTRIA_POLBEZ_20260101&outputFormat=application/json
- **Metadaten:** https://data.statistik.gv.at/web/meta.jsp?dataset=OGDEXT_POLBEZ_1
- **Verwendet:** 94 politische Bezirke. Wien nur als Ganzes (Kennziffer 900); die Gemeindebezirke 901–923 sind keine eigenen Kreise. Die Punkte der 9 Bundesländer werden aus der Vereinigung ihrer Bezirke berechnet.
- **Lizenz:** Creative Commons Namensnennung 4.0 International (CC BY 4.0)
- **Pflichtvermerk:** Datenquelle: Statistik Austria

## Namen
- Kreise und Bezirke tragen in allen Sprachen ihren amtlichen deutschen Namen. Bei gleichnamigen deutschen Kreisen kommt ein Zusatz dazu, „(Stadt)“ bzw. „(Landkreis)“.
- Ländernamen in en/cs/pl sind Exonyme, eingetragen in `generate.py`. Sie sind **ungeprüft** (SPEC 7.6).

## Flächen (ADR 016)
Erzeugt mit `generate.py --areas-out` am 2026-11-01 (EPSG:3035, km², 1 Nachkommastelle): `supabase/migrations/20261102100100_regions_area_data.sql`. Die Migration bricht ab, wenn eine Region ohne Fläche bleibt.

## Neu erzeugen
```sh
supabase start   # Docker-CLI muss im PATH sein (generate.py ruft `docker exec`)
python3 -I supabase/data/regions/generate.py --de <pfad>/DE_VG250.gpkg --at <pfad>/polbez.geojson \
  --out supabase/migrations/<neuer-timestamp>_regions_data.sql
```
Bei Gebietsreformen wird eine **neue** Migration erzeugt, die bestehenden Zeilen werden angepasst und nicht gelöscht (`on delete restrict`).
