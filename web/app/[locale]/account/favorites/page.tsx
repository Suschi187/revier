import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { ListingList } from "@/components/public/ListingCard";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { regionByCode, regionFromSlugs } from "@/lib/public/regions";
import { favoritesOverview } from "@/lib/services/favorites";
import { requireOnboardedUser } from "@/lib/services/gate";
import type { ListingCard, PublicListing } from "@/lib/services/public-listings";
import { regionNames } from "@/lib/services/regions";
import { removeUnavailableFavorites } from "./actions";

// Gemerkte Anzeigen (ADR 015, Review A10). Ohne Suspense, damit die Liste ohne JavaScript sichtbar ist.
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Favorites");
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

function toCard(l: PublicListing): ListingCard {
  const district = regionByCode(l.districtCode);
  const state = district ? regionFromSlugs(district.stateSlug) : null;
  const photo = l.photos[0];
  return {
    id: l.id,
    kind: l.kind,
    direction: l.direction,
    title: l.title,
    content_language: l.contentLanguage,
    country: l.country,
    district_code: l.districtCode,
    state_code: state?.code ?? "",
    postal_prefix: l.postalPrefix,
    price_minor: l.priceMinor,
    currency: l.currency,
    price_unit: l.priceUnit,
    area_hectares: l.areaHectares,
    start_date: l.startDate,
    end_date: l.endDate,
    event_date: null,
    published_at: l.publishedAt,
    photo: photo ? { id: photo.id, width: photo.width, height: photo.height, alt_text: photo.altText } : null,
    provider: l.provider,
  };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function FavoritesPage(props: Props) {
  const locale = (await getLocale()) as AppLocale;
  const path = `/${locale}/account/favorites`;
  const user = await requireOnboardedUser(locale, path);
  const [t, overview, regions, query] = await Promise.all([
    getTranslations("Favorites"),
    favoritesOverview(),
    regionNames(locale),
    props.searchParams,
  ]);
  const unavailable = overview.unavailableIds.length;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
      <Link href="/account" className="underline">{t("back")}</Link>
      <h1 className="mt-4 text-3xl font-semibold">{t("title")}</h1>
      {query.notice === "removed" && <p className="mt-4" role="status">{t("removedNotice")}</p>}
      {(query.error === "failed" || query.error === "limit") && <p className="mt-4" role="alert">{t(query.error)}</p>}
      <ListingList
        items={overview.available.map(toCard)}
        locale={locale}
        regions={regions}
        empty={t("empty")}
        favorites={{ ids: new Set(overview.available.map((l) => l.id)), signedIn: true, userId: user.id, back: path }}
      />
      {unavailable > 0 && (
        <form action={removeUnavailableFavorites} className="mt-6 flex flex-wrap items-center gap-3 rounded border border-stone-300 p-3">
          <input type="hidden" name="locale" value={locale} />
          <p>{t("unavailable", { count: unavailable })}</p>
          <button type="submit" className="rounded border border-stone-500 px-3 py-1">{t("removeUnavailable")}</button>
        </form>
      )}
    </main>
  );
}
