import { routing, type AppLocale } from "@/i18n/routing";

// Interne, nicht indexierte Bereiche nach dem Sprachpräfix (ADR 010).
// Nur diese sind gültige Rücksprungziele; die Liste wächst mit den Schritten (z. B. Inserieren in M3).
const PROTECTED_SECTIONS = ["account", "welcome"] as const;

const LOCALE_GROUP = routing.locales.join("|");
const PROTECTED_RE = new RegExp(`^/(${LOCALE_GROUP})/(${PROTECTED_SECTIONS.join("|")})(/|$)`);
const NEXT_RE = new RegExp(
  `^/(${LOCALE_GROUP})(/(${PROTECTED_SECTIONS.join("|")})(/[A-Za-z0-9_-]+)*)?/?$`,
);
// Steuerzeichen, Backslash und kodierte Schrägstriche/Backslashes (auch doppelt kodiert).
const FORBIDDEN_RE = /[\u0000-\u001f\u007f\\]|%(25)*(2f|5c)/i;
const MAX_LENGTH = 512;
const BASE = "http://internal.invalid";

export function isAppLocale(value: string | undefined): value is AppLocale {
  return routing.locales.includes(value as AppLocale);
}

/** Sprache aus dem ersten Pfadsegment, sonst Default. */
export function localeFromPath(pathname: string): AppLocale {
  const segment = pathname.split("/")[1];
  return isAppLocale(segment) ? segment : routing.defaultLocale;
}

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_RE.test(pathname);
}

export function defaultNextPath(locale: AppLocale): string {
  return `/${locale}/account`;
}

/**
 * Prüft ein Rücksprungziel (`next`). Erlaubt sind nur relative Pfade dieser App mit Sprachpräfix
 * aus der Allowlist; Query und Fragment fallen weg. Alles andere führt auf das Konto.
 */
export function safeNextPath(raw: unknown, locale: AppLocale): string {
  const fallback = defaultNextPath(locale);
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_LENGTH) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || FORBIDDEN_RE.test(raw)) return fallback;

  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return fallback;
  }
  if (url.origin !== BASE) return fallback;
  return NEXT_RE.test(url.pathname) ? url.pathname : fallback;
}

/**
 * Liest `next` aus der redirect_to-URL der Bestätigungsmail (ADR 010). Die URL muss zur eigenen
 * Origin gehören; Supabase ersetzt unerlaubte Ziele zwar durch SITE_URL, geprüft wird trotzdem.
 */
export function nextFromRedirectTo(raw: unknown, siteUrl: string, locale: AppLocale): string {
  if (typeof raw !== "string" || raw.length > 2 * MAX_LENGTH) return defaultNextPath(locale);
  try {
    const url = new URL(raw);
    if (url.origin !== new URL(siteUrl).origin) return defaultNextPath(locale);
    return safeNextPath(url.searchParams.get("next"), locale);
  } catch {
    return defaultNextPath(locale);
  }
}
