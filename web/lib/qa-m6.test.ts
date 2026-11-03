import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pointFromForm } from "./location-point";
import { canonicalBbox, filtersError, filtersFromParams, paramsFromFilters } from "./search/filters";
import { parseRange } from "./map/range";
import { buildCsp } from "./security/csp";

// QA M6 (Abnahme, docs/QA-REPORT.md „M6 – Abnahme“): bbox-Rundung und URL-Rundweg, Punkt aus dem Formular, Range,
// CSP, Texte der Karte in vier Sprachen. Bekannte Fehler als it.fails (F2).

const form = (entries: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(entries)) data.set(k, v);
  return data;
};

describe("bbox (ADR 016, A3)", () => {
  it("kanonisch: nach außen gerundet, idempotent, negativ und -0", () => {
    expect(canonicalBbox([13.12341, 50.12349, 14.98761, 51.00001])).toEqual([13.1234, 50.1234, 14.9877, 51.0001]);
    const once = canonicalBbox([-3.33337, -0.00001, 2.22222, 0.00001])!;
    expect(canonicalBbox(once)).toEqual(once);
    expect(once).toEqual([-3.3334, -0.0001, 2.2223, 0.0001]);
    expect(canonicalBbox([48.1234, 48.1234, 48.1235, 48.1235])).toEqual([48.1234, 48.1234, 48.1235, 48.1235]);
  });

  it("URL-Rundweg ergibt denselben Filter", () => {
    const filters = filtersFromParams(new URLSearchParams({ bbox: "13.1,50.2,14.3,51.4", kind: "lease" }));
    const again = filtersFromParams(paramsFromFilters(filters));
    expect(again).toEqual(filters);
    expect(again.bbox).toEqual([13.1, 50.2, 14.3, 51.4]);
  });

  it.each(["1e1,45,12,50", "13,51,12,52", "0x10,45,12,50", "13,50,14", "13,50,14,51,1", " 13,50,14,51", "13,50,14,51 ", "Infinity,1,2,3", `13.${"1".repeat(80)},50,14,51`])(
    "ungültig fällt weg: %s",
    (bbox) => {
      expect(filtersFromParams(new URLSearchParams({ bbox })).bbox).toBeUndefined();
    },
  );

  it("genau 30° bleibt gültig, auch mit Gleitkomma-Differenz", () => {
    expect(filtersError({ v: 1, bbox: [10.1, 40, 40.1, 50] })).toBeNull();
    expect(filtersError({ v: 1, bbox: [0.3, 40, 30.3, 50] })).toBeNull();
  });

  // ListingsMap kappt größere Ausschnitte auf 30° um die Mitte und rundet danach nach außen.
  it.fails("F2: auf 30° gekappter Ausschnitt bleibt nach der Rundung gültig", () => {
    const clamp = (lo: number, hi: number) => (hi - lo <= 30 ? [lo, hi] : [(lo + hi) / 2 - 15, (lo + hi) / 2 + 15]);
    const [w, e] = clamp(-10.123456, 33.456789);
    const box = canonicalBbox([w, 40.98765, e, 60.1234])!;
    expect(filtersError({ v: 1, bbox: box })).toBeNull();
  });
});

describe("Punkt aus dem Formular (B3, A7)", () => {
  it("Vorgabe keep, auch ohne Feld und mit fremden lat/lng", () => {
    expect(pointFromForm(form({}))).toEqual({ mode: "keep" });
    expect(pointFromForm(form({ point: "keep", lat: "50.95", lng: "13.95" }))).toEqual({ mode: "keep" });
    expect(pointFromForm(form({ point: "clear", lat: "50.95", lng: "13.95" }))).toEqual({ mode: "clear" });
  });
  it.each([
    { point: "set" },
    { point: "set", lat: "50.95" },
    { point: "set", lat: "NaN", lng: "13.9" },
    { point: "set", lat: "Infinity", lng: "13.9" },
    { point: "set", lat: "91", lng: "13.9" },
    { point: "set", lat: "50", lng: "-180.0001" },
    { point: "set", lat: "1e400", lng: "1" },
    { point: "move" },
  ] as Record<string, string>[])("ungültig: %j", (entries) => {
    expect(pointFromForm(form(entries))).toBeNull();
  });
});

describe("Range und CSP", () => {
  it("Grenzfälle der Kartendatei", () => {
    expect(parseRange("bytes=0-0", 1)).toEqual({ kind: "partial", start: 0, end: 0 });
    expect(parseRange("bytes=0-", 0)).toEqual({ kind: "unsatisfiable" });
    expect(parseRange("bytes=-5", 3)).toEqual({ kind: "partial", start: 0, end: 2 });
    expect(parseRange("bytes=00-01", 10)).toEqual({ kind: "partial", start: 0, end: 1 });
    expect(parseRange("bytes=0-99999999999999999999", 10)).toEqual({ kind: "partial", start: 0, end: 9 });
    expect(parseRange("bytes=99999999999999999999-", 10)).toEqual({ kind: "unsatisfiable" });
  });
  it("feste CSP mit worker-src 'self', Admin-CSP ohne worker-src (A2)", () => {
    const base = { supabaseUrl: "https://x.supabase.co", dev: false, https: true };
    const fixed = buildCsp(base);
    expect(fixed).toContain("worker-src 'self'");
    expect(fixed).not.toMatch(/(worker|script)-src[^;]*blob:/);
    const adminCsp = buildCsp({ ...base, nonce: "abc" });
    expect(adminCsp).toContain("'strict-dynamic'");
  });
});

describe("Texte der Karte (DoD)", () => {
  const messages = Object.fromEntries(
    ["en", "de", "cs", "pl"].map((l) => [l, JSON.parse(readFileSync(join(__dirname, "..", "messages", `${l}.json`), "utf8"))]),
  );
  const flat = (o: Record<string, unknown>, p = ""): Record<string, string> =>
    Object.entries(o).reduce<Record<string, string>>(
      (r, [k, v]) => (typeof v === "object" && v ? { ...r, ...flat(v as Record<string, unknown>, `${p}${k}.`) } : { ...r, [`${p}${k}`]: String(v) }),
      {},
    );
  const en = flat(messages.en.Map);
  it.each(["de", "cs", "pl"])("%s: alle Schlüssel, Platzhalter gleich, nichts unübersetzt", (locale) => {
    const other = flat(messages[locale].Map);
    expect(Object.keys(other).sort()).toEqual(Object.keys(en).sort());
    for (const [key, value] of Object.entries(en)) {
      expect(other[key].match(/\{\w+\}/g) ?? [], key).toEqual(value.match(/\{\w+\}/g) ?? []);
      expect(other[key], key).not.toBe(value);
    }
    expect(other.attribution).toContain("https://www.openstreetmap.org/copyright");
    expect(other.attribution).toContain("Protomaps");
    for (const code of ["place_point_small_district", "place_point_too_far", "place_point_invalid"]) {
      expect(messages[locale].Listings.fieldErrors[code], code).toBeTruthy();
    }
  });
});
