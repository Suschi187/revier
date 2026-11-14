import { getTranslations } from "next-intl/server";
import { ListingsMap } from "@/components/map/ListingsMap";
import { ui } from "@/components/ui/styles";
import { SaveSearch } from "@/components/saved-searches/SaveSearch";
import { boundsAround, DEFAULT_BOUNDS, type Bounds } from "@/lib/map/bounds";
import { tilesUrl } from "@/lib/map/tiles";
import type { AppLocale } from "@/i18n/routing";
import { publicPath, type PublicRoute } from "@/lib/public/paths";
import { regionByCode } from "@/lib/public/regions";
import { filterChips } from "@/lib/search/chips";
import { CURSOR_PARAM, filtersFromParams, paramsFromFilters, VIEW_PARAM, type Filters } from "@/lib/search/filters";
import { favoriteContext } from "@/lib/services/favorites";
import { filterTexts } from "@/lib/saved-searches/texts";
import { cachedListings, cacheEpoch, regionCounts, searchListings, type SearchResult } from "@/lib/services/public-listings";
import { listSpecies, regionGeo, regionNames } from "@/lib/services/regions";
import { Breadcrumbs, type Crumb } from "./Breadcrumbs";
import { FilterChips, FilterHeading } from "./FilterChips";
import { FilterForm } from "./FilterForm";
import { ListingList } from "./ListingCard";
import { Pager } from "@/components/ui/Pager";
import { SegmentLinks, TabLinks } from "@/components/ui/Tabs";

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
  // Ansicht Karte (ADR 016): kein Filter, bleibt aber in Paging, Formular und Bereichssuche erhalten.
  const mapView = searchParams[VIEW_PARAM] === "map";
  const query = paramsFromFilters(filters, fixedKeys);
  if (mapView) query.set(VIEW_PARAM, "map");
  const nextHref = result.ok && result.page.nextCursor ? `${path}?${new URLSearchParams([...query, [CURSOR_PARAM, result.page.nextCursor]])}` : null;
  const firstHref = cursor ? `${path}${query.size ? `?${query}` : ""}` : null;
  const listQuery = paramsFromFilters(filters, fixedKeys);
  const listHref = `${path}${listQuery.size ? `?${listQuery}` : ""}`;
  const mapHref = `${path}?${new URLSearchParams([...listQuery, [VIEW_PARAM, "map"]])}`;
  const [tm, tl, tf, texts] = await Promise.all([getTranslations("Map"), getTranslations("Listings"), getTranslations("Public.filters"), filterTexts(locale)]);
  // Filterleiste (DESIGN.md „Bausteine“): Chips der aktiven Filter, Zähler am Filter-Knopf.
  const active = filterChips(filters, fixedKeys, locale, texts, path, mapView ? { [VIEW_PARAM]: "map" } : {});
  // Umschalter Angebote/Gesuche als Links (ohne JavaScript, gleiche Filter wie das Formular).
  const directionHref = (direction: Filters["direction"]) => {
    const q = paramsFromFilters({ ...filters, direction }, fixedKeys);
    if (mapView) q.set(VIEW_PARAM, "map");
    return `${path}${q.size ? `?${q}` : ""}`;
  };
  const directions = [
    { key: "all", label: tf("any"), value: undefined },
    { key: "offer", label: tl("directions.offer"), value: "offer" as const },
    { key: "wanted", label: tl("directions.wanted"), value: "wanted" as const },
  ];
  let mapBounds: Bounds = DEFAULT_BOUNDS;
  if (mapView) {
    const regionCode = filters.region;
    const geo = regionCode ? (await regionGeo())[regionCode] : undefined;
    mapBounds = filters.bbox ?? (geo ? boundsAround(geo.lng, geo.lat, geo.areaKm2) : DEFAULT_BOUNDS);
  }

  return (
    <main className={`${ui.container} flex-1 py-4 sm:py-6`}>
      <Breadcrumbs crumbs={crumbs} />
      <h1 className={`${ui.headingCaps} mt-2 text-2xl [overflow-wrap:anywhere] hyphens-auto`}>{heading}</h1>

      {regionLinks.length > 0 && (
        <nav aria-labelledby="region-links" className="mt-4">
          <h2 id="region-links" className="text-sm font-semibold">{t(page.route === "kind" ? "states" : "districts")}</h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {regionLinks.map((r) => (
              <li key={r.code}>
                <a href={r.href} className={`${ui.chip} min-h-9 text-forest no-underline hover:bg-forest hover:text-offwhite`}>
                  {r.name} <span className="text-muted">({r.count})</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <div className="mt-5 flex flex-col gap-6 lg:flex-row lg:items-start">
        {/* Mobil aufklappbar, ab Desktop immer offen (::details-content); ohne Unterstützung bleibt der Klick. */}
        <details className={`${ui.card} group shrink-0 lg:w-72 lg:[&::details-content]:[content-visibility:visible] lg:[&::details-content]:block`}>
          <summary className="flex min-h-12 cursor-pointer items-center justify-between px-4 font-display text-sm font-extrabold uppercase tracking-caps">
            <FilterHeading heading={tf("heading")} count={active.chips.length} countText={tf("activeCount", { count: active.chips.length })} />
            <span aria-hidden="true" className="transition-transform group-open:rotate-180 lg:hidden">▾</span>
          </summary>
          <FilterForm action={path} filters={filters} fixed={fixedKeys} locale={locale} species={species} regionNames={names} keep={mapView ? { [VIEW_PARAM]: "map" } : {}} />
        </details>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <TabLinks
              label={tl("fields.direction")}
              items={directions.map((d) => ({ key: d.key, label: d.label, href: directionHref(d.value), active: filters.direction === d.value }))}
            />
            <SegmentLinks
              label={tm("viewLabel")}
              className="lg:ml-auto"
              items={[
                { key: "list", label: tm("viewList"), href: listHref, active: !mapView },
                { key: "map", label: tm("viewMap"), href: mapHref, active: mapView },
              ]}
            />
          </div>

          <FilterChips
            chips={active.chips}
            clearAll={active.clearAll}
            texts={{ label: tf("active"), remove: (label) => tf("remove", { label }), clearAll: tf("clearAll") }}
          />

          {/* Suchauftrag aus der Suche, Liste und Karte (ADR 018, Plan M8 5). */}
          {page.route === "search" && (
            <SaveSearch locale={locale} filters={filters} mapView={mapView} signedIn={favorites.signedIn} back={currentPath} error={searchParams.error} />
          )}

          {mapView && (
            <>
              <noscript>
                <p className={`${ui.card} p-3`}>{tm("noscript")}</p>
              </noscript>
              <ListingsMap
                tilesUrl={tilesUrl()}
                locale={locale}
                bounds={mapBounds}
                query={paramsFromFilters(filters, ["bbox"]).toString()}
                path={path}
                texts={{
                  label: tm("label"),
                  attribution: tm.raw("attribution") as string,
                  failed: tm("failed"),
                  loading: tm("loading"),
                  loadFailed: tm("loadFailed"),
                  retry: tm("retry"),
                  truncated: tm("truncated"),
                  searchArea: tm("searchArea"),
                  searchAreaHint: tm("searchAreaHint"),
                  stack: tm.raw("stack") as string,
                  cluster: tm.raw("cluster") as string,
                  close: tm("close"),
                  count: tm.raw("count") as string,
                }}
              />
            </>
          )}

          <section aria-labelledby="results-heading">
            <h2 id="results-heading" className="sr-only">{t("results")}</h2>
            {result.ok ? (
              <>
                <p className="text-sm font-semibold" aria-live="polite">
                  {result.page.totalCapped ? t("countCapped") : t("count", { count: result.page.total ?? result.page.items.length })}
                </p>
                <ListingList items={result.page.items} locale={locale} regions={names} empty={t("empty")} favorites={favorites} eager={3} />
                <Pager
                  label={t("paging")}
                  first={firstHref ? { href: firstHref, text: t("first") } : null}
                  next={nextHref ? { href: nextHref, text: t("next") } : null}
                />
              </>
            ) : (
              <p className="mt-2 rounded-card bg-error-soft p-3 text-error" role="alert">{t(result.error === "invalid" ? (result.key === "q" ? "queryTooLong" : "invalid") : "failed")}</p>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
