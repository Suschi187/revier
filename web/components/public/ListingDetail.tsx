import { getFormatter, getTranslations } from "next-intl/server";
import { AttributeRow } from "@/components/listings/ListingSummary";
import { DetailMap } from "@/components/map/DetailMap";
import { tilesUrl } from "@/lib/map/tiles";
import type { AppLocale } from "@/i18n/routing";
import { photoUrl, priceText, thumbSize } from "@/lib/public/format";
import { publicPath } from "@/lib/public/paths";
import { regionByCode, regionFromSlugs } from "@/lib/public/regions";
import { getSessionUser } from "@/lib/services/auth";
import type { PublicListing } from "@/lib/services/public-listings";
import { favoriteContext } from "@/lib/services/favorites";
import { Breadcrumbs, type Crumb } from "./Breadcrumbs";
import { FavoriteButton } from "./FavoriteButton";

/**
 * Öffentliches Detail (SPEC 4.2, ADR 015): Galerie, Eckdaten, Anbieterbadge, Kontakt nur nach Login. Nie PLZ,
 * Ort oder Kontaktdaten; der Text wird als Text gerendert, ohne Autolinks (Review A11).
 */
export async function ListingDetail({
  listing,
  locale,
  regions,
  species,
}: {
  listing: PublicListing;
  locale: AppLocale;
  regions: Record<string, string>;
  species: Record<string, string>;
}) {
  const [t, tp, tProfile, format] = await Promise.all([
    getTranslations("Listings"),
    getTranslations("Public.detail"),
    getTranslations("Profile"),
    getFormatter(),
  ]);
  const tm = await getTranslations("Map");
  const district = districtRef(listing.districtCode, regions);
  const price = priceText(listing, locale, (key) => t(key as never)) ?? t("preview.noPrice");
  const date = (value: string) => format.dateTime(new Date(`${value}T00:00:00Z`), { dateStyle: "medium", timeZone: "UTC" });
  const crumbs: Crumb[] = [
    { name: (await getTranslations("Public.home"))("crumb"), href: publicPath({ route: "home" }, locale) },
    { name: t(`kinds.${listing.kind}`), href: publicPath({ route: "kind", kind: listing.kind }, locale) },
    ...(district
      ? [
          { name: district.stateName, href: publicPath({ route: "state", kind: listing.kind, state: district.stateSlug }, locale) },
          { name: district.name, href: publicPath({ route: "district", kind: listing.kind, state: district.stateSlug, district: district.slug }, locale) },
        ]
      : []),
    { name: listing.title, href: publicPath({ route: "listing", id: listing.id }, locale) },
  ];
  const favorites = await favoriteContext(publicPath({ route: "listing", id: listing.id }, locale));
  const provider = listing.provider;
  const providerName = provider?.account_type === "business" && provider.business_name ? provider.business_name : provider?.display_name;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
      <Breadcrumbs crumbs={crumbs} />
      <p className="mt-4 text-sm text-stone-700">
        {t(`kinds.${listing.kind}`)} · {t(`directions.${listing.direction}`)}
      </p>
      <h1 className="mt-1 text-3xl font-semibold [overflow-wrap:anywhere] hyphens-auto" lang={listing.contentLanguage}>{listing.title}</h1>
      {favorites.userId !== listing.ownerId && (
        <div className="mt-2">
          <FavoriteButton listingId={listing.id} active={favorites.ids.has(listing.id)} signedIn={favorites.signedIn} back={favorites.back}
            locale={locale} title={listing.title} />
        </div>
      )}
      <p className="mt-1">
        {district ? `${district.name}, ${district.stateName}` : null}
        {listing.postalPrefix && <> · {tp("postalArea", { prefix: listing.postalPrefix })}</>}
      </p>

      {listing.photos.length > 0 && (
        <section aria-label={tp("gallery")} className="mt-6">
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {listing.photos.map((photo, i) => {
              const size = thumbSize(photo.width, photo.height);
              const alt = photo.altText || tp("photoAlt", { title: listing.title, n: i + 1, m: listing.photos.length });
              return (
                <li key={photo.id}>
                  <a href={photoUrl(photo.id, "full")} className="block rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-900">
                    {/* eslint-disable-next-line @next/next/no-img-element -- eigene Foto-Route (prüft Sichtbarkeit je Abruf) */}
                    <img src={photoUrl(photo.id, "thumb")} alt={alt} width={size.width} height={size.height} loading={i < 4 ? "eager" : "lazy"}
                      className="aspect-[4/3] w-full rounded object-cover" />
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <p className="mt-6 whitespace-pre-line [overflow-wrap:anywhere]" lang={listing.contentLanguage}>{listing.description}</p>

      <dl className="mt-6 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
        <dt className="font-medium">{t("fields.price")}</dt>
        <dd>{price}</dd>
        {(listing.startDate || listing.endDate) && (
          <>
            <dt className="font-medium">{tp("period")}</dt>
            <dd>{listing.startDate ? date(listing.startDate) : "…"} – {listing.endDate ? date(listing.endDate) : "…"}</dd>
          </>
        )}
        {listing.areaHectares !== null && (
          <>
            <dt className="font-medium">{t("fields.area")}</dt>
            <dd>{format.number(listing.areaHectares)}</dd>
          </>
        )}
        {listing.species.length > 0 && (
          <>
            <dt className="font-medium">{t("fields.species")}</dt>
            <dd>{listing.species.map((code) => species[code] ?? code).join(", ")}</dd>
          </>
        )}
        {Object.entries(listing.attributes).map(([key, value]) => (
          <AttributeRow key={key} attribute={key} value={value} />
        ))}
        <dt className="font-medium">{tp("published")}</dt>
        <dd>{format.dateTime(new Date(listing.publishedAt), { dateStyle: "medium", timeZone: "Europe/Berlin" })}</dd>
      </dl>

      <section aria-labelledby="location-heading" className="mt-8">
        <h2 id="location-heading" className="text-lg font-semibold">{tm("locationHeading")}</h2>
        <p className="mt-1">
          {listing.approx === "point" ? tm("detailPoint") : tm("detailDistrict", { district: district?.name ?? "" })}
        </p>
        {listing.point && (
          <>
            <noscript>
              <p className="mt-2 text-sm">{tm("noscriptDetail")}</p>
            </noscript>
            <DetailMap
              tilesUrl={tilesUrl()}
              locale={locale}
              point={listing.point}
              approx={listing.approx}
              texts={{
                show: tm("showMap"),
                label: tm("detailLabel"),
                attribution: tm.raw("attribution") as string,
                failed: tm("failed"),
                marker: listing.approx === "point" ? tm("approxPoint") : tm("approxDistrict"),
              }}
            />
          </>
        )}
      </section>

      <section aria-labelledby="provider-heading" className="mt-8 rounded border border-stone-300 p-4">
        <h2 id="provider-heading" className="text-lg font-semibold">{tp("provider")}</h2>
        {provider ? (
          <p className="mt-1">
            <a href={publicPath({ route: "provider", id: provider.id }, locale)} className="underline">{providerName}</a>
            {" · "}
            {tProfile(`accountTypes.${provider.account_type}`)}
            {provider.verified && <> · <strong>{tp("verified")}</strong></>}
          </p>
        ) : null}
        <Contact listing={listing} locale={locale} />
      </section>
    </main>
  );
}

/** Kontakt (M7 Chat): ohne Login zum Login mit Rücksprung, mit Login ein Hinweis, beim Besitzer nichts. */
async function Contact({ listing, locale }: { listing: PublicListing; locale: AppLocale }) {
  const [tp, user] = await Promise.all([getTranslations("Public.detail"), getSessionUser()]);
  if (user?.id === listing.ownerId) return <p className="mt-3 text-sm">{tp("ownListing")}</p>;
  if (!user) {
    const next = encodeURIComponent(publicPath({ route: "listing", id: listing.id }, locale));
    return (
      <p className="mt-3">
        <a href={`/${locale}/login?next=${next}`} className="inline-block rounded bg-stone-900 px-4 py-2 text-white">{tp("contactLogin")}</a>
      </p>
    );
  }
  return <p className="mt-3 text-sm">{tp("contactSoon")}</p>;
}

/** Kreis und Bundesland mit Namen und Slugs für Brotkrumen und Ortsangabe. */
function districtRef(code: string, names: Record<string, string>) {
  const ref = regionByCode(code);
  const state = ref ? regionFromSlugs(ref.stateSlug) : null;
  if (!ref || !state) return null;
  return { name: names[ref.code] ?? ref.code, slug: ref.slug, stateSlug: ref.stateSlug, stateName: names[state.code] ?? state.code };
}
