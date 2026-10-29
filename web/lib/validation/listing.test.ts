import { describe, expect, it } from "vitest";
import fixtures from "../../../supabase/tests/fixtures/listing_rules.json";
import { attributesError, fieldsFromHint, listingReadiness, type ListingDirection, type ListingKind, POSTAL_CODE_FORMAT } from "./listing";

// Dieselben Fälle prüft web/integration/listing-rules-parity.test.ts gegen die Datenbank (ADR 013).
const POSTAL: Record<string, "match" | "mismatch" | "unknown"> = { "01067": "match", "80331": "mismatch", "99999": "unknown" };

describe("Bereitschaft (gemeinsame Fixtures mit der DB)", () => {
  it.each(fixtures.readiness)("$name", (fixture) => {
    const codes = listingReadiness({
      kind: fixture.listing.kind as ListingKind,
      direction: fixture.listing.direction as ListingDirection,
      description: fixture.listing.description,
      areaHectares: fixture.listing.area_hectares,
      attributes: fixture.listing.attributes,
      speciesCount: fixture.species,
      place: fixture.place && { postalCode: fixture.place.postal_code, placeName: fixture.place.place_name },
      postalStatus: (code) => POSTAL[code] ?? "unknown",
      unprocessedPhotos: false,
      today: "2026-10-29",
    });
    expect(codes).toEqual(fixture.expected);
  });

  it("unverarbeitete Fotos beim Absenden", () => {
    const codes = listingReadiness({
      kind: "helper", direction: "wanted", description: "x".repeat(30), areaHectares: null, attributes: {},
      speciesCount: 0, place: null, postalStatus: () => "match", unprocessedPhotos: true, today: "2026-10-29",
    });
    expect(codes).toEqual(["photos.unprocessed"]);
  });
});

describe("Attribute je Art (gemeinsame Fixtures mit der DB)", () => {
  it.each(fixtures.attributes)("$kind $attributes → $expected", (fixture) => {
    expect(attributesError(fixture.kind as ListingKind, fixture.attributes)).toBe(fixture.expected);
  });
});

describe("Hilfen", () => {
  it("liest Feldcodes aus dem Hint", () => {
    expect(fieldsFromHint('{"fields": ["species", "area_hectares"]}')).toEqual(["species", "area_hectares"]);
    expect(fieldsFromHint("Zustimmung einholen")).toEqual([]);
    expect(fieldsFromHint(null)).toEqual([]);
    expect(fieldsFromHint('{"retry_after": "2026-10-30T10:00:00Z"}')).toEqual([]);
  });

  it("PLZ-Format je Land wie in der DB", () => {
    expect(POSTAL_CODE_FORMAT.DE.test("01067")).toBe(true);
    expect(POSTAL_CODE_FORMAT.DE.test("1067")).toBe(false);
    expect(POSTAL_CODE_FORMAT.AT.test("8940")).toBe(true);
    expect(POSTAL_CODE_FORMAT.AT.test("0940")).toBe(false);
    expect(POSTAL_CODE_FORMAT.CZ.test("110 00")).toBe(true);
    expect(POSTAL_CODE_FORMAT.PL.test("00-950")).toBe(true);
  });
});
