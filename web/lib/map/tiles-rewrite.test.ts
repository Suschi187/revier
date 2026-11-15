import { describe, expect, it } from "vitest";
import { tilesRewriteOrigin, tilesRewrites } from "./tiles-rewrite";

describe("Kartendatei-Umschreibung (ADR 023)", () => {
  it("ohne Variable keine Umschreibung", () => {
    expect(tilesRewrites(undefined)).toEqual([]);
    expect(tilesRewrites("")).toEqual([]);
  });

  it("https-Ziel ohne Schrägstrich am Ende, nur gültige Dateinamen", () => {
    expect(tilesRewrites("https://abc.supabase.co/storage/v1/object/public/tiles/")).toEqual([
      { source: "/tiles/:name([a-z0-9-]{1,64}\\.pmtiles)", destination: "https://abc.supabase.co/storage/v1/object/public/tiles/:name" },
    ]);
  });

  it("lehnt http, Query, Fragment und Anmeldedaten ab", () => {
    for (const bad of ["http://abc.supabase.co/x", "https://abc.supabase.co/x?a=1", "https://abc.supabase.co/x#a", "https://u:p@abc.supabase.co/x", "kein-url"]) {
      expect(() => tilesRewriteOrigin(bad), bad).toThrow(/MAP_TILES_ORIGIN/);
    }
  });
});
