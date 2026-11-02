// Startausschnitt der Karte (ADR 016). Rein, damit Vitest es prüft.

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
