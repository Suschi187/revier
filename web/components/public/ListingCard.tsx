import { getFormatter, getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { photoUrl, priceText, thumbSize } from "@/lib/public/format";
import { publicPath } from "@/lib/public/paths";
import type { FavoriteContext } from "@/lib/services/favorites";
import type { ListingCard as Card } from "@/lib/services/public-listings";
import { FavoriteButton } from "./FavoriteButton";

/** Ein Treffer in Listen (Start, Kategorie, Suche, Anbieter, Favoriten). Kein Kontakt, keine PLZ. */
export async function ListingCard({
  card,
  locale,
  regions,
  favorites,
}: {
  card: Card;
  locale: AppLocale;
  regions: Record<string, string>;
  favorites?: FavoriteContext;
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

  return (
    <article className="flex min-w-0 gap-4 rounded border border-stone-300 p-3">
      {card.photo && size ? (
        // eslint-disable-next-line @next/next/no-img-element -- eigene Foto-Route (prüft Sichtbarkeit je Abruf), kein Optimizer
        <img
          src={photoUrl(card.photo.id, "thumb")}
          alt={card.photo.alt_text || tp("photoAlt", { title: card.title })}
          width={size.width}
          height={size.height}
          loading="lazy"
          className="h-24 w-32 shrink-0 rounded object-cover"
        />
      ) : (
        <div className="h-24 w-32 shrink-0 rounded bg-stone-100" aria-hidden="true" />
      )}
      <div className="min-w-0">
        <p className="text-sm text-stone-700">
          {t(`kinds.${card.kind}`)} · {t(`directions.${card.direction}`)}
        </p>
        <h3 className="font-semibold [overflow-wrap:anywhere] hyphens-auto" lang={card.content_language}>
          <a href={href} className="underline-offset-2 hover:underline focus-visible:underline">
            {card.title}
          </a>
        </h3>
        <p className="text-sm">
          {regions[card.district_code] ?? card.district_code}, {regions[card.state_code] ?? card.state_code}
          {card.postal_prefix && <> · {tp("postalArea", { prefix: card.postal_prefix })}</>}
        </p>
        {price && <p className="text-sm font-medium">{price}</p>}
        <p className="mt-1 text-xs text-stone-700 [overflow-wrap:anywhere]">
          {providerName}
          {provider?.verified && <> · {tp("verified")}</>} ·{" "}
          {tp("published", { date: format.dateTime(new Date(card.published_at), { dateStyle: "medium", timeZone: "Europe/Berlin" }) })}
        </p>
        {favorites && card.provider?.id !== favorites.userId && (
          <div className="mt-2">
            <FavoriteButton listingId={card.id} active={favorites.ids.has(card.id)} signedIn={favorites.signedIn} back={favorites.back}
              locale={locale} title={card.title} />
          </div>
        )}
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
}: {
  items: Card[];
  locale: AppLocale;
  regions: Record<string, string>;
  empty: string;
  favorites?: FavoriteContext;
}) {
  if (items.length === 0) return <p className="mt-4">{empty}</p>;
  return (
    <ul className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-3">
      {items.map((card) => (
        <li key={card.id} className="min-w-0">
          <ListingCard card={card} locale={locale} regions={regions} favorites={favorites} />
        </li>
      ))}
    </ul>
  );
}
