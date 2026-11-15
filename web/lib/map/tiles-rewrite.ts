// Kartendatei in Prod (ADR 016, ADR 023): Vercel kann die Datei (über 1 GB) nicht ausliefern. Sie liegt in Supabase
// Storage (Frankfurt); /tiles/<name>.pmtiles wird dorthin umgeschrieben, die Karte lädt weiter von der eigenen Origin
// (CSP `connect-src 'self'`). Ohne MAP_TILES_ORIGIN keine Umschreibung (lokal liefert app/tiles die Datei).
// Relativ importiert, weil next.config.ts dieses Modul lädt.

/** Ziel der Umschreibung oder null; nur https ohne Query, Fragment und Anmeldedaten, ohne Schrägstrich am Ende. */
export function tilesRewriteOrigin(raw: string | undefined): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("MAP_TILES_ORIGIN ist keine URL");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("MAP_TILES_ORIGIN muss eine https-URL ohne Query und Anmeldedaten sein");
  }
  return url.href.replace(/\/+$/, "");
}

/** Rewrites vor den Routen (sonst gewönne der lokale Route Handler app/tiles/[name]). */
export function tilesRewrites(raw: string | undefined) {
  const origin = tilesRewriteOrigin(raw);
  // Dateiname wie TILE_NAME_RE in lib/map/tiles.ts.
  return origin ? [{ source: "/tiles/:name([a-z0-9-]{1,64}\\.pmtiles)", destination: `${origin}/:name` }] : [];
}
