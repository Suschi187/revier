import type { ReactNode } from "react";

export type NavItem = { key: string; label: ReactNode; href: string; active: boolean };

/** Reiter als Links (ohne JavaScript): aktive Lasche mit 3 px Marken-Orange darunter, Text bleibt Waldgrün. */
export function TabLinks({ label, items }: { label: string; items: NavItem[] }) {
  return (
    <nav aria-label={label} className="flex max-w-full overflow-x-auto border-b border-sand">
      {items.map((item) => (
        <a
          key={item.key}
          href={item.href}
          aria-current={item.active ? "page" : undefined}
          className={`-mb-px flex min-h-11 shrink-0 items-center border-b-3 px-4 font-display text-sm uppercase tracking-caps no-underline ${
            item.active ? "border-brand font-extrabold text-forest hover:text-forest" : "border-transparent font-bold text-muted hover:text-forest"
          }`}
        >
          {item.label}
        </a>
      ))}
    </nav>
  );
}

/** Umschalter als Pille (z. B. Liste/Karte): aktive Wahl in Waldgrün. */
export function SegmentLinks({ label, items, className = "" }: { label: string; items: NavItem[]; className?: string }) {
  return (
    <nav aria-label={label} className={`inline-flex rounded-pill border border-field bg-surface p-0.5 ${className}`}>
      {items.map((item) => (
        <a
          key={item.key}
          href={item.href}
          aria-current={item.active ? "page" : undefined}
          className={`flex min-h-10 items-center rounded-pill px-4 text-sm font-semibold no-underline ${
            item.active ? "bg-forest text-offwhite hover:text-offwhite" : "text-forest"
          }`}
        >
          {item.label}
        </a>
      ))}
    </nav>
  );
}
