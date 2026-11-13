/**
 * Gemeinsame Klassen der Komponentenbibliothek (M10a, docs/DESIGN.md). Seiten setzen Farben und Abstände nur
 * über diese Bausteine und die Tokens aus `app/globals.css`.
 */
const btnShape =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-btn px-4 py-2.5 font-display text-sm font-bold no-underline transition-colors disabled:cursor-not-allowed disabled:opacity-60";
const btnBase = `${btnShape} uppercase tracking-caps`;

export const ui = {
  container: "mx-auto w-full max-w-7xl px-4 sm:px-6",
  /** Hauptaktion: Marken-Orange mit Waldgrün (6,6 : 1). */
  btnPrimary: `${btnBase} bg-brand text-forest hover:bg-brand-hover hover:text-forest`,
  /** Hauptaktion mit längerem Text (z. B. Kontakt): ohne Großbuchstaben, damit sie in allen Sprachen lesbar bleibt. */
  btnPrimaryText: `${btnShape} bg-brand text-center text-forest hover:bg-brand-hover hover:text-forest`,
  /** Bestätigen und Suchen: Waldgrün. */
  btnDark: `${btnBase} bg-forest text-offwhite hover:bg-forest-hover hover:text-offwhite`,
  /** Endgültige Aktion (Sperren, Löschen, Ablehnen): Fehlerrot, nie Orange. */
  btnDanger: `${btnBase} bg-error text-offwhite hover:opacity-90`,
  /** Endgültige Nebenaktion: Rahmen in Fehlerrot. */
  btnDangerOutline: `${btnBase} border border-error bg-surface text-error hover:bg-error-soft`,
  /** Nebenaktion: Rahmen in Waldgrün. */
  btnSecondary: `${btnBase} border border-forest bg-surface text-forest hover:bg-sand hover:text-forest`,
  input: "w-full rounded-card border border-field bg-surface px-3 py-2.5 text-forest placeholder:text-muted",
  label: "mb-1 block text-sm font-semibold",
  card: "rounded-card border border-sand bg-surface",
  eyebrow: "font-display text-meta font-bold uppercase tracking-eyebrow text-brand-ink",
  /** Abschnittsüberschrift im Markenstil: Großbuchstaben, Punkt am Ende steht im Text. */
  headingCaps: "font-display font-extrabold uppercase",
  chip: "inline-flex items-center gap-1 rounded-pill bg-sand px-2.5 py-1 text-meta",
  muted: "text-muted",
  link: "font-semibold text-forest underline underline-offset-2 hover:text-brand-ink",
} as const;
