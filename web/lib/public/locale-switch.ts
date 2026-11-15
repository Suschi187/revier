import type { AppLocale } from "@/i18n/routing";
import { canonicalPath } from "@/lib/auth/paths";
import { filtersFromParams, paramsFromFilters, VIEW_PARAM, type Filters } from "@/lib/search/filters";
import { hasFilterQuery, parsePath, publicPath, type PublicRoute } from "./paths";

/** Längere Query-Strings fallen beim Sprachwechsel weg (Referer aus fremder Hand, keine beliebig langen Location-Header). */
const MAX_QUERY = 1000;

/** Filter, die der Pfad schon festlegt; sie stehen wie auf der Liste selbst nicht in der Query. */
function pathKeys(page: PublicRoute): (keyof Filters)[] {
  if (page.route === "kind") return ["kind"];
  if (page.route === "state" || page.route === "district") return ["kind", "region"];
  return [];
}

/**
 * Ziel des Sprachwechsels (ADR 015): öffentliche Seiten über ihre übersetzten URL-Wörter; die Filter-Query wird
 * aus den geprüften Filtern neu gebaut (ADR 022, K7), fremde Parameter (`utm_*`, Blätter-Position) fallen weg,
 * die Kartenansicht bleibt. Der Suchtext bleibt, weil das Ziel weder in Login-Links noch in Auth-Logs landet.
 * Andere Seiten tauschen nur das Sprachpräfix. Unbekannte Pfade führen zur Startseite.
 * Das Ergebnis ist immer ein eigener Pfad unter `/{target}`, nie eine fremde URL.
 */
export function switchLocaleHref(pathname: string, search: string, target: AppLocale): string {
  const canonical = canonicalPath(pathname);
  if (!canonical) return `/${target}`;
  const parsed = parsePath(canonical);
  if (parsed.type === "public") {
    const path = publicPath(parsed.page, target);
    const raw = search.replace(/^\?/, "");
    if (!hasFilterQuery(parsed.page) || raw.length === 0 || raw.length > MAX_QUERY) return path;
    const params = new URLSearchParams(raw);
    const query = paramsFromFilters(filtersFromParams(params), pathKeys(parsed.page));
    if (params.get(VIEW_PARAM) === "map") query.set(VIEW_PARAM, "map");
    const rebuilt = query.toString();
    return rebuilt ? `${path}?${rebuilt}` : path;
  }
  if (parsed.type === "static") return `/${target}${canonical.slice(parsed.locale.length + 1)}`;
  return `/${target}`;
}
