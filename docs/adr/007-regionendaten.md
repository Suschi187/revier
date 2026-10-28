# ADR 007: Regionendaten und Lizenzen

Status: angenommen (M1)

## Kontext
SPEC 7.4 (v0.3): Zum Start werden DE und AT vollständig geladen, mit Ländern und Kreisen bzw. Bezirken. Die Daten müssen frei nutzbar sein. Nichts darf von Konkurrenzseiten stammen (CLAUDE.md).

## Entscheidung
- Ebenen:
  - `state`: 16 Länder (DE) und 9 Bundesländer (AT).
  - `district`: Kreise und kreisfreie Städte (DE) sowie Bezirke inklusive Statutarstädte (AT).
  - Stadtstaaten (Berlin, Hamburg, Wien) bekommen eine `state`- und eine `district`-Zeile. Bremen hat zwei Kreise (Bremen, Bremerhaven).
- Codes:
  - `state` nach ISO 3166-2 (`DE-BY`, `AT-9`).
  - `district` als amtlicher Schlüssel mit Länderpräfix (`DE-09162`, `AT-901`).
  - Der Slug wird aus dem deutschen Namen gebildet und ist je Land eindeutig.
- Quellen:
  - Die Quellen werden beim Erzeugen geprüft und in `supabase/data/regions/SOURCES.md` mit Stand, URL und Lizenz vermerkt.
  - DE: BKG Verwaltungsgebiete VG250 (Namen, Schlüssel, Geometrie), Lizenz dl-de/by-2-0, Vermerk „© GeoBasis-DE / BKG (Jahr)“.
  - AT: Statistik Austria, Gliederungen und Geometrie der politischen Bezirke, CC BY 4.0, Vermerk „Datenquelle: Statistik Austria“.
  - Namen in en/cs/pl:
    - Länder: Exonyme, vorerst vom Entwickler gepflegt und als ungeprüft markiert (SPEC 7.6).
    - Kreise und Bezirke: tragen in allen Sprachen den amtlichen deutschen Namen.
- Centroids: Ein Generator-Skript (`supabase/data/regions/generate.py`) berechnet offline mit `ST_PointOnSurface` bzw. dem Shapely-Äquivalent einen Punkt, der sicher in der Fläche liegt. Ins Repo kommen nur Punkte, gerundet auf 4 Nachkommastellen. Polygone landen nicht im Repo.
- Die Daten werden als **Migration** geladen, nicht über `seed.sql`, weil `seed.sql` bei `db push` in die Cloud nicht läuft.
- Ein Trigger verhindert Anzeigen in Regionen, die nicht auf `district`-Ebene liegen. Länder ohne Kreisdaten sind dadurch automatisch gesperrt.

## Alternativen
- Eurostat GISCO/NUTS: Die Grenzen von EuroGeographics sind kommerziell eingeschränkt, und NUTS-3 entspricht in AT nicht den Bezirken.
- OpenStreetMap: Die ODbL verlangt Share-Alike für die abgeleitete Datenbank.

## Folgen
- Eine öffentliche Seite „Datenquellen“ mit den Vermerken ist Pflicht (M5/M9).
- Gebietsreformen erfordern eine neue Migration. Regionen werden nie gelöscht, solange Anzeigen sie nutzen (`on delete restrict`).
- CZ, PL und CH folgen vor dem jeweiligen Marktstart.
