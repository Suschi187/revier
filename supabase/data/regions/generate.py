#!/usr/bin/env python3
"""Erzeugt die Migration mit den Regionen DE und AT (docs/adr/007-regionendaten.md).

Nur Standardbibliothek. Die Punkte berechnet PostGIS in der lokalen Supabase-Datenbank
(ST_PointOnSurface), ins Repo kommen nur Namen, Codes und Punkte, keine Polygone.

Eingaben (siehe SOURCES.md):
  --de  DE_VG250.gpkg aus BKG VG250 (Ebenen, UTM32s, GeoPackage)
  --at  GeoJSON der politischen Bezirke von Statistik Austria (WFS, EPSG:31287)

Aufruf (Supabase läuft lokal):
  python3 -I supabase/data/regions/generate.py --de <pfad>/DE_VG250.gpkg --at <pfad>/polbez.geojson \
    --out supabase/migrations/20261029100300_regions_data.sql
"""

import argparse
import json
import re
import sqlite3
import struct
import subprocess
import unicodedata

PSQL = ["docker", "exec", "-i", "supabase_db_revier", "psql", "-U", "postgres", "-qAt", "-v", "ON_ERROR_STOP=1", "-F", "\t"]

# Exonyme der Länder; Kreise/Bezirke behalten ihren amtlichen Namen. cs/pl ungeprüft (SPEC 7.6).
DE_STATES = {
    "01": ("DE-SH", "Schleswig-Holstein", "Schleswig-Holstein", "Šlesvicko-Holštýnsko", "Szlezwik-Holsztyn"),
    "02": ("DE-HH", "Hamburg", "Hamburg", "Hamburk", "Hamburg"),
    "03": ("DE-NI", "Niedersachsen", "Lower Saxony", "Dolní Sasko", "Dolna Saksonia"),
    "04": ("DE-HB", "Bremen", "Bremen", "Brémy", "Brema"),
    "05": ("DE-NW", "Nordrhein-Westfalen", "North Rhine-Westphalia", "Severní Porýní-Vestfálsko", "Nadrenia Północna-Westfalia"),
    "06": ("DE-HE", "Hessen", "Hesse", "Hesensko", "Hesja"),
    "07": ("DE-RP", "Rheinland-Pfalz", "Rhineland-Palatinate", "Porýní-Falc", "Nadrenia-Palatynat"),
    "08": ("DE-BW", "Baden-Württemberg", "Baden-Württemberg", "Bádensko-Württembersko", "Badenia-Wirtembergia"),
    "09": ("DE-BY", "Bayern", "Bavaria", "Bavorsko", "Bawaria"),
    "10": ("DE-SL", "Saarland", "Saarland", "Sársko", "Saara"),
    "11": ("DE-BE", "Berlin", "Berlin", "Berlín", "Berlin"),
    "12": ("DE-BB", "Brandenburg", "Brandenburg", "Braniborsko", "Brandenburgia"),
    "13": ("DE-MV", "Mecklenburg-Vorpommern", "Mecklenburg-Western Pomerania", "Meklenbursko-Přední Pomořansko", "Meklemburgia-Pomorze Przednie"),
    "14": ("DE-SN", "Sachsen", "Saxony", "Sasko", "Saksonia"),
    "15": ("DE-ST", "Sachsen-Anhalt", "Saxony-Anhalt", "Sasko-Anhaltsko", "Saksonia-Anhalt"),
    "16": ("DE-TH", "Thüringen", "Thuringia", "Durynsko", "Turyngia"),
}
AT_STATES = {
    "1": ("AT-1", "Burgenland", "Burgenland", "Burgenland", "Burgenland"),
    "2": ("AT-2", "Kärnten", "Carinthia", "Korutany", "Karyntia"),
    "3": ("AT-3", "Niederösterreich", "Lower Austria", "Dolní Rakousy", "Dolna Austria"),
    "4": ("AT-4", "Oberösterreich", "Upper Austria", "Horní Rakousy", "Górna Austria"),
    "5": ("AT-5", "Salzburg", "Salzburg", "Salcbursko", "Salzburg"),
    "6": ("AT-6", "Steiermark", "Styria", "Štýrsko", "Styria"),
    "7": ("AT-7", "Tirol", "Tyrol", "Tyrolsko", "Tyrol"),
    "8": ("AT-8", "Vorarlberg", "Vorarlberg", "Vorarlbersko", "Vorarlberg"),
    "9": ("AT-9", "Wien", "Vienna", "Vídeň", "Wiedeń"),
}
# Stadtstaaten: Die Kreis-/Bezirkszeile trägt dieselben Exonyme wie das Land.
CITY_STATE_DISTRICTS = {"DE-11000": "11", "DE-02000": "02", "DE-04011": "04", "AT-900": "9"}
# Beim Kreis gleichen Namens (z. B. München) unterscheidet der Zusatz Stadt und Landkreis.
DE_SUFFIX = {"Kreisfreie Stadt": "Stadt", "Stadtkreis": "Stadt", "Landkreis": "Landkreis", "Kreis": "Kreis"}


def slugify(name: str) -> str:
    name = name.lower().translate(str.maketrans({"ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss"}))
    name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", name).strip("-")


def gpkg_wkb(blob: bytes) -> bytes:
    """Entfernt den GeoPackage-Header und gibt das reine WKB zurück."""
    if blob[:2] != b"GP":
        raise ValueError("kein GeoPackage-Geometrie-Blob")
    envelope = (blob[3] >> 1) & 0b111
    return blob[8 + {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}[envelope]:]


def sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def read_de(path: str):
    db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    srs = db.execute("select srs_id from gpkg_geometry_columns where table_name = 'vg250_krs'").fetchone()[0]
    # GF = 4: Landfläche mit Struktur (ohne Gewässerflächen), eine Zeile je Gebiet.
    states = db.execute("select ags, geom from vg250_lan where gf = 4 order by ags").fetchall()
    districts = db.execute("select ags, gen, bez, geom from vg250_krs where gf = 4 order by ags").fetchall()
    return srs, states, districts


def compute_points(rows):
    """rows: (code, geometry-SQL) → {code: (lon, lat)} über PostGIS."""
    sql = ["create temp table g (code text, geom extensions.geometry);"]
    sql += [f"insert into g values ({sql_literal(code)}, {expr});" for code, expr in rows]
    sql.append(
        "select code, round(st_x(p)::numeric, 4), round(st_y(p)::numeric, 4) from ("
        " select code, extensions.st_transform(extensions.st_pointonsurface(extensions.st_union(geom)), 4326) p"
        " from g group by code) s order by code;"
    )
    out = subprocess.run(PSQL, input="\n".join(sql), capture_output=True, text=True, check=True).stdout
    return {code: (float(x), float(y)) for code, x, y in (line.split("\t") for line in out.splitlines() if line)}


def build(de_path: str, at_path: str):
    regions = []  # dicts mit code, country, level, parent, slug, names, point

    srs, de_states, de_districts = read_de(de_path)
    geom = lambda blob: f"extensions.st_geomfromwkb(decode('{gpkg_wkb(blob).hex()}', 'hex'), {srs})"
    de_rows = [(DE_STATES[ags][0], geom(blob)) for ags, blob in de_states]
    de_rows += [(f"DE-{ags}", geom(blob)) for ags, _, _, blob in de_districts]

    at = json.load(open(at_path, encoding="utf-8"))
    at_srid = int(re.search(r"EPSG::?(\d+)", at["crs"]["properties"]["name"]).group(1))
    # Wien nur als Ganzes (900); die Gemeindebezirke 901–923 sind keine eigenen Kreise.
    at_features = [f for f in at["features"] if not re.fullmatch(r"9(0[1-9]|1\d|2[0-3])", f["properties"]["g_id"])]
    at_geom = lambda f: f"extensions.st_setsrid(extensions.st_geomfromgeojson({sql_literal(json.dumps(f['geometry']))}), {at_srid})"
    at_rows = [(AT_STATES[f["properties"]["g_id"][0]][0], at_geom(f)) for f in at_features]
    at_rows += [(f"AT-{f['properties']['g_id']}", at_geom(f)) for f in at_features]

    points = compute_points(de_rows + at_rows)

    for key, (code, de, en, cs, pl) in {**DE_STATES, **AT_STATES}.items():
        country = code[:2]
        regions.append(dict(code=code, country=country, level="state", parent=None, names=(de, en, cs, pl)))

    name_counts = {}
    for _, gen, _, _ in de_districts:
        name_counts[gen] = name_counts.get(gen, 0) + 1
    for ags, gen, bez, _ in de_districts:
        name = f"{gen} ({DE_SUFFIX.get(bez, bez)})" if name_counts[gen] > 1 else gen
        regions.append(dict(code=f"DE-{ags}", country="DE", level="district", parent=DE_STATES[ags[:2]][0], names=(name,) * 4))

    for f in at_features:
        gid, raw = f["properties"]["g_id"], f["properties"]["g_name"]
        name = "Wien" if gid == "900" else re.sub(r"\s*\(", " (", raw).strip()
        regions.append(dict(code=f"AT-{gid}", country="AT", level="district", parent=AT_STATES[gid[0]][0], names=(name,) * 4))

    for r in regions:
        if r["code"] in CITY_STATE_DISTRICTS:
            states = {**DE_STATES, **AT_STATES}
            r["names"] = states[CITY_STATE_DISTRICTS[r["code"]]][1:]
        r["slug"] = slugify(r["names"][0])
        r["point"] = points[r["code"]]

    seen = set()
    for r in regions:
        key = (r["country"], r["level"], r["slug"])
        if key in seen:
            raise SystemExit(f"Slug doppelt: {key}")
        seen.add(key)
    return regions


def render(regions, de_path: str, at_path: str) -> str:
    def values(r):
        lon, lat = r["point"]
        names = ", ".join(sql_literal(n) for n in r["names"])
        return f"  ({sql_literal(r['code'])}, '{r['country']}', '{r['level']}', {sql_literal(r['slug'])}, {names}, 'SRID=4326;POINT({lon} {lat})')"

    states = [r for r in regions if r["level"] == "state"]
    districts = [r for r in regions if r["level"] == "district"]
    lines = [
        "-- GENERIERT von supabase/data/regions/generate.py, nicht von Hand ändern.",
        "-- Quellen und Lizenzen: supabase/data/regions/SOURCES.md",
        f"-- {len(states)} Länder, {len(districts)} Kreise/Bezirke; Punkte per ST_PointOnSurface, 4 Nachkommastellen.",
        "",
        "insert into public.regions (code, country, level, slug, name_de, name_en, name_cs, name_pl, centroid) values",
        ",\n".join(values(r) for r in states) + ";",
        "",
        "insert into public.regions (code, country, level, parent_id, slug, name_de, name_en, name_cs, name_pl, centroid)",
        "select v.code, v.country::public.country_code, v.level::public.region_level, p.id, v.slug,",
        "  v.name_de, v.name_en, v.name_cs, v.name_pl, v.centroid::extensions.geography",
        "from (values",
        ",\n".join(
            values(r).replace(f"'{r['level']}', ", f"'{r['level']}', {sql_literal(r['parent'])}, ", 1) for r in districts
        ),
        ") as v (code, country, level, parent_code, slug, name_de, name_en, name_cs, name_pl, centroid)",
        "join public.regions p on p.code = v.parent_code;",
        "",
    ]
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--de", required=True)
    parser.add_argument("--at", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    regions = build(args.de, args.at)
    with open(args.out, "w", encoding="utf-8") as f:
        f.write(render(regions, args.de, args.at))
    counts = {}
    for r in regions:
        counts[(r["country"], r["level"])] = counts.get((r["country"], r["level"]), 0) + 1
    print(f"{args.out}: {counts}")


if __name__ == "__main__":
    main()
