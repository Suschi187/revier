#!/usr/bin/env python3
"""Erzeugt die Migration mit den Postleitzahlen DE und AT (docs/adr/012-postleitzahlen.md).

Nur Standardbibliothek. Die Verschneidung rechnet PostGIS in der lokalen Supabase-Datenbank
(temporäre Tabellen); ins Repo kommen nur PLZ, Zuordnung zu Kreisen und Ortsnamen, keine Polygone.

Eingaben (siehe SOURCES.md), geprüft gegen inputs.sha256:
  --osm-dir  Overpass-Exporte osm-DE-<Land>.json (relation["boundary"="postal_code"], out geom)
  --vg250    DE_VG250.gpkg aus BKG VG250 (Ebenen, UTM32s, GeoPackage)
  --at       gemliste_knz.csv von Statistik Austria (Gemeinden mit PLZ)
  --overrides overrides.csv (manuelle Korrekturen, mit Begründung)
  --update-hashes  neue Eingaben bewusst übernehmen: schreibt inputs.sha256 neu statt abzubrechen

Ortsnamen DE: Gemeinden aus VG250, die einen nennenswerten Teil der PLZ-Fläche bedecken, dazu die
bereinigten Namen aus dem OSM-Tag `note` (Ortsteile). Jeder Name muss `suspicious_name` bestehen.

Aufruf (Supabase läuft lokal, alle Migrationen bis auf die erzeugte sind eingespielt):
  python3 -I supabase/data/postal_codes/generate.py --osm-dir <dir> --vg250 <pfad>/DE_VG250.gpkg \\
    --at <pfad>/gemliste_knz.csv --overrides supabase/data/postal_codes/overrides.csv \\
    --out supabase/migrations/<timestamp>_postal_codes_data.sql
"""

import argparse
import collections
import csv
import glob
import hashlib
import json
import os
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

# Eine Gemeinde wird als Ortsname einer PLZ vorgeschlagen, wenn sie diesen Anteil der PLZ-Fläche bedeckt
# oder dieser Anteil ihrer eigenen Fläche in der PLZ liegt; immer die Gemeinde mit dem größten Anteil.
NAME_MIN_SHARE_OF_CODE = 0.10
NAME_MIN_SHARE_OF_MUNICIPALITY = 0.25

HASHES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "inputs.sha256")
AT_HEADER = ["Gemeindekennziffer", "Gemeindename", "Gemeindecode", "Status", "PLZ des Gem.Amtes", "weitere Postleitzahlen"]


def gpkg_wkb(blob: bytes) -> bytes:
    if blob[:2] != b"GP":
        raise ValueError("kein GeoPackage-Geometrie-Blob")
    envelope = (blob[3] >> 1) & 0b111
    return blob[8 + {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}[envelope]:]


def sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def copy_field(value: str) -> str:
    return value.replace("\\", "\\\\").replace("\t", " ").replace("\n", " ")


# Bereinigung der OSM-Notizen (QA M3 F2): Füllwörter am Anfang, „u.a.“ am Ende.
LEADING_WORDS = re.compile(r"^(?:und|incl\.?|inkl\.?|sowie|für|mit|bzw\.?)\s+", re.I)
TRAILING_WORDS = re.compile(r"\s*(?:u\.\s?a\.?|usw\.?|etc\.?)$", re.I)
NAME_SHAPE = re.compile(r"[A-ZÄÖÜ][A-Za-zÄÖÜäöüß.'’/ -]*(?: \([A-Za-zÄÖÜäöüß.' -]+\))?")
# Wörter aus Sätzen und Erläuterungen; nur in Namen mit mehreren Wörtern verdächtig („Ohne“ ist eine Gemeinde).
SENTENCE_WORDS = re.compile(
    r"\b(?:ist|sind|wurde|aber|gehört|bestehend|dazu|noch|weiterhin|jetzt|incl|inkl|different|is|the|from|and|of"
    r"|Gde|Adressen|Postleitzahl|PLZ|aufgelöst|gültig|teilweise|Teile?|ohne|außer|siehe|Bereich|Abweichung)\b", re.I)


def suspicious_name(name: str) -> bool:
    """Abbruchprüfung für jeden erzeugten Ortsnamen; dieselbe Regel prüft pgTAP `13_postal_codes`."""
    return (
        not 2 <= len(name) <= 60
        or not NAME_SHAPE.fullmatch(name)
        or (" " in name and bool(SENTENCE_WORDS.search(name)))
        or bool(re.search(r"u\.\s?a\.|\.\.|[a-zäöüß]{4}\. [A-ZÄÖÜ]", name))
        or bool(re.fullmatch(r"[^\s/]+\.", name))  # abgetrennter Zusatz wie „Erzgeb.“ oder „O.L.“
        or name in {"Klein", "Groß", "Neu", "Alt", "Bad", "Sankt", "Ober", "Nieder"}  # Rest aus „Groß/Klein X“
    )


def split_outside_parens(text: str) -> list[str]:
    parts, depth, current = [], 0, ""
    for ch in text:
        depth += (ch == "(") - (ch == ")")
        if depth == 0 and ch in ",/;":
            parts.append(current)
            current = ""
        else:
            current += ch
    return parts + [current]


def place_names(note: str) -> tuple[set[str], list[str]]:
    """`note` hat die Form „80331 München“, manchmal mehrere Orte mit Komma oder Schrägstrich.

    → (brauchbare Namen, verworfene Teile). Bei „Berlin (Müggelheim, Köpenick)“ und ähnlichen Fällen,
    deren Klammer nicht durchgeht, bleibt der Teil vor der Klammer."""
    kept, rejected = set(), []
    for part in split_outside_parens(note.strip()):
        name = re.sub(r"^\d{5}\s*", "", part.strip(" ,-"))
        name = TRAILING_WORDS.sub("", LEADING_WORDS.sub("", name)).strip(" ,-")
        if not name or name.isdigit():
            continue
        if suspicious_name(name) and " (" in name:
            name = name.split(" (")[0].strip()
        if suspicious_name(name):
            rejected.append(name)
        else:
            kept.add(name)
    return kept, rejected


def sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def check_hashes(paths: list[str], update: bool) -> None:
    """Vergleicht die Eingaben mit inputs.sha256 (QA M3 F5); `update` übernimmt neue Eingaben bewusst."""
    actual = {os.path.basename(p): sha256(p) for p in paths}
    if update:
        with open(HASHES, "w", encoding="utf-8") as f:
            f.writelines(f"{h}  {name}\n" for name, h in sorted(actual.items()))
        return
    expected = dict(reversed(line.split()) for line in open(HASHES, encoding="utf-8") if line.strip())
    diff = sorted(n for n in expected.keys() | actual.keys() if expected.get(n) != actual.get(n))
    if diff:
        raise SystemExit(f"Eingaben weichen von inputs.sha256 ab: {diff} (neue Daten: --update-hashes)")


def osm_files(osm_dir: str) -> list[str]:
    files = sorted(glob.glob(f"{osm_dir}/osm-DE-*.json"))
    if len(files) != 16:
        raise SystemExit(f"Erwartet 16 Overpass-Exporte, gefunden {len(files)}")
    return files


def read_osm(files: list[str]):
    """→ Zeilen (relation, plz, rolle, WKT-Linie), {plz: {ortsnamen}} und Zahl der verworfenen Namensteile."""
    lines, names, seen, rejected = [], collections.defaultdict(set), set(), 0
    for path in files:
        for element in json.load(open(path, encoding="utf-8"))["elements"]:
            rel, tags = element["id"], element.get("tags", {})
            code = tags.get("postal_code", "")
            if rel in seen or not re.fullmatch(r"\d{5}", code):
                continue
            seen.add(rel)
            kept, dropped = place_names(tags.get("note", ""))
            names[code].update(kept)
            rejected += len(dropped)
            for member in element.get("members", []):
                geometry = member.get("geometry")
                if member.get("type") != "way" or not geometry or len(geometry) < 2:
                    continue
                wkt = "LINESTRING(" + ",".join(f"{p['lon']} {p['lat']}" for p in geometry) + ")"
                lines.append((rel, code, member.get("role") or "outer", wkt))
    return lines, names, rejected


def read_vg250(path: str):
    db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    srs = db.execute("select srs_id from gpkg_geometry_columns where table_name = 'vg250_krs'").fetchone()[0]
    rows = db.execute("select ags, geom from vg250_krs where gf = 4 order by ags").fetchall()
    municipalities = db.execute("select ags, gen, geom from vg250_gem where gf = 4 order by ags").fetchall()
    return (srs, [(ags, gpkg_wkb(blob).hex()) for ags, blob in rows],
            [(ags, gen, gpkg_wkb(blob).hex()) for ags, gen, blob in municipalities])


def intersect_de(lines, districts, municipalities, srs):
    """→ ({plz: {ags}}, {plz: {gemeindename}}, Statistik)."""
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
        "create temp table g (ags text, gen text, geom extensions.geometry);",
        "copy g from stdin;",
        *(f"{ags}\t{copy_field(gen)}\t{hexwkb}" for ags, gen, hexwkb in municipalities),
        "\\.",
        f"update g set geom = extensions.st_setsrid(geom, {srs});",
        "create index on g using gist (geom);",
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
        # Anteil an der PLZ-Fläche und an der Gemeindefläche, für die Ortsnamen
        "select 'name', p.code, g.gen, round((extensions.st_area(i) / nullif(extensions.st_area(p.geom), 0))::numeric, 5)::text"
        "  || ':' || round((extensions.st_area(i) / nullif(extensions.st_area(g.geom), 0))::numeric, 5)::text"
        " from p join g on extensions.st_intersects(p.geom, g.geom)"
        " cross join lateral (select extensions.st_intersection(p.geom, g.geom) i) x;",
    ]
    out = subprocess.run(PSQL, input="\n".join(script) + "\n", capture_output=True, text=True, check=True).stdout
    stats, shares, name_shares = {}, collections.defaultdict(list), collections.defaultdict(list)
    for line in out.splitlines():
        kind, a, b, *rest = line.split("\t")
        if kind == "stat":
            stats[a] = int(b)
        elif kind == "pair":
            share, area = rest[0].split(":")
            shares[a].append((b, float(share), float(area)))
        elif kind == "name":
            of_code, of_municipality = rest[0].split(":")
            name_shares[a].append((b, float(of_code), float(of_municipality)))
    mapping = {}
    for code, candidates in shares.items():
        keep = {ags for ags, share, area in candidates if share >= MIN_SHARE or area >= MIN_AREA_M2}
        keep.add(max(candidates, key=lambda c: c[1])[0])  # jede PLZ mindestens im Kreis mit dem größten Anteil
        mapping[code] = keep
    stats["paare_vor_schwelle"] = sum(len(c) for c in shares.values())
    stats["paare_nach_schwelle"] = sum(len(v) for v in mapping.values())
    names = collections.defaultdict(set)
    for code, candidates in name_shares.items():
        names[code] = {gen for gen, of_code, of_mun in candidates
                       if of_code >= NAME_MIN_SHARE_OF_CODE or of_mun >= NAME_MIN_SHARE_OF_MUNICIPALITY}
        names[code].add(max(candidates, key=lambda c: c[1])[0])
    if stats["relationen_ohne_flaeche"]:
        raise SystemExit(f"{stats['relationen_ohne_flaeche']} OSM-Relationen ergeben keine Fläche (PLZ fielen weg)")
    return mapping, names, stats


def read_at(path: str):
    """Gemeinde → PLZ des Gemeindeamts und weitere PLZ; Bezirk = erste drei Ziffern der Kennziffer."""
    rows = list(csv.reader(open(path, encoding="utf-8"), delimiter=";"))
    if AT_HEADER not in rows:
        raise SystemExit(f"Kopfzeile der Gemeindeliste fehlt oder weicht ab, erwartet {AT_HEADER}")
    mapping, names = collections.defaultdict(set), collections.defaultdict(set)
    for row in rows[rows.index(AT_HEADER) + 1:]:
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
        "-- Quellen und Lizenzen: supabase/data/postal_codes/SOURCES.md.",
        "-- DE: PLZ-Gebiete © OpenStreetMap-Mitwirkende (ODbL 1.0); Kreise und Gemeindenamen © GeoBasis-DE / BKG (2026),",
        "--     dl-de/by-2-0, verschnitten mit den PLZ-Gebieten.",
        "-- AT: Datenquelle: Statistik Austria (CC BY 4.0), geändert: Bezirk aus der Gemeindekennziffer abgeleitet.",
        "-- Diese Tabelle steht als abgeleitete Datenbank unter ODbL (ADR 012).",
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
    parser.add_argument("--update-hashes", action="store_true")
    args = parser.parse_args()

    files = osm_files(args.osm_dir)
    check_hashes([*files, args.vg250, args.at], args.update_hashes)
    lines, osm_names, rejected_names = read_osm(files)
    srs, districts, municipalities = read_vg250(args.vg250)
    de_mapping, municipality_names, stats = intersect_de(lines, districts, municipalities, srs)
    at_mapping, at_names = read_at(args.at)
    de_names = {c: municipality_names.get(c, set()) | osm_names.get(c, set()) for c in de_mapping}

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
    bad_names = sorted({n for v in names_by_code.values() for n in v if suspicious_name(n)})
    if bad_names:
        raise SystemExit(f"Verdächtige Ortsnamen: {bad_names[:20]}")

    stats.update(
        de_plz=de_count,
        at_plz=at_count,
        de_mehrere_kreise=sum(1 for (c, _), v in regions_by_code.items() if c == "DE" and len(v) > 1),
        at_mehrere_bezirke=sum(1 for (c, _), v in regions_by_code.items() if c == "AT" and len(v) > 1),
        ohne_ortsname=sum(1 for k in regions_by_code if not names_by_code.get(k)),
        ortsnamen=sum(len(v) for v in names_by_code.values()),
        osm_namensteile_verworfen=rejected_names,
    )
    with open(args.out, "w", encoding="utf-8") as f:
        f.write(render(regions_by_code, names_by_code, stats))
    print(f"{args.out}: {stats}")


if __name__ == "__main__":
    main()
