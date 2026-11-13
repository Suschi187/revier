/**
 * Wildarten-Icons in der Linienart der Bildmarke (eigene Zeichnung, freigegeben 2026-11-13, docs/DESIGN.md):
 * Raster 40 × 40, Linie 2, eckige Enden; Akzent in Orange. Immer neben dem Namen, nie allein bedeutungstragend.
 * iOS übernimmt dieselben Pfade.
 */
const HEAD = "M15 20 L25 20 L20 32 Z";

const SHAPES = {
  roe_deer: {
    base: "M20 22 L15.5 15 L15 5 M15.5 15 L11 13 M15.3 9.5 L18 7.5 M20 22 L24.5 15 L25 5 M24.5 15 L29 13 M24.7 9.5 L22 7.5 M16.5 22 L9.5 18.5 L11.5 24 Z M23.5 22 L30.5 18.5 L28.5 24 Z",
    accent: "M16.5 22 L23.5 22 L20 33 Z",
  },
  red_deer: {
    base: "M17 20 L11 13 L9 3 M11 13 L5 11.5 M10.1 8.2 L5.5 6 M9 3 L12 5.5 M23 20 L29 13 L31 3 M29 13 L35 11.5 M29.9 8.2 L34.5 6 M31 3 L28 5.5 M15 20 L10 18.5 M25 20 L30 18.5",
    accent: HEAD,
  },
  fallow_deer: {
    base: "M17 20 L14 14 L7 11 L5 4 L8 6.5 L10 3 L12 6.5 L15 4 L14 14 M23 20 L26 14 L33 11 L35 4 L32 6.5 L30 3 L28 6.5 L25 4 L26 14 M15 20 L10 18.5 M25 20 L30 18.5",
    accent: HEAD,
  },
  wild_boar: {
    base: "M6 20 L10 11 L24 13 L32 18 L36 18 L36 24 L26 27 L12 27 Z M11 11 L12.5 5 L17 11.8 M22 17.5 L22.1 17.5",
    accent: "M30 25.8 L32.5 21.5",
  },
  chamois: {
    base: "M17.5 20 L16.5 10 L14.5 8 L13 10.5 M22.5 20 L23.5 10 L25.5 8 L27 10.5 M15 20 L8 15.5 M25 20 L32 15.5",
    accent: HEAD,
  },
  ibex: {
    base: "M18 19 Q13 8 6 4 M22 19 Q27 8 34 4 M15.4 13.4 L13.2 15 M13.1 10 L10.8 11.6 M10.3 7.2 L8.2 8.6 M24.6 13.4 L26.8 15 M26.9 10 L29.2 11.6 M29.7 7.2 L31.8 8.6",
    accent: "M16 19 L24 19 L20 31 Z M20 31 L20 35",
  },
  mouflon: {
    base: "M17 18 A6 6 0 1 0 12 28 L13.5 25 M23 18 A6 6 0 1 1 28 28 L26.5 25",
    accent: "M16 18 L24 18 L20 32 Z",
  },
  fox: {
    base: "M7 6 L15 15 L25 15 L33 6 L32 19 L20 33 L8 19 Z M14 21.5 L16.5 22.5 M26 21.5 L23.5 22.5",
    accent: "M18.5 29 L21.5 29 L20 31 Z",
  },
  hare: {
    base: "M13 20 L27 20 L29 27 L20 34 L11 27 Z M16 20 L13 4 L17 4 L19 20 M24 20 L26 4 L30 5 L26.5 20 M16 25 L16.1 25 M24 25 L24.1 25",
    accent: "M18.5 28.5 L21.5 28.5 L20 30.5 Z",
  },
  pheasant: {
    base: "M6 13 L10 9 L13 12 L14 17 L24 17 L30 22 L24 26 L15 26 L11 21 Z M6 13 L3 14.5 M27 19.5 L38 11 M29 22 L38 16 M17 26 L16 32 M21 26 L22 32",
    accent: "M8.5 11.5 L11.5 13.5",
  },
  partridge: {
    base: "M8 16 L12 11 L16 13 L17 17 L28 17 L33 22 L28 28 L15 28 L10 23 Z M8 16 L5 17.5 M18 28 L17 33 M24 28 L25 33",
    accent: "M19 21.5 L22 24.5 L25 21.5",
  },
  waterfowl: {
    base: "M10 14 L14 10 L18 12 L18 18 L30 17 L35 13 L34 21 L29 26 L13 26 L9 21 Z M10 14 L5 15.5 L10 16.5",
    accent: "M3 32 L8 30 L13 32 L18 30 L23 32 L28 30 L33 32 L37 30",
  },
  dog: {
    base: "M13 9 L27 9 L29 25 L20 33 L11 25 Z M13 9 L6 13 L8 25 L12 21 M27 9 L34 13 L32 25 L28 21 M16.5 17 L16.6 17 M23.5 17 L23.6 17",
    accent: "M18 26.5 L22 26.5 L20 29 Z",
  },
} as const;

export type SpeciesShape = keyof typeof SHAPES;
export const SPECIES_SHAPES = Object.keys(SHAPES) as SpeciesShape[];

/** Wildarten ohne eigene Zeichnung teilen sich ein Icon (Zuordnung in docs/DESIGN.md). */
const ALIASES: Record<string, SpeciesShape> = { sika_deer: "red_deer", other_predators: "fox", small_game: "hare" };

export function speciesShape(code: string): SpeciesShape | null {
  if (code in SHAPES) return code as SpeciesShape;
  return ALIASES[code] ?? null;
}

export function SpeciesIcon({ code, size = 24, accent = true, className }: { code: string; size?: number; accent?: boolean; className?: string }) {
  const shape = speciesShape(code);
  if (!shape) return null;
  const { base, accent: detail } = SHAPES[shape];
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" strokeLinejoin="miter" className={className}>
      <path d={base} />
      <path d={detail} stroke={accent ? "var(--color-accent-line, var(--color-brand-ink))" : "currentColor"} />
    </svg>
  );
}
