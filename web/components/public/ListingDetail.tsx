import { getFormatter, getTranslations } from "next-intl/server";
import { AttributeRow } from "@/components/listings/ListingSummary";
import { KindIcon } from "@/components/brand/KindIcon";
import { DetailMap } from "@/components/map/DetailMap";
import { Icon } from "@/components/ui/Icon";
import { ui } from "@/components/ui/styles";
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

  const first = listing.photos[0];
  const firstSize = first ? thumbSize(first.width, first.height) : null;
  const factRows = "grid grid-cols-[minmax(0,max-content)_minmax(0,1fr)] gap-x-6 [&>dd]:border-b [&>dd]:border-sand [&>dd]:py-2.5 [&>dd]:font-semibold [&>dt]:border-b [&>dt]:border-sand [&>dt]:py-2.5 [&>dt]:font-normal [&>dt]:text-muted";
  const sectionHeading = "font-display text-sm font-extrabold uppercase tracking-caps";
  const showFavorite = favorites.userId !== listing.ownerId;

  return (
    <main className={`${ui.container} flex-1 pb-28 pt-4 sm:pt-6 lg:pb-12`}>
      <Breadcrumbs crumbs={crumbs} />

      <div className="mt-4 flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <section aria-label={tp("gallery")} className={`${ui.card} p-3`}>
            {first && firstSize ? (
              <>
                <a href={photoUrl(first.id, "full")} className="block overflow-hidden rounded-btn">
                  {/* eslint-disable-next-line @next/next/no-img-element -- eigene Foto-Route (prüft Sichtbarkeit je Abruf) */}
                  <img src={photoUrl(first.id, "full")} alt={first.altText || tp("photoAlt", { title: listing.title, n: 1, m: listing.photos.length })}
                    width={first.width ?? firstSize.width} height={first.height ?? firstSize.height}
                    className="aspect-[16/10] w-full bg-olive object-cover" />
                </a>
                {listing.photos.length > 1 && (
                  <ul className="mt-2.5 grid grid-cols-4 gap-2 sm:grid-cols-6">
                    {listing.photos.slice(1).map((photo, i) => {
                      const size = thumbSize(photo.width, photo.height);
                      const alt = photo.altText || tp("photoAlt", { title: listing.title, n: i + 2, m: listing.photos.length });
                      return (
                        <li key={photo.id}>
                          <a href={photoUrl(photo.id, "full")} className="block overflow-hidden rounded-btn">
                            {/* eslint-disable-next-line @next/next/no-img-element -- eigene Foto-Route (prüft Sichtbarkeit je Abruf) */}
                            <img src={photoUrl(photo.id, "thumb")} alt={alt} width={size.width} height={size.height} loading={i < 5 ? "eager" : "lazy"}
                              className="aspect-[4/3] w-full object-cover" />
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            ) : (
              <div className="flex aspect-[16/10] items-center justify-center rounded-btn bg-sand text-olive" aria-hidden="true">
                <KindIcon kind={listing.kind} size={96} accent={false} />
              </div>
            )}
          </section>

          <article className={`${ui.card} flex flex-col gap-3 px-5 py-5 sm:px-6`}>
            <p className="text-[0.8125rem] text-muted">
              {t(`directions.${listing.direction}`)} · {t(`kinds.${listing.kind}`)} · {tp("published")}{" "}
              {format.dateTime(new Date(listing.publishedAt), { dateStyle: "medium", timeZone: "Europe/Berlin" })}
            </p>
            <h1 className="text-2xl font-bold leading-tight [overflow-wrap:anywhere] hyphens-auto sm:text-[1.75rem]" lang={listing.contentLanguage}>{listing.title}</h1>
            <p className="font-display text-[1.75rem] font-extrabold">{price}</p>
            <p className="flex items-center gap-1.5">
              <Icon name="pin" size={18} />
              {district ? `${district.name}, ${district.stateName}` : null}
              {listing.postalPrefix && <> · {tp("postalArea", { prefix: listing.postalPrefix })}</>}
            </p>

            <h2 className={`${sectionHeading} mt-3`}>{tp("facts")}</h2>
            <dl className={factRows}>
              {(listing.startDate || listing.endDate) && (
                <>
                  <dt>{tp("period")}</dt>
                  <dd>{listing.startDate ? date(listing.startDate) : "…"} – {listing.endDate ? date(listing.endDate) : "…"}</dd>
                </>
              )}
              {listing.areaHectares !== null && (
                <>
                  <dt>{t("fields.area")}</dt>
                  <dd>{format.number(listing.areaHectares)}</dd>
                </>
              )}
              {listing.species.length > 0 && (
                <>
                  <dt>{t("fields.species")}</dt>
                  <dd>{listing.species.map((code) => species[code] ?? code).join(", ")}</dd>
                </>
              )}
              {Object.entries(listing.attributes).map(([key, value]) => (
                <AttributeRow key={key} attribute={key} value={value} />
              ))}
              <dt>{t("fields.price")}</dt>
              <dd>{price}</dd>
            </dl>

            <h2 className={`${sectionHeading} mt-3`}>{tp("description")}</h2>
            <p className="whitespace-pre-line leading-relaxed [overflow-wrap:anywhere]" lang={listing.contentLanguage}>{listing.description}</p>
          </article>

          <section aria-labelledby="location-heading" className={`${ui.card} px-5 py-5 sm:px-6`}>
            <h2 id="location-heading" className={sectionHeading}>{tm("locationHeading")}</h2>
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
        </div>

        <aside aria-label={tp("provider")} className="flex flex-col gap-3 lg:sticky lg:top-4 lg:w-[22rem]">
          <section aria-labelledby="provider-heading" className={`${ui.card} flex flex-col gap-3.5 p-5`}>
            <h2 id="provider-heading" className="sr-only">{tp("provider")}</h2>
            {provider ? (
              <div className="flex items-center gap-3">
                <span aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-full bg-olive font-semibold text-offwhite">
                  {(providerName ?? "?").slice(0, 2).toUpperCase()}
                </span>
                <p className="flex min-w-0 flex-col">
                  <a href={publicPath({ route: "provider", id: provider.id }, locale)} className="font-semibold text-forest [overflow-wrap:anywhere]">{providerName}</a>
                  <span className="text-[0.8125rem] text-muted">{tProfile(`accountTypes.${provider.account_type}`)}</span>
                </p>
              </div>
            ) : null}
            {provider?.verified && (
              <p className="flex items-center gap-2 rounded-btn bg-sand px-2.5 py-2 text-sm font-semibold">
                <Icon name="shield" size={18} />
                {tp("verified")}
              </p>
            )}
            {/* Ein einziger Kontakt-Link: mobil fest unten (SPEC M10a 4.4), ab Desktop in der Box. */}
            <div className="fixed inset-x-0 bottom-0 z-20 border-t border-sand bg-offwhite p-3 lg:static lg:border-0 lg:bg-transparent lg:p-0">
              <Contact listing={listing} locale={locale} />
            </div>
            {showFavorite && (
              <FavoriteButton listingId={listing.id} active={favorites.ids.has(listing.id)} signedIn={favorites.signedIn} back={favorites.back}
                locale={locale} title={listing.title} />
            )}
            <p className="text-[0.8125rem] text-muted">{tp("contactPrivate")}</p>
          </section>
          <section aria-labelledby="safety-heading" className="rounded-card bg-sand px-5 py-4">
            <h2 id="safety-heading" className={sectionHeading}>{tp("safety")}</h2>
            <ul className="mt-2 list-disc ps-5 text-sm leading-relaxed">
              <li>{tp("safety1")}</li>
              <li>{tp("safety2")}</li>
              <li>{tp("safety3")}</li>
            </ul>
          </section>
          {/* Statischer Link (ADR 020): die gecachte Seite bleibt unpersonalisiert; Login und Prüfung des Ziels auf der Meldeseite. */}
          <a href={`/${locale}/account/report/listing/${listing.id}`} rel="nofollow" className="flex min-h-11 items-center gap-2 px-1 text-sm text-muted underline underline-offset-2">
            <Icon name="flag" size={16} />
            {tp("report")}
          </a>
        </aside>
      </div>

    </main>
  );
}

/**
 * Kontakt (M7, ADR 017): ein fester Link auf „Nachricht schreiben“. Ohne Login leitet der Proxy zum Login, der
 * Rücksprung behält die Anzeigen-ID im Pfad (Review A2). Beim Besitzer nur ein Hinweis.
 */
async function Contact({ listing, locale }: { listing: PublicListing; locale: AppLocale }) {
  const [tp, user] = await Promise.all([getTranslations("Public.detail"), getSessionUser()]);
  if (user?.id === listing.ownerId) return <p className="text-sm">{tp("ownListing")}</p>;
  return (
    <a href={`/${locale}/account/messages/new/${listing.id}`} className={`${ui.btnPrimaryText} min-h-12 w-full text-[0.9375rem]`}>
      <Icon name="message" size={18} />
      {user ? tp("contact") : tp("contactLogin")}
    </a>
  );
}

/** Kreis und Bundesland mit Namen und Slugs für Brotkrumen und Ortsangabe. */
function districtRef(code: string, names: Record<string, string>) {
  const ref = regionByCode(code);
  const state = ref ? regionFromSlugs(ref.stateSlug) : null;
  if (!ref || !state) return null;
  return { name: names[ref.code] ?? ref.code, slug: ref.slug, stateSlug: ref.stateSlug, stateName: names[state.code] ?? state.code };
}
