import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { publicPath, type PublicRoute } from "@/lib/public/paths";
import { regionByCode } from "@/lib/public/regions";
import { CURSOR_PARAM, filtersFromParams, paramsFromFilters, type Filters } from "@/lib/search/filters";
import { favoriteContext } from "@/lib/services/favorites";
import { cachedListings, cacheEpoch, regionCounts, searchListings, type SearchResult } from "@/lib/services/public-listings";
import { listSpecies, regionNames } from "@/lib/services/regions";
import { Breadcrumbs, type Crumb } from "./Breadcrumbs";
import { FilterForm } from "./FilterForm";
import { ListingList } from "./ListingCard";

export type SearchParams = Record<string, string | string[] | undefined>;

const PAGE_SIZE = 20;

/** Ob eine Listenseite Query-Parameter trägt (dann `noindex, follow`, ohne Canonical und hreflang; Review A7). */
export function hasQuery(searchParams: SearchParams): boolean {
  return Object.values(searchParams).some((v) => v !== undefined && v !== "");
}

/**
 * Kategorie-, Regions- und Suchseite (ADR 015): feste Werte aus dem Pfad, Rest aus dem Query-String. Ohne
 * Query gecacht, mit Query oder Cursor ungecacht. Ohne Suspense, damit alles ohne JavaScript im HTML steht.
 */
export async function ListingsPage({
  locale,
  page,
  fixed,
  searchParams,
  heading,
  crumbs,
}: {
  locale: AppLocale;
  page: PublicRoute;
  fixed: Partial<Filters>;
  searchParams: SearchParams;
  heading: string;
  crumbs: Crumb[];
}) {
  const t = await getTranslations("Public.list");
  const path = publicPath(page, locale);
  const filters = filtersFromParams(searchParams, fixed);
  const rawCursor = searchParams[CURSOR_PARAM];
  const cursor = typeof rawCursor === "string" && rawCursor.length <= 200 ? rawCursor : null;
  const epoch = await cacheEpoch();
  const currentPath = `${path}${hasQuery(searchParams) ? `?${paramsFromFilters(filtersFromParams(searchParams, fixed), Object.keys(fixed) as (keyof Filters)[])}` : ""}`;
  const favorites = await favoriteContext(currentPath);

  const [result, names, species, counts]: [SearchResult, Record<string, string>, Awaited<ReturnType<typeof listSpecies>>, Awaited<ReturnType<typeof regionCounts>>] =
    await Promise.all([
      hasQuery(searchParams) ? searchListings(filters, cursor, PAGE_SIZE) : cachedListings(filters, PAGE_SIZE, epoch),
      regionNames(locale),
      listSpecies(locale),
      page.route === "kind" || page.route === "state" ? regionCounts(fixed.kind ?? null, epoch) : Promise.resolve([]),
    ]);

  // Links nur auf Regionen mit Anzeigen (Review A7): Bundesländer auf der Kategorieseite, Kreise darunter.
  const regionLinks =
    page.route === "kind" || page.route === "state"
      ? counts
          .map((c) => ({ ...c, ref: regionByCode(c.code) }))
          .filter((c) => c.ref && (page.route === "kind" ? c.level === "state" : c.level === "district" && c.ref.stateSlug === page.state))
          .map((c) => ({
            code: c.code,
            count: c.listings,
            name: names[c.code] ?? c.code,
            href: publicPath(
              page.route === "kind"
                ? { route: "state", kind: page.kind, state: c.ref!.slug }
                : { route: "district", kind: page.kind, state: page.state, district: c.ref!.slug },
              locale,
            ),
          }))
          .sort((a, b) => a.name.localeCompare(b.name, locale))
      : [];

  const fixedKeys = Object.keys(fixed) as (keyof Filters)[];
  const query = paramsFromFilters(filters, fixedKeys);
  const nextHref = result.ok && result.page.nextCursor ? `${path}?${new URLSearchParams([...query, [CURSOR_PARAM, result.page.nextCursor]])}` : null;
  const firstHref = cursor ? `${path}${query.size ? `?${query}` : ""}` : null;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
      <Breadcrumbs crumbs={crumbs} />
      <h1 className="mt-2 text-3xl font-semibold">{heading}</h1>

      {regionLinks.length > 0 && (
        <nav aria-labelledby="region-links" className="mt-6">
          <h2 id="region-links" className="text-lg font-semibold">{t(page.route === "kind" ? "states" : "districts")}</h2>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {regionLinks.map((r) => (
              <li key={r.code}>
                <a href={r.href} className="underline">{r.name}</a> <span className="text-sm text-stone-700">({r.count})</span>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <FilterForm action={path} filters={filters} fixed={fixedKeys} locale={locale} species={species} regionNames={names} />

      <section aria-labelledby="results-heading" className="mt-8">
        <h2 id="results-heading" className="text-xl font-semibold">{t("results")}</h2>
        {result.ok ? (
          <>
            <p className="mt-1" aria-live="polite">
              {result.page.totalCapped ? t("countCapped") : t("count", { count: result.page.total ?? result.page.items.length })}
            </p>
            <ListingList items={result.page.items} locale={locale} regions={names} empty={t("empty")} favorites={favorites} />
            {(nextHref || firstHref) && (
              <nav aria-label={t("paging")} className="mt-6 flex gap-4">
                {firstHref && <a href={firstHref} className="underline">{t("first")}</a>}
                {nextHref && <a href={nextHref} rel="next" className="underline">{t("next")}</a>}
              </nav>
            )}
          </>
        ) : (
          <p className="mt-2" role="alert">{t(result.error === "invalid" ? "invalid" : "failed")}</p>
        )}
      </section>
    </main>
  );
}
