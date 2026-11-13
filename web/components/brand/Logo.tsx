import { getTranslations } from "next-intl/server";

/** Bildmarke L1 „Geweih-Pin“ (docs/DESIGN.md 4): Kartenmarker in Marken-Orange mit ausgespartem Geweih. */
export function LogoMark({ size = 40, cutout = "var(--color-offwhite)" }: { size?: number; cutout?: string }) {
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 64 64">
      <path d="M32 62 L13 37 A22 22 0 1 1 51 37 Z" fill="var(--color-brand)" />
      <g fill="none" stroke={cutout} strokeWidth="2.8" strokeLinecap="square">
        <path d="M32 30 L24 21 L23 11" />
        <path d="M24 21 L18 18" />
        <path d="M32 30 L40 21 L41 11" />
        <path d="M40 21 L46 18" />
      </g>
      <path d="M27 29 L37 29 L32 40 Z" fill={cutout} />
    </svg>
  );
}

/** Lockup „REVIRO by Die Jagdbrüder“; der Markenname ist in allen Sprachen gleich, steht aber in den Message-Dateien. */
export async function Logo({ onDark = false, compact = false }: { onDark?: boolean; compact?: boolean }) {
  const t = await getTranslations("Brand");
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark size={compact ? 34 : 40} cutout={onDark ? "var(--color-forest)" : "var(--color-offwhite)"} />
      <span className="flex flex-col leading-none">
        <span className={`font-display font-black tracking-wordmark ${compact ? "text-xl" : "text-2xl"} ${onDark ? "text-offwhite" : "text-forest"}`}>
          {t("name")}
        </span>
        <span className={`mt-1 font-display text-logo-sub font-bold uppercase tracking-logo-sub ${onDark ? "text-brand" : "text-olive"}`}>
          {t("endorsement")}
        </span>
      </span>
    </span>
  );
}
