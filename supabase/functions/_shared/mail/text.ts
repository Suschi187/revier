// Gemeinsame Textregeln der Mail-Functions (ADR 017, ADR 018): Sprachen laut CLAUDE.md, Rückfall de, Nutzerinhalte
// nur bereinigt im Klartext (nie im Betreff oder in Headern).

export type Language = "de" | "en" | "cs" | "pl";

export const LANGUAGES: readonly Language[] = ["en", "de", "cs", "pl"];

export function language(value: unknown): Language {
  return value === "en" || value === "cs" || value === "pl" ? value : "de";
}

/** Steuerzeichen und Bidi-Steuerung aus Nutzerinhalten entfernen, auf `max` Zeichen kürzen (Klartext-Mail). */
export function clean(value: string, max = 120): string {
  // Steuerzeichen sind hier genau das Ziel der Regel (Zeilenumbrüche, Bidi), kein Versehen.
  // deno-lint-ignore no-control-regex
  const text = value.replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029\u202A-\u202E\u2066-\u2069]/g, " ").trim();
  return Array.from(text).slice(0, max).join("");
}
