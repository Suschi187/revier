import type { Database } from "@/lib/supabase/database.types";

type Kind = Database["public"]["Enums"]["listing_kind"];

// Eigene Illustrationen (docs/DESIGN.md 11), erzeugt mit scripts/illustrations.mjs. Dateinamen mit Version (.v1),
// weil /static/brand ein Jahr unveränderlich gecacht wird; bei jeder Änderung hochzählen.
export const HERO_IMAGE = { src: "/static/brand/hero.v1.svg", width: 1200, height: 450 } as const;
export const OG_IMAGE = { url: "/static/brand/og-default.v1.png", width: 1200, height: 630 } as const;

export function kindImage(kind: Kind) {
  return { src: `/static/brand/kind-${kind}.v1.svg`, width: 1200, height: 400 } as const;
}
