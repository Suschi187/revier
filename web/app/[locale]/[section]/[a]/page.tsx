import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { hasQuery, ListingsPage, type SearchParams } from "@/components/public/ListingsPage";
import { ListingDetail } from "@/components/public/ListingDetail";
import { providerName, ProviderPage } from "@/components/public/ProviderPage";
import { publicAlternates } from "@/i18n/metadata";
import type { AppLocale } from "@/i18n/routing";
import { photoUrl } from "@/lib/public/format";
import { listContext, listMetadata } from "@/lib/public/list-pages";
import { parsePath, type PublicRoute } from "@/lib/public/paths";
import { cacheEpoch, getProvider, getPublicListing, providerListings } from "@/lib/services/public-listings";
import { regionNames, speciesNames } from "@/lib/services/regions";

// Zweisegmentige Formen (ADR 015): Bundesland (/{l}/{kind}/{state}), Anzeige (/{l}/{detail}/{id}) und
// Anbieter (/{l}/{provider}/{id}). Den Status (404/410) setzt der Proxy; fehlt die Anzeige trotzdem (Proxy-
// Prüfung gescheitert), folgt ein Soft 404 mit noindex. Ohne Suspense, damit alles ohne JavaScript im HTML steht.
export const instant = false;

type Props = { params: Promise<{ locale: string; section: string; a: string }>; searchParams: Promise<SearchParams> };
type Resolved = { locale: AppLocale; page: Extract<PublicRoute, { route: "state" | "listing" | "provider" }> };

async function resolve(props: Props): Promise<Resolved | null> {
  const { locale, section, a } = await props.params;
  const parsed = parsePath(`/${locale}/${section}/${a}`);
  if (parsed.type !== "public") return null;
  const page = parsed.page;
  if (page.route !== "state" && page.route !== "listing" && page.route !== "provider") return null;
  return { locale: parsed.locale, page };
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const resolved = await resolve(props);
  if (!resolved) return {};
  const { locale, page } = resolved;
  if (page.route === "state") return listMetadata(page, locale, hasQuery(await props.searchParams));
  if (page.route === "listing") {
    const listing = await getPublicListing(page.id, await cacheEpoch());
    if (!listing) return { robots: { index: false, follow: false } };
    const description = listing.description.replace(/\s+/g, " ").trim().slice(0, 160);
    const image = listing.photos[0];
    return {
      title: listing.title,
      description,
      alternates: publicAlternates(locale, page),
      openGraph: {
        title: listing.title,
        description,
        type: "website",
        ...(image ? { images: [{ url: photoUrl(image.id, "full"), alt: image.altText ?? listing.title }] } : {}),
      },
    };
  }
  const provider = await getProvider(page.id, await cacheEpoch());
  if (!provider) return { robots: { index: false, follow: false } };
  const t = await getTranslations("Public.provider");
  // Privatpersonen: noindex und nicht in der Sitemap (Datensparsamkeit, Review 10.1 Frage 3); Gewerbe indexierbar.
  const business = provider.account_type === "business";
  const withCursor = hasQuery(await props.searchParams);
  return {
    title: providerName(provider),
    description: t("metaDescription", { name: providerName(provider) }),
    ...(business && !withCursor ? { alternates: publicAlternates(locale, page) } : { robots: { index: false, follow: true } }),
  };
}

export default async function TwoSegmentPage(props: Props) {
  const resolved = await resolve(props);
  if (!resolved) notFound();
  const { locale, page } = resolved;

  if (page.route === "listing") {
    const listing = await getPublicListing(page.id, await cacheEpoch());
    if (!listing) notFound();
    const [regions, species] = await Promise.all([regionNames(locale), speciesNames(locale)]);
    return <ListingDetail listing={listing} locale={locale} regions={regions} species={species} />;
  }
  if (page.route === "provider") {
    const epoch = await cacheEpoch();
    const raw = (await props.searchParams).cursor;
    const cursor = typeof raw === "string" && raw.length <= 200 ? raw : null;
    const [provider, listings, regions] = await Promise.all([getProvider(page.id, epoch), providerListings(page.id, cursor, epoch), regionNames(locale)]);
    if (!provider || !listings) notFound();
    return <ProviderPage provider={provider} listings={listings} locale={locale} regions={regions} cursor={cursor} />;
  }

  const context = await listContext(page, locale);
  if (!context) notFound();
  return (
    <ListingsPage
      locale={locale}
      page={page}
      fixed={context.fixed}
      searchParams={await props.searchParams}
      heading={context.heading}
      crumbs={context.crumbs}
    />
  );
}
