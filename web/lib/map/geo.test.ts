import { describe, expect, it } from "vitest";
import { parsePoint } from "./geo";

describe("Punkt aus PostgREST (ADR 016)", () => {
  it("GeoJSON", () => {
    expect(parsePoint({ type: "Point", coordinates: [13.9, 50.9] })).toEqual({ lng: 13.9, lat: 50.9 });
  });

  it("EWKB mit SRID in Hex (Little Endian)", () => {
    // SRID=4326;POINT(13.5 50.25)
    expect(parsePoint("0101000020E61000000000000000002B400000000000204940")).toEqual({ lng: 13.5, lat: 50.25 });
  });

  it.each([null, "zz", { type: "LineString", coordinates: [[1, 2]] }, { type: "Point", coordinates: ["a", 1] }])("ungültig: %j", (value) => {
    expect(parsePoint(value)).toBeNull();
  });
});
