import { formatPrice, type Currency } from "@/lib/validation/price";

// Anzeige-Helfer für öffentliche Seiten (ADR 015, Review A13): nur serverseitig aufrufen, sonst weichen
// Node-ICU und Browser bei der Hydration ab. Preise immer in Originalwährung, nie umgerechnet.

type PriceFields = { priceMinor: number | null; currency: Currency | null; priceUnit: string | null };
type Translate = (key: string) => string;

/** „5.000 € pro Jahr“, „auf Anfrage“ oder null ohne Preisangabe. Preis und Einheit sind ein Text (A12). */
export function priceText(listing: PriceFields, locale: string, t: Translate): string | null {
  if (listing.priceUnit === "on_request") return t("preview.onRequest");
  if (listing.priceMinor === null || !listing.currency || !listing.priceUnit) return null;
  return `${formatPrice(listing.priceMinor, listing.currency, locale)} ${t(`priceUnits.${listing.priceUnit}`)}`;
}

/** Thumbnails haben eine lange Seite von 480 px (ADR 011); Maße aus dem Seitenverhältnis gegen Layoutsprünge. */
export const THUMB_LONG_SIDE = 480;

export function thumbSize(width: number | null, height: number | null): { width: number; height: number } {
  if (!width || !height) return { width: THUMB_LONG_SIDE, height: 360 };
  const scale = THUMB_LONG_SIDE / Math.max(width, height);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export function photoUrl(photoId: string, variant: "thumb" | "full"): string {
  return `/api/photos/${photoId}/${variant}`;
}
