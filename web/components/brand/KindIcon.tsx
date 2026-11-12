import type { Database } from "@/lib/supabase/database.types";

type Kind = Database["public"]["Enums"]["listing_kind"];

/** Kategorie-Icons in der Linienart der Bildmarke (eigene Zeichnung); Akzentstrich in Marken-Orange. */
const SHAPES: Record<Kind, { base: React.ReactNode; accent: React.ReactNode }> = {
  lease: { base: <path d="M5 30 L12 8 L28 6 L35 24 L22 34 Z" />, accent: <path d="M19 20 v-8 l6 2.5 l-6 2.5" /> },
  permit: { base: <><rect x="8" y="5" width="24" height="30" rx="1" /><path d="M13 13 h14 M13 19 h14" /></>, accent: <path d="M13 26 l3 3 l6-6" /> },
  driven_hunt: {
    base: <><circle cx="12" cy="13" r="4" /><circle cx="28" cy="13" r="4" /><path d="M4 32 c1-6 4-9 8-9 s7 3 8 9 M20 32 c1-6 4-9 8-9 s7 3 8 9" /></>,
    accent: <path d="M20 4 v6" />,
  },
  trophy_hunt: { base: <path d="M20 34 V22 M20 22 L12 13 L11 4 M12 13 L6 10 M20 22 L28 13 L29 4 M28 13 L34 10" />, accent: <path d="M16 22 h8 l-4 8 z" /> },
  helper: {
    base: <><ellipse cx="20" cy="26" rx="7" ry="6" /><circle cx="10" cy="16" r="3" /><circle cx="17" cy="10" r="3" /><circle cx="25" cy="10" r="3" /></>,
    accent: <circle cx="31" cy="16" r="3" />,
  },
};

export function KindIcon({ kind, size = 30, accent = true, className }: { kind: Kind; size?: number; accent?: boolean; className?: string }) {
  const shape = SHAPES[kind];
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      {shape.base}
      <g stroke={accent ? "var(--color-brand-ink)" : "currentColor"}>{shape.accent}</g>
    </svg>
  );
}
