import { routing, type AppLocale } from "@/i18n/routing";
import { hasFilterQuery, parsePath, publicPath } from "@/lib/public/paths";
import { regionFromSlugs } from "@/lib/public/regions";
import { filtersFromParams, paramsFromFilters } from "@/lib/search/filters";

// Interne, nicht indexierte Bereiche nach dem Sprachpräfix (ADR 010).
// Nur diese sind gültige Rücksprungziele; die Liste wächst mit den Schritten (z. B. Inserieren in M3).
export const PROTECTED_SECTIONS = ["account", "welcome", "admin"] as const;

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

const ADMIN_RE = new RegExp(`^/(${LOCALE_GROUP})/admin(/|$)`);

/** Admin-Bereich (ADR 014): Proxy prüft die Rolle, setzt die Nonce-CSP und antwortet sonst mit 403. */
export function isAdminPath(pathname: string): boolean {
  return ADMIN_RE.test(pathname);
}

/**
 * Kanonische Form eines Request-Pfads (QA M4 F1): vollständig dekodiert (auch mehrfach kodiert, `%2F`),
 * Steuerzeichen entfernt, Backslash und Mehrfach-Schrägstriche zu `/`, Punktsegmente aufgelöst und wieder
 * so kodiert, wie ein Browser den Pfad sendet. next-intl dekodiert Pfade vor dem Routing, `/de/%61dmin`
 * rendert also `/de/admin`; der Proxy darf deshalb nur über die kanonische Form entscheiden.
 * null bei ungültiger Kodierung oder kodiertem `?`/`#`.
 */
export function canonicalPath(pathname: string): string | null {
  let path = pathname;
  for (let round = 0; round < 5; round++) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      return null;
    }
    if (/[?#]/.test(decoded)) return null;
    decoded = decoded.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\\/g, "/").replace(/\/{2,}/g, "/");
    const next = new URL(decoded, BASE).pathname;
    if (next === path) return path;
    path = next;
  }
  return null;
}

export function defaultNextPath(locale: AppLocale): string {
  return `/${locale}/account`;
}

/**
 * Öffentliche Seite als Rücksprungziel (ADR 015, Review A9): nur in kanonischer Form, die der Parser selbst
 * erzeugt. Filter-Query nur für Listen, neu aufgebaut aus den geprüften Filtern und ohne Suchtext (H10).
 */
function publicNextPath(rawPath: string, url: URL): string | null {
  const parsed = parsePath(url.pathname);
  if (parsed.type !== "public" || publicPath(parsed.page, parsed.locale) !== rawPath) return null;
  const page = parsed.page;
  if ((page.route === "state" && !regionFromSlugs(page.state)) || (page.route === "district" && !regionFromSlugs(page.state, page.district))) {
    return null;
  }
  if (!hasFilterQuery(page)) return url.pathname;
  const query = paramsFromFilters(filtersFromParams(url.searchParams), ["q"]).toString();
  const path = query ? `${url.pathname}?${query}` : url.pathname;
  return path.length <= MAX_LENGTH ? path : url.pathname;
}

/**
 * Prüft ein Rücksprungziel (`next`). Erlaubt sind relative Pfade dieser App mit Sprachpräfix: geschützte
 * Bereiche aus der Allowlist (ohne Query) und öffentliche Seiten über den Parser. Fragmente fallen weg.
 * Alles andere führt auf das Konto.
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
  if (NEXT_RE.test(url.pathname)) return url.pathname;
  return publicNextPath(raw.split(/[?#]/)[0], url) ?? fallback;
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
