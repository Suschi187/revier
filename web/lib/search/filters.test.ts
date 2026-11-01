import { describe, expect, it } from "vitest";
import fixtures from "../../../supabase/tests/fixtures/search_filters.json";
import { filtersError, filtersFromParams, paramsFromFilters, type Filters } from "./filters";

describe("Filterformat v1: Zod urteilt wie die DB (ADR 015)", () => {
  it.each(fixtures.cases)("$name → $error", (c) => {
    expect(filtersError(c.filters)).toBe(c.error);
  });
});

describe("URL-Parameter ↔ Filter", () => {
  it("Roundtrip", () => {
    const filters: Filters = {
      v: 1, q: "Rehwild", country: "DE", region: "DE-BY", kind: "lease", direction: "offer", species: ["roe_deer", "red_deer"],
      currency: "EUR", price_min: 100000, price_max: 500000, price_unit: "per_year", area_min: 10, area_max: 1000.5,
      date_from: "2026-01-01", date_to: "2026-12-31", verified_only: true, sort: "price_asc",
    };
    const params = paramsFromFilters(filters);
    expect(params.get("pmax")).toBe("5000");
    expect(filtersFromParams(params)).toEqual(filters);
  });

  it("Ungültige Werte fallen einzeln weg", () => {
    const params = new URLSearchParams({ country: "FR", kind: "lease", species: "roe_deer,unicorn", amin: "abc", from: "2026-02-30" });
    expect(filtersFromParams(params)).toEqual({ v: 1, kind: "lease" });
  });

  it("Preis ohne Währung und Preis-Sortierung ohne Einheit fallen weg", () => {
    expect(filtersFromParams(new URLSearchParams({ pmax: "100", sort: "price_asc" }))).toEqual({ v: 1 });
    expect(filtersFromParams(new URLSearchParams({ cur: "CZK", pmin: "10.5", sort: "price_desc" }))).toEqual({ v: 1, currency: "CZK" });
  });

  it("Werte aus dem Pfad gehen vor; ein widersprechendes Land fällt weg", () => {
    const params = new URLSearchParams({ kind: "helper", country: "AT", region: "DE-SN" });
    expect(filtersFromParams(params, { kind: "lease", region: "DE-BY" })).toEqual({ v: 1, kind: "lease", region: "DE-BY" });
  });

  it("Ergebnis ist immer gültig", () => {
    const params = new URLSearchParams({ q: "  ", cur: "EUR", pmin: "900", pmax: "100", amin: "50", amax: "5", sort: "relevance" });
    const filters = filtersFromParams(params);
    expect(filtersError(filters)).toBeNull();
    expect(filters).toEqual({ v: 1, currency: "EUR", price_min: 90000, area_min: 50 });
  });

  it("Wildarten aus Formular (mehrfach) und Link (kommagetrennt)", () => {
    expect(filtersFromParams(new URLSearchParams("species=roe_deer&species=red_deer")).species).toEqual(["roe_deer", "red_deer"]);
    expect(filtersFromParams({ species: ["roe_deer", "wild_boar"] }).species).toEqual(["roe_deer", "wild_boar"]);
  });

  it("Bereich: kanonisch auf 4 Stellen nach außen gerundet, Roundtrip, Ungültiges fällt weg", () => {
    expect(filtersFromParams(new URLSearchParams({ bbox: "11.123456,48.123456,11.876543,48.876543" })).bbox).toEqual([11.1234, 48.1234, 11.8766, 48.8766]);
    const params = paramsFromFilters({ v: 1, bbox: [11.1234, 48.1234, 11.8766, 48.8766] });
    expect(params.get("bbox")).toBe("11.1234,48.1234,11.8766,48.8766");
    expect(filtersFromParams(params).bbox).toEqual([11.1234, 48.1234, 11.8766, 48.8766]);
    for (const bad of ["1,2,3", "a,b,c,d", "13,51,12,52", "5,47,40,55", "1e3,1,2,3"]) {
      expect(filtersFromParams(new URLSearchParams({ bbox: bad })).bbox, bad).toBeUndefined();
    }
  });

  it("omit lässt Schlüssel weg (z. B. q für next)", () => {
    expect(paramsFromFilters({ v: 1, q: "Name", kind: "lease" }, ["q"]).toString()).toBe("kind=lease");
  });
});
