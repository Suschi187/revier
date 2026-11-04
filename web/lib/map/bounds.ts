// Startausschnitt und Filterbereich der Karte (ADR 016). Rein, damit Vitest es prüft.

import { canonicalBbox } from "@/lib/search/filters";

export type Bounds = [number, number, number, number];

/** DE und AT. */
export const DEFAULT_BOUNDS: Bounds = [5.8, 45.8, 17.2, 55.1];

/**
 * Ausschnitt um einen Mittelpunkt, groß genug für die Fläche (Quadrat mit gleicher Fläche, 30 % Rand). Regionen
 * haben nur Mittelpunkt und Fläche, keine Grenzen (ADR 007).
 */
export function boundsAround(lng: number, lat: number, areaKm2: number): Bounds {
  const halfKm = (Math.sqrt(Math.max(areaKm2, 1)) / 2) * 1.3;
  const dLat = halfKm / 111.32;
  const dLng = halfKm / (111.32 * Math.cos((lat * Math.PI) / 180));
  return [lng - dLng, lat - dLat, lng + dLng, lat + dLat];
}

/**
 * Kein Kartenpunkt in Kreisen unter dieser Fläche (ADR 016, Review B1 a). Maßgeblich ist die DB
 * (`app_settings.listing_location_min_district_km2`, Fehler place.point.small_district); hier nur zum Ausblenden.
 */
export const MIN_POINT_DISTRICT_KM2 = 400;

/** Größte Ausdehnung je Achse im Filter v1 (ADR 016). */
export const MAX_BBOX_SPAN = 30;

/**
 * Filterbereich aus dem sichtbaren Ausschnitt: auf die Welt begrenzt, kanonisch nach außen gerundet, und erst danach
 * auf höchstens 30° um die Mitte gekappt (QA M6 F2). Die Kappung rundet nach innen auf das 4-Stellen-Raster;
 * umgekehrt ergäbe die Rundung nach außen 30,0001° und der Filter fiele still weg.
 */
export function viewBbox(view: Bounds): Bounds | undefined {
  const rounded = canonicalBbox([Math.max(view[0], -180), Math.max(view[1], -90), Math.min(view[2], 180), Math.min(view[3], 90)]);
  if (!rounded) return undefined;
  // In ganzen Einheiten von 1e-4 rechnen, damit keine Gleitkomma-Reste die Grenze verschieben.
  const units = rounded.map((v) => Math.round(v * 1e4));
  const limit = MAX_BBOX_SPAN * 1e4;
  const clamp = (lo: number, hi: number) => {
    if (hi - lo <= limit) return [lo, hi];
    const start = Math.floor((lo + hi) / 2) - limit / 2;
    return [start, start + limit];
  };
  const [w, e] = clamp(units[0], units[2]);
  const [s, n] = clamp(units[1], units[3]);
  return [w / 1e4, s / 1e4, e / 1e4, n / 1e4];
}
