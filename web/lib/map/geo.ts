// Punkt aus einer PostgREST-Antwort (ADR 016): PostGIS liefert Geometrien als GeoJSON oder als EWKB in Hex. Rein,
// damit Vitest es prüft.

export type LngLat = { lng: number; lat: number };

export function parsePoint(value: unknown): LngLat | null {
  if (typeof value === "string" && /^[0-9a-fA-F]+$/.test(value) && value.length >= 42) {
    const bytes = Uint8Array.from(value.match(/../g)!.map((h) => parseInt(h, 16)));
    const view = new DataView(bytes.buffer);
    const little = bytes[0] === 1;
    const type = view.getUint32(1, little);
    if ((type & 0xff) !== 1) return null;
    const offset = type & 0x20000000 ? 9 : 5;
    return { lng: view.getFloat64(offset, little), lat: view.getFloat64(offset + 8, little) };
  }
  const geo = value as { type?: string; coordinates?: unknown } | null;
  if (geo?.type === "Point" && Array.isArray(geo.coordinates) && geo.coordinates.length >= 2) {
    const [lng, lat] = geo.coordinates as number[];
    return Number.isFinite(lng) && Number.isFinite(lat) ? { lng, lat } : null;
  }
  return null;
}
