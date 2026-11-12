import { getFormatter, getTranslations } from "next-intl/server";
import { KindIcon } from "@/components/brand/KindIcon";
import { Icon } from "@/components/ui/Icon";
import { ui } from "@/components/ui/styles";
import type { AppLocale } from "@/i18n/routing";
import { photoUrl, priceText, thumbSize } from "@/lib/public/format";
import { publicPath } from "@/lib/public/paths";
import type { FavoriteContext } from "@/lib/services/favorites";
import type { ListingCard as Card } from "@/lib/services/public-listings";
import { FavoriteButton } from "./FavoriteButton";

export type CardLayout = "row" | "grid";

/**
 * Ein Treffer in Listen (Start, Kategorie, Suche, Anbieter, Favoriten). Kein Kontakt, keine PLZ.
 * `grid`: Foto oben (Startseite), `row`: Foto links und Preis rechts (Suche, Desktop; mobil gestapelt).
 */
export async function ListingCard({
  card,
  locale,
  regions,
  favorites,
  layout = "row",
}: {
  card: Card;
  locale: AppLocale;
  regions: Record<string, string>;
  favorites?: FavoriteContext;
  layout?: CardLayout;
}) {
  const [t, tp, format] = await Promise.all([getTranslations("Listings"), getTranslations("Public.card"), getFormatter()]);
  const href = publicPath({ route: "listing", id: card.id }, locale);
  const price = priceText(
    { priceMinor: card.price_minor, currency: card.currency, priceUnit: card.price_unit },
    locale,
    (key) => t(key as never),
  );
  const size = card.photo ? thumbSize(card.photo.width, card.photo.height) : null;
  const provider = card.provider;
  const providerName = provider?.account_type === "business" && provider.business_name ? provider.business_name : provider?.display_name;
  const place = `${regions[card.district_code] ?? card.district_code}, ${regions[card.state_code] ?? card.state_code}`;
  const date = format.dateTime(new Date(card.published_at), { dateStyle: "medium", timeZone: "Europe/Berlin" });
  const favorite = favorites && card.provider?.id !== favorites.userId && (
    <FavoriteButton listingId={card.id} active={favorites.ids.has(card.id)} signedIn={favorites.signedIn} back={favorites.back}
      locale={locale} title={card.title} variant="icon" />
  );
  const media = card.photo && size ? (
    // eslint-disable-next-line @next/next/no-img-element -- eigene Foto-Route (prüft Sichtbarkeit je Abruf), kein Optimizer
    <img
      src={photoUrl(card.photo.id, "thumb")}
      alt={card.photo.alt_text || tp("photoAlt", { title: card.title })}
      width={size.width}
      height={size.height}
      loading="lazy"
      className="size-full object-cover"
    />
  ) : (
    <div className="flex size-full items-center justify-center bg-sand text-olive" aria-hidden="true">
      <KindIcon kind={card.kind} size={56} accent={false} />
    </div>
  );
  const directionBadge = card.direction === "wanted" && (
    <span className="absolute left-2 top-2 rounded-btn bg-forest px-2 py-1 text-xs font-semibold text-offwhite">{t("directions.wanted")}</span>
  );
  const title = (
    <a href={href} className="text-forest no-underline after:absolute after:inset-0 hover:text-brand-ink focus-visible:outline-none">
      {card.title}
    </a>
  );

  if (layout === "grid") {
    return (
      // Ganze Karte klickbar über den Titel-Link (::after); Merken liegt darüber (z-10).
      <article className={`${ui.card} relative flex h-full min-w-0 flex-col overflow-hidden has-[a:focus-visible]:outline has-[a:focus-visible]:outline-3 has-[a:focus-visible]:outline-brand-ink`}>
        <div className="relative aspect-[4/3] bg-olive">
          {media}
          {directionBadge}
          {favorite && <div className="absolute right-1.5 top-1.5 z-10">{favorite}</div>}
        </div>
        <div className="flex flex-1 flex-col gap-1 p-3.5">
          <p className="text-[0.8125rem] text-muted">{place} · {date}</p>
          <h3 className="text-[0.9375rem] font-semibold leading-snug [overflow-wrap:anywhere] hyphens-auto" lang={card.content_language}>{title}</h3>
          {price && <p className="mt-auto pt-1 font-display text-[1.0625rem] font-extrabold">{price}</p>}
        </div>
      </article>
    );
  }

  return (
    <article className={`${ui.card} relative grid min-w-0 grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-2 p-3 sm:grid-cols-[12rem_minmax(0,1fr)_auto] sm:gap-x-4 has-[a:focus-visible]:outline has-[a:focus-visible]:outline-3 has-[a:focus-visible]:outline-brand-ink`}>
      <div className="relative aspect-[4/3] self-start overflow-hidden rounded-btn bg-olive">
        {media}
        {directionBadge}
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <p className="flex flex-wrap justify-between gap-x-3 text-[0.8125rem] text-muted">
          <span>{place}{card.postal_prefix && <> · {tp("postalArea", { prefix: card.postal_prefix })}</>}</span>
          <span>{date}</span>
        </p>
        <h3 className="text-base font-semibold leading-snug sm:text-lg [overflow-wrap:anywhere] hyphens-auto" lang={card.content_language}>{title}</h3>
        <p className="hidden text-sm text-muted [overflow-wrap:anywhere] sm:block">{providerName}</p>
        <div className="mt-auto hidden flex-wrap gap-1.5 pt-1 sm:flex">
          <span className={ui.chip}>{t(`kinds.${card.kind}`)}</span>
          {card.area_hectares !== null && <span className={ui.chip}>{tp("area", { area: format.number(card.area_hectares) })}</span>}
          {provider?.verified && (
            <span className={ui.chip}><Icon name="shield" size={14} />{tp("verified")}</span>
          )}
        </div>
      </div>
      <div className="col-start-2 flex items-center justify-between gap-2 sm:col-start-3 sm:flex-col sm:items-end">
        {price && <p className="font-display text-lg font-extrabold sm:text-right sm:text-xl">{price}</p>}
        {favorite && <div className="relative z-10 sm:mt-auto">{favorite}</div>}
      </div>
    </article>
  );
}

/** Trefferliste mit Leerzustand. */
export async function ListingList({
  items,
  locale,
  regions,
  empty,
  favorites,
  layout = "row",
}: {
  items: Card[];
  locale: AppLocale;
  regions: Record<string, string>;
  empty: string;
  favorites?: FavoriteContext;
  layout?: CardLayout;
}) {
  if (items.length === 0) return <p className="mt-4">{empty}</p>;
  return (
    <ul className={layout === "grid" ? "mt-4 grid grid-cols-[repeat(auto-fill,minmax(13.5rem,1fr))] gap-4" : "mt-4 grid grid-cols-[minmax(0,1fr)] gap-3"}>
      {items.map((card) => (
        <li key={card.id} className="min-w-0">
          <ListingCard card={card} locale={locale} regions={regions} favorites={favorites} layout={layout} />
        </li>
      ))}
    </ul>
  );
}
