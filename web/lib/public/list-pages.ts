import "server-only";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { publicAlternates } from "@/i18n/metadata";
import type { AppLocale } from "@/i18n/routing";
import type { Crumb } from "@/components/public/Breadcrumbs";
import { publicPath, type PublicRoute } from "@/lib/public/paths";
import { regionFromSlugs } from "@/lib/public/regions";
import type { Filters } from "@/lib/search/filters";
import { cacheEpoch, regionCounts } from "@/lib/services/public-listings";
import { regionNames } from "@/lib/services/regions";

// Gemeinsames für Kategorie-, Regions- und Suchseiten (ADR 015): Überschrift, Brotkrumen, feste Filter und
// Metadaten. Titel ohne Kasusbildung („Pronájem honitby – Bavorsko“, Review A7).

export type ListPage = Extract<PublicRoute, { route: "kind" | "state" | "district" | "search" }>;

export type ListContext = { heading: string; title: string; crumbs: Crumb[]; fixed: Partial<Filters>; regionCode: string | null };

export async function listContext(page: ListPage, locale: AppLocale): Promise<ListContext | null> {
  const [t, tp, names] = await Promise.all([getTranslations("Listings"), getTranslations("Public"), regionNames(locale)]);
  const home: Crumb = { name: tp("home.crumb"), href: publicPath({ route: "home" }, locale) };
  if (page.route === "search") {
    return { heading: tp("search.heading"), title: tp("search.metaTitle"), crumbs: [home, { name: tp("search.heading"), href: publicPath(page, locale) }], fixed: {}, regionCode: null };
  }
  const kindName = t(`kinds.${page.kind}`);
  const crumbs: Crumb[] = [home, { name: kindName, href: publicPath({ route: "kind", kind: page.kind }, locale) }];
  if (page.route === "kind") return { heading: kindName, title: kindName, crumbs, fixed: { kind: page.kind }, regionCode: null };

  const state = regionFromSlugs(page.state);
  if (!state) return null;
  const stateName = names[state.code] ?? state.code;
  crumbs.push({ name: stateName, href: publicPath({ route: "state", kind: page.kind, state: page.state }, locale) });
  if (page.route === "state") {
    const title = `${kindName} – ${stateName}`;
    return { heading: title, title, crumbs, fixed: { kind: page.kind, region: state.code }, regionCode: state.code };
  }
  const district = regionFromSlugs(page.state, page.district);
  if (!district) return null;
  const districtName = names[district.code] ?? district.code;
  crumbs.push({ name: districtName, href: publicPath(page, locale) });
  const title = `${kindName} – ${districtName}, ${stateName}`;
  return { heading: title, title, crumbs, fixed: { kind: page.kind, region: district.code }, regionCode: district.code };
}

/**
 * Indexierbar nur ohne Query und mit Anzeigen; die Suche nie. Seiten mit Query: `noindex, follow` ohne
 * Canonical und hreflang (widersprüchliche Signale vermeiden, Review A7).
 */
export async function listMetadata(page: ListPage, locale: AppLocale, withQuery: boolean): Promise<Metadata> {
  const context = await listContext(page, locale);
  if (!context) return { robots: { index: false, follow: false } };
  const t = await getTranslations("Public.list");
  const description = t("metaDescription", { title: context.title });
  if (withQuery || page.route === "search") {
    return { title: context.title, description, robots: { index: false, follow: true } };
  }
  const counts = await regionCounts(page.kind, await cacheEpoch());
  const empty = context.regionCode ? !counts.some((c) => c.code === context.regionCode) : counts.length === 0;
  return {
    title: context.title,
    description,
    alternates: publicAlternates(locale, page),
    ...(empty ? { robots: { index: false, follow: true } } : {}),
  };
}
