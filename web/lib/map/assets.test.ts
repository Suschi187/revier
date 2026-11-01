import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import basemapsPackage from "@protomaps/basemaps/package.json";
import { MAP_STYLE_VERSION, MAP_WORKER_URL } from "./assets";

const PUBLIC = join(__dirname, "..", "..", "public");

describe("Kartendateien (ADR 016)", () => {
  it("Stilversion entspricht @protomaps/basemaps, Stile je Sprache vorhanden", () => {
    expect(MAP_STYLE_VERSION).toBe(basemapsPackage.version);
    for (const locale of ["de", "en", "cs", "pl"]) {
      expect(existsSync(join(PUBLIC, "static", "map", `style-${locale}.v${MAP_STYLE_VERSION}.json`)), locale).toBe(true);
    }
  });

  it("Stil ohne fremde URLs und ohne Sprites (Review A2, A10)", () => {
    const style = readFileSync(join(PUBLIC, "static", "map", `style-de.v${MAP_STYLE_VERSION}.json`), "utf8");
    expect(style).not.toMatch(/https?:\/\//);
    expect(JSON.parse(style).sprite).toBeUndefined();
    expect(JSON.parse(style).glyphs).toBe("/static/map/fonts/{fontstack}/{range}.pbf");
    expect(JSON.parse(style).sources.protomaps.url).toBe("TILES_URL");
  });

  it("Schriften für Latin und Latin Extended-A (cs/pl) mit Lizenz", () => {
    for (const font of ["Noto Sans Regular", "Noto Sans Medium", "Noto Sans Italic"]) {
      const files = readdirSync(join(PUBLIC, "static", "map", "fonts", font));
      expect(files, font).toEqual(expect.arrayContaining(["0-255.pbf", "256-511.pbf"]));
    }
    expect(existsSync(join(PUBLIC, "static", "map", "fonts", "OFL.txt"))).toBe(true);
  });

  it("Worker-Pfad trägt die installierte MapLibre-Version", () => {
    expect(MAP_WORKER_URL).toMatch(/^\/static\/map\/maplibre-\d+\.\d+\.\d+\/maplibre-gl-worker\.mjs$/);
  });
});
