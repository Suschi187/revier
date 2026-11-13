import { Icon } from "./Icon";

/**
 * Blättern (Styleguide „Seiten“). Die Suche blättert über einen Cursor, deshalb ohne Seitenzahlen: „Zum Anfang“
 * und „Weiter“ als 44-px-Kacheln.
 */
export function Pager({ label, first, next }: { label: string; first?: { href: string; text: string } | null; next?: { href: string; text: string } | null }) {
  if (!first && !next) return null;
  const link = "inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-btn border border-sand bg-surface px-4 font-semibold text-forest no-underline hover:border-forest hover:text-forest";
  return (
    <nav aria-label={label} className="mt-6 flex flex-wrap justify-center gap-2">
      {first && <a href={first.href} className={link}><Icon name="chevron" size={18} className="rotate-180" />{first.text}</a>}
      {next && <a href={next.href} rel="next" className={link}>{next.text}<Icon name="chevron" size={18} /></a>}
    </nav>
  );
}
