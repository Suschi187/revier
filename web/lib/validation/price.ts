import type { Database } from "@/lib/supabase/database.types";

export type Currency = Database["public"]["Enums"]["currency_code"];

// Alle vier Währungen haben 2 Nachkommastellen (Minor-Einheit = 1/100). Grenzen wie der DB-Check
// price_bounds (ADR 013, Review Plan M3 D3), in Minor-Einheiten.
export const PRICE_EXPONENT = 2;
export const PRICE_MAX_MINOR: Record<Currency, number> = {
  EUR: 1_000_000_000,
  CHF: 1_000_000_000,
  CZK: 25_000_000_000,
  PLN: 5_000_000_000,
};

export type PriceError = "required" | "invalid" | "negative" | "tooManyDecimals" | "zero" | "tooLarge";
export type PriceResult = { ok: true; minor: number } | { ok: false; error: PriceError };

const GROUP = /[\s  ']/g;

/**
 * Wandelt eine Eingabe wie „1.234,50“, „1 234.5“ oder „1500“ in Minor-Einheiten um, ohne Gleitkomma.
 * Regeln: Leerzeichen und Apostroph trennen Tausender. Kommen Komma und Punkt vor, ist das letzte das
 * Dezimalzeichen. Kommt nur eines vor, ist es ein Tausendertrenner, wenn es mehrfach vorkommt oder genau
 * drei Ziffern folgen; sonst das Dezimalzeichen.
 */
export function parsePrice(input: string, currency: Currency): PriceResult {
  let text = input.trim().replace(GROUP, "");
  if (text === "") return { ok: false, error: "required" };
  if (text.startsWith("-")) return { ok: false, error: "negative" };
  if (!/^[0-9.,]+$/.test(text)) return { ok: false, error: "invalid" };

  const lastComma = text.lastIndexOf(",");
  const lastPoint = text.lastIndexOf(".");
  let decimal: "," | "." | null = null;
  if (lastComma >= 0 && lastPoint >= 0) {
    decimal = lastComma > lastPoint ? "," : ".";
  } else if (lastComma >= 0 || lastPoint >= 0) {
    const sep = lastComma >= 0 ? "," : ".";
    const count = text.split(sep).length - 1;
    const after = text.length - text.lastIndexOf(sep) - 1;
    decimal = count === 1 && after !== 3 ? sep : null;
  }

  let whole = text;
  let fraction = "";
  if (decimal) {
    const at = text.lastIndexOf(decimal);
    whole = text.slice(0, at);
    fraction = text.slice(at + 1);
    if (/[.,]/.test(fraction)) return { ok: false, error: "invalid" };
  }
  // Tausendertrenner nur in Dreiergruppen
  const groups = whole.split(/[.,]/);
  if (groups.length > 1 && (groups[0] === "" || groups.slice(1).some((g) => g.length !== 3))) {
    return { ok: false, error: "invalid" };
  }
  whole = groups.join("");
  if (whole === "" && fraction === "") return { ok: false, error: "invalid" };
  if (fraction.length > PRICE_EXPONENT) return { ok: false, error: "tooManyDecimals" };
  if (whole.length > 15) return { ok: false, error: "tooLarge" };

  text = (whole || "0") + fraction.padEnd(PRICE_EXPONENT, "0");
  const minor = Number(text);
  if (minor === 0) return { ok: false, error: "zero" };
  if (minor > PRICE_MAX_MINOR[currency]) return { ok: false, error: "tooLarge" };
  return { ok: true, minor };
}

/** Minor-Einheiten als Eingabetext („1234,50“ bzw. „1234.50“) für Formulare. */
export function minorToInput(minor: number, decimalSeparator: "," | "."): string {
  const whole = Math.floor(minor / 100);
  const cents = minor % 100;
  return cents === 0 ? String(whole) : `${whole}${decimalSeparator}${String(cents).padStart(2, "0")}`;
}

/** Nur zur Anzeige (Intl); gespeichert und gerechnet wird immer mit ganzen Minor-Einheiten. */
export function formatPrice(minor: number, currency: Currency, locale: string): string {
  const format = new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: minor % 100 ? 2 : 0 });
  return format.format(minor / 100);
}
