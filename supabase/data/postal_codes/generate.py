#!/usr/bin/env python3
"""Erzeugt die Migration mit den Postleitzahlen DE und AT (docs/adr/012-postleitzahlen.md).

Nur Standardbibliothek. Die Verschneidung rechnet PostGIS in der lokalen Supabase-Datenbank
(temporäre Tabellen); ins Repo kommen nur PLZ, Zuordnung zu Kreisen und Ortsnamen, keine Polygone.

Eingaben (siehe SOURCES.md):
  --osm-dir  Overpass-Exporte osm-DE-<Land>.json (relation["boundary"="postal_code"], out geom)
  --vg250    DE_VG250.gpkg aus BKG VG250 (Ebenen, UTM32s, GeoPackage)
  --at       gemliste_knz.csv von Statistik Austria (Gemeinden mit PLZ)
  --overrides overrides.csv (manuelle Korrekturen, mit Begründung)

Aufruf (Supabase läuft lokal, alle Migrationen bis auf die erzeugte sind eingespielt):
  python3 -I supabase/data/postal_codes/generate.py --osm-dir <dir> --vg250 <pfad>/DE_VG250.gpkg \\
    --at <pfad>/gemliste_knz.csv --overrides supabase/data/postal_codes/overrides.csv \\
    --out supabase/migrations/<timestamp>_postal_codes_data.sql
"""

import argparse
import collections
import csv
import glob
import json
import re
import sqlite3
import subprocess

PSQL = ["docker", "exec", "-i", "supabase_db_revier", "psql", "-U", "postgres", "-qAt", "-v", "ON_ERROR_STOP=1", "-F", "\t"]

# Eine PLZ gehört zu einem Kreis, wenn mindestens dieser Anteil ihrer Fläche oder diese Fläche darin
# liegt. Ohne Schwelle hinge fast jede Rand-PLZ wegen Digitalisierungsungenauigkeit auch am Nachbarkreis.
MIN_SHARE = 0.01
MIN_AREA_M2 = 500_000

# Abbruchprüfungen: deutlich weniger Daten heißt, ein Export ist unvollständig.
MIN_DE_CODES = 8000
MIN_AT_CODES = 2000


def gpkg_wkb(blob: bytes) -> bytes:
    if blob[:2] != b"GP":
        raise ValueError("kein GeoPackage-Geometrie-Blob")
    envelope = (blob[3] >> 1) & 0b111
    return blob[8 + {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}[envelope]:]


def sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def copy_field(value: str) -> str:
    return value.replace("\\", "\\\\").replace("\t", " ").replace("\n", " ")


def place_names(note: str, code: str) -> list[str]:
    """`note` hat die Form „80331 München“, manchmal mehrere Orte mit Komma oder Schrägstrich."""
    rest = note.strip()
    if rest.startswith(code):
        rest = rest[len(code):]
    names = [n.strip(" ,-") for n in re.split(r",|/|;", rest)]
    return sorted({n for n in names if n and not n.isdigit() and len(n) <= 100})


def read_osm(osm_dir: str):
    """→ Zeilen (relation, plz, rolle, WKT-Linie) und {plz: {ortsnamen}}."""
    lines, names, seen = [], collections.defaultdict(set), set()
    files = sorted(glob.glob(f"{osm_dir}/osm-DE-*.json"))
    if len(files) != 16:
        raise SystemExit(f"Erwartet 16 Overpass-Exporte, gefunden {len(files)}")
    for path in files:
        for element in json.load(open(path, encoding="utf-8"))["elements"]:
            rel, tags = element["id"], element.get("tags", {})
            code = tags.get("postal_code", "")
            if rel in seen or not re.fullmatch(r"\d{5}", code):
                continue
            seen.add(rel)
            names[code].update(place_names(tags.get("note", ""), code))
            for member in element.get("members", []):
                geometry = member.get("geometry")
                if member.get("type") != "way" or not geometry or len(geometry) < 2:
                    continue
                wkt = "LINESTRING(" + ",".join(f"{p['lon']} {p['lat']}" for p in geometry) + ")"
                lines.append((rel, code, member.get("role") or "outer", wkt))
    return lines, names


def read_vg250(path: str):
    db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    srs = db.execute("select srs_id from gpkg_geometry_columns where table_name = 'vg250_krs'").fetchone()[0]
    rows = db.execute("select ags, geom from vg250_krs where gf = 4 order by ags").fetchall()
    return srs, [(ags, gpkg_wkb(blob).hex()) for ags, blob in rows]


def intersect_de(lines, districts, srs):
    """→ ({plz: {ags}}, Statistik)."""
    script = [
        "create temp table m (rel bigint, code text, role text, wkt text);",
        "copy m from stdin;",
        *("\t".join((str(rel), code, role, copy_field(wkt))) for rel, code, role, wkt in lines),
        "\\.",
        "create temp table k (ags text, geom extensions.geometry);",
        "copy k from stdin;",
        *(f"{ags}\t{hexwkb}" for ags, hexwkb in districts),
        "\\.",
        f"update k set geom = extensions.st_setsrid(geom, {srs});",
        "create index on k using gist (geom);",
        # Fläche je Relation aus ihren Wegen; mehrere Relationen derselben PLZ werden vereinigt.
        "create temp table p as"
        " select code, extensions.st_makevalid(extensions.st_union(a)) geom from ("
        "  select rel, code, extensions.st_buildarea(extensions.st_collect("
        f"   extensions.st_transform(extensions.st_geomfromtext(wkt, 4326), {srs}))) a"
        "  from m group by rel, code) r where a is not null group by code;",
        "create index on p using gist (geom);",
        "select 'stat', 'relationen', count(distinct rel)::text from m;",
        "select 'stat', 'plz_mit_flaeche', count(*)::text from p;",
        "select 'stat', 'relationen_ohne_flaeche', count(*)::text from ("
        "  select rel from m group by rel having extensions.st_buildarea(extensions.st_collect("
        "   extensions.st_geomfromtext(wkt, 4326))) is null) x;",
        "select 'pair', p.code, k.ags, round((extensions.st_area(extensions.st_intersection(p.geom, k.geom))"
        "  / nullif(extensions.st_area(p.geom), 0))::numeric, 5)::text || ':' ||"
        "  round(extensions.st_area(extensions.st_intersection(p.geom, k.geom)))::text"
        " from p join k on extensions.st_intersects(p.geom, k.geom);",
    ]
    out = subprocess.run(PSQL, input="\n".join(script) + "\n", capture_output=True, text=True, check=True).stdout
    stats, shares = {}, collections.defaultdict(list)
    for line in out.splitlines():
        kind, a, b, *rest = line.split("\t")
        if kind == "stat":
            stats[a] = int(b)
        elif kind == "pair":
            share, area = rest[0].split(":")
            shares[a].append((b, float(share), float(area)))
    mapping = {}
    for code, candidates in shares.items():
        keep = {ags for ags, share, area in candidates if share >= MIN_SHARE or area >= MIN_AREA_M2}
        keep.add(max(candidates, key=lambda c: c[1])[0])  # jede PLZ mindestens im Kreis mit dem größten Anteil
        mapping[code] = keep
    stats["paare_vor_schwelle"] = sum(len(c) for c in shares.values())
    stats["paare_nach_schwelle"] = sum(len(v) for v in mapping.values())
    return mapping, stats


def read_at(path: str):
    """Gemeinde → PLZ des Gemeindeamts und weitere PLZ; Bezirk = erste drei Ziffern der Kennziffer."""
    rows = list(csv.reader(open(path, encoding="utf-8"), delimiter=";"))
    mapping, names = collections.defaultdict(set), collections.defaultdict(set)
    for row in rows:
        if not row or not row[0].isdigit():
            continue
        district = "900" if row[0].startswith("9") else row[0][:3]
        for code in [row[4], *row[5].split()]:
            if re.fullmatch(r"\d{4}", code):
                mapping[code].add(district)
                names[code].add(row[1].strip())
    return mapping, names


def known_districts() -> set[str]:
    out = subprocess.run(PSQL, input="select code from public.regions where level = 'district';",
                         capture_output=True, text=True, check=True).stdout
    return set(out.split())


def apply_overrides(path: str, data):
    for row in csv.DictReader(open(path, encoding="utf-8")):
        if not row["action"] or row["action"].startswith("#"):
            continue
        key = (row["country"], row["code"])
        regions = data.setdefault(key, set())
        if row["action"] == "add":
            regions.add(row["region_code"])
        elif row["action"] == "remove":
            regions.discard(row["region_code"])
        else:
            raise SystemExit(f"Unbekannte Aktion in overrides.csv: {row['action']}")


def render(regions_by_code, names_by_code, stats) -> str:
    codes = sorted(regions_by_code)
    lines = [
        "-- GENERIERT von supabase/data/postal_codes/generate.py, nicht von Hand ändern.",
        "-- Quellen und Lizenzen: supabase/data/postal_codes/SOURCES.md (DE: © OpenStreetMap-Mitwirkende, ODbL 1.0;",
        "-- AT: Datenquelle: Statistik Austria, CC BY 4.0). Diese Tabelle steht unter ODbL (ADR 012).",
        "-- " + ", ".join(f"{k} {v}" for k, v in sorted(stats.items())),
        "",
        "insert into public.postal_codes (country, code) values",
        ",\n".join(f"  ('{c}', '{p}')" for c, p in codes) + ";",
        "",
        "insert into public.postal_code_regions (country, code, region_id)",
        "select v.country::public.country_code, v.code, r.id from (values",
        ",\n".join(f"  ('{c}', '{p}', '{r}')" for c, p in codes for r in sorted(regions_by_code[(c, p)])),
        ") as v (country, code, region_code) join public.regions r on r.code = v.region_code and r.level = 'district';",
        "",
        "insert into public.postal_code_places (country, code, place_name) values",
        ",\n".join(f"  ('{c}', '{p}', {sql_literal(n)})" for c, p in codes for n in sorted(names_by_code.get((c, p), ()))) + ";",
        "",
    ]
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--osm-dir", required=True)
    parser.add_argument("--vg250", required=True)
    parser.add_argument("--at", required=True)
    parser.add_argument("--overrides", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    lines, de_names = read_osm(args.osm_dir)
    srs, districts = read_vg250(args.vg250)
    de_mapping, stats = intersect_de(lines, districts, srs)
    at_mapping, at_names = read_at(args.at)

    regions_by_code = {("DE", c): {f"DE-{a}" for a in v} for c, v in de_mapping.items()}
    regions_by_code.update({("AT", c): {f"AT-{d}" for d in v} for c, v in at_mapping.items()})
    names_by_code = {("DE", c): v for c, v in de_names.items()}
    names_by_code.update({("AT", c): v for c, v in at_names.items()})
    apply_overrides(args.overrides, regions_by_code)

    known = known_districts()
    unknown = sorted({r for v in regions_by_code.values() for r in v} - known)
    if unknown:
        raise SystemExit(f"Kreise ohne Eintrag in regions: {unknown[:20]}")
    empty = sorted(k for k, v in regions_by_code.items() if not v)
    if empty:
        raise SystemExit(f"PLZ ohne Kreis: {empty[:20]}")
    covered = {r for v in regions_by_code.values() for r in v}
    uncovered = sorted(known - covered)
    if uncovered:
        raise SystemExit(f"Kreise ohne PLZ: {uncovered}")
    de_count = sum(1 for c, _ in regions_by_code if c == "DE")
    at_count = sum(1 for c, _ in regions_by_code if c == "AT")
    if de_count < MIN_DE_CODES or at_count < MIN_AT_CODES:
        raise SystemExit(f"Zu wenige PLZ: DE {de_count}, AT {at_count}")

    stats.update(
        de_plz=de_count,
        at_plz=at_count,
        de_mehrere_kreise=sum(1 for (c, _), v in regions_by_code.items() if c == "DE" and len(v) > 1),
        at_mehrere_bezirke=sum(1 for (c, _), v in regions_by_code.items() if c == "AT" and len(v) > 1),
        ohne_ortsname=sum(1 for k in regions_by_code if not names_by_code.get(k)),
    )
    with open(args.out, "w", encoding="utf-8") as f:
        f.write(render(regions_by_code, names_by_code, stats))
    print(f"{args.out}: {stats}")


if __name__ == "__main__":
    main()
