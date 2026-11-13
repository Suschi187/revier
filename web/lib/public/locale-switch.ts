import type { AppLocale } from "@/i18n/routing";
import { canonicalPath } from "@/lib/auth/paths";
import { hasFilterQuery, parsePath, publicPath } from "./paths";

/** Längere Query-Strings fallen beim Sprachwechsel weg (Referer aus fremder Hand, keine beliebig langen Location-Header). */
const MAX_QUERY = 1000;

/**
 * Ziel des Sprachwechsels (ADR 015): öffentliche Seiten über ihre übersetzten URL-Wörter, Filter im Query-String
 * bleiben erhalten; andere Seiten tauschen nur das Sprachpräfix. Unbekannte Pfade führen zur Startseite.
 * Das Ergebnis ist immer ein eigener Pfad unter `/{target}`, nie eine fremde URL.
 */
export function switchLocaleHref(pathname: string, search: string, target: AppLocale): string {
  const canonical = canonicalPath(pathname);
  if (!canonical) return `/${target}`;
  const parsed = parsePath(canonical);
  if (parsed.type === "public") {
    const query = search.replace(/^\?/, "");
    const keep = hasFilterQuery(parsed.page) && query.length > 0 && query.length <= MAX_QUERY;
    return publicPath(parsed.page, target) + (keep ? `?${query}` : "");
  }
  if (parsed.type === "static") return `/${target}${canonical.slice(parsed.locale.length + 1)}`;
  return `/${target}`;
}
