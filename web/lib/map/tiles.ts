import "server-only";
import { readdirSync } from "node:fs";
import path from "node:path";

// Kartendatei (ADR 016, Review A1): von der eigenen Origin unter /tiles/<name>.pmtiles. Den Namen liest der Server
// zur Laufzeit (MAP_TILES_FILE), ein Build gilt für Stage und Prod. In der Entwicklung liegt die Datei unter
// web/.cache/map (npm run map:download); in Prod liefert sie der Objektspeicher bzw. das CDN vor Next aus (M10).

export const TILE_NAME_RE = /^[a-z0-9-]{1,64}\.pmtiles$/;

/** Verzeichnis der lokalen Auslieferung: MAP_TILES_DIR oder in der Entwicklung der Cache. */
export function tilesDir(): string | null {
  if (process.env.MAP_TILES_DIR) return path.resolve(process.env.MAP_TILES_DIR);
  return process.env.NODE_ENV === "production" ? null : path.resolve(process.cwd(), ".cache", "map");
}

/**
 * URL der Kartendatei für die Karte oder null (dann Punkte auf neutralem Grund). MAP_TILES_FILE geht vor; in der
 * Entwicklung die jüngste heruntergeladene Datei, sonst die Fixture.
 */
export function tilesUrl(): string | null {
  const configured = process.env.MAP_TILES_FILE;
  if (configured) return TILE_NAME_RE.test(configured) ? `/tiles/${configured}` : null;
  const dir = tilesDir();
  if (!dir || process.env.NODE_ENV === "production") return null;
  try {
    const files = readdirSync(dir).filter((f) => TILE_NAME_RE.test(f)).sort();
    const full = files.filter((f) => f !== "basemap-fixture.pmtiles");
    const pick = full.at(-1) ?? files.at(-1);
    return pick ? `/tiles/${pick}` : null;
  } catch {
    return null;
  }
}
