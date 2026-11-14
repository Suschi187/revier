import { Icon } from "@/components/ui/Icon";
import { ui } from "@/components/ui/styles";
import type { FilterChip } from "@/lib/search/chips";

/**
 * Filterleiste über der Trefferliste: je aktivem Filter ein Chip als Link ohne diesen Filter (ohne JavaScript
 * bedienbar), ab zwei Chips „Alle entfernen“.
 */
export function FilterChips({
  chips,
  clearAll,
  texts,
}: {
  chips: FilterChip[];
  clearAll: string;
  texts: { label: string; remove: (label: string) => string; clearAll: string };
}) {
  if (chips.length === 0) return null;
  return (
    <nav aria-label={texts.label}>
      <ul className="flex flex-wrap items-center gap-2">
        {chips.map((chip) => (
          <li key={chip.key} className="min-w-0">
            <a
              href={chip.href}
              aria-label={texts.remove(chip.label)}
              className={`${ui.chip} min-h-9 max-w-full gap-1.5 text-forest no-underline hover:bg-forest hover:text-offwhite`}
            >
              <span className="[overflow-wrap:anywhere]">{chip.label}</span>
              <Icon name="close" size={14} className="shrink-0" />
            </a>
          </li>
        ))}
        {chips.length > 1 && (
          <li>
            <a href={clearAll} className={`${ui.link} text-meta`}>{texts.clearAll}</a>
          </li>
        )}
      </ul>
    </nav>
  );
}

/** Überschrift des Filter-Knopfs mit Zähler der aktiven Filter (Zahl sichtbar, Satz für Screenreader). */
export function FilterHeading({ heading, count, countText }: { heading: string; count: number; countText: string }) {
  return (
    <span className="flex items-center gap-2">
      {heading}
      {count > 0 && (
        <>
          <span aria-hidden="true" className={ui.countBadge}>{count}</span>
          <span className="sr-only">{countText}</span>
        </>
      )}
    </span>
  );
}
