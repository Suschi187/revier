import { getFormatter, getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import type { ContentHint, OwnListing } from "@/lib/services/listings";
import type { Region, Species } from "@/lib/services/regions";
import { formatPrice } from "@/lib/validation/price";

export type SummaryPhoto = { id: string; url: string; alt: string };

/**
 * Alle Angaben einer Anzeige wie in der Vorschau des Assistenten, dazu die Waffenbegriff-Hinweise. Der
 * Besitzer sieht PLZ und Ort als „nur für dich und die Moderation“, die Moderation als „nicht öffentlich“
 * (ADR 012). Die Moderation sieht zusätzlich die Fotos (ADR 014).
 */
export async function ListingSummary({
  locale,
  listing,
  district,
  species,
  hints,
  viewer,
  photos = [],
}: {
  locale: AppLocale;
  listing: OwnListing;
  district: Region | null;
  species: Species[];
  hints: ContentHint[];
  viewer: "owner" | "moderator";
  photos?: SummaryPhoto[];
}) {
  const [t, format] = await Promise.all([getTranslations("Listings"), getFormatter()]);
  const speciesNames = species.filter((s) => listing.species.includes(s.code)).map((s) => s.name);
  const price =
    listing.priceUnit === "on_request"
      ? t("preview.onRequest")
      : listing.priceMinor !== null && listing.currency && listing.priceUnit
        ? `${formatPrice(listing.priceMinor, listing.currency, locale)} ${t(`priceUnits.${listing.priceUnit}`)}`
        : t("preview.noPrice");
  const hintField = (field: string) =>
    field === "title" ? t("fields.title") : field === "description" ? t("fields.description") : field === "photos.alt_text" ? t("preview.altText") : t(`attributes.${field.replace("attributes.", "")}`);
  const date = (value: string) => format.dateTime(new Date(`${value}T00:00:00Z`), { dateStyle: "medium", timeZone: "UTC" });

  return (
    <>
      <article className="rounded border border-stone-300 p-4">
        <p className="text-sm text-stone-700">
          {t(`kinds.${listing.kind}`)} · {t(`directions.${listing.direction}`)} · {t(`status.${listing.status}`)}
        </p>
        <h2 className="mt-1 text-2xl font-semibold break-words">{listing.title}</h2>
        <p className="mt-1">{district?.name ?? "–"}</p>
        {listing.place && (listing.place.postalCode || listing.place.placeName) && (
          <p className="mt-1 text-sm">
            {[listing.place.postalCode, listing.place.placeName].filter(Boolean).join(" ")}{" "}
            <span className="rounded bg-stone-200 px-1.5 py-0.5 text-xs">{t(viewer === "owner" ? "preview.privateBadge" : "preview.privateBadgeModerator")}</span>
          </p>
        )}
        {photos.length > 0 && (
          <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {photos.map((photo) => (
              <li key={photo.id}>
                <a href={photo.url} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element -- signierte URL aus privatem Bucket, kein Optimizer */}
                  <img src={photo.url} alt={photo.alt} className="aspect-[4/3] w-full rounded object-cover" />
                </a>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 whitespace-pre-line break-words">{listing.description}</p>
        <dl className="mt-4 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="font-medium">{t("fields.price")}</dt>
          <dd>{price}</dd>
          {(listing.startDate || listing.endDate) && (
            <>
              <dt className="font-medium">{t("fields.period")}</dt>
              <dd>
                {listing.startDate ? date(listing.startDate) : "…"} – {listing.endDate ? date(listing.endDate) : "…"}
              </dd>
            </>
          )}
          {listing.areaHectares !== null && (
            <>
              <dt className="font-medium">{t("fields.area")}</dt>
              <dd>{format.number(listing.areaHectares)}</dd>
            </>
          )}
          {speciesNames.length > 0 && (
            <>
              <dt className="font-medium">{t("fields.species")}</dt>
              <dd>{speciesNames.join(", ")}</dd>
            </>
          )}
          {Object.entries(listing.attributes).map(([key, value]) => (
            <AttributeRow key={key} attribute={key} value={value} />
          ))}
        </dl>
      </article>

      {hints.length > 0 && (
        <section aria-labelledby="weapons-title" className="rounded border-2 border-amber-600 bg-amber-50 p-4">
          <h2 id="weapons-title" className="font-semibold text-amber-950">
            {t("preview.weaponsTitle")}
          </h2>
          <p className="mt-1">{t("preview.weaponsText")}</p>
          <ul className="mt-2 list-disc pl-5">
            {hints.map((hint) => (
              <li key={`${hint.field}-${hint.term}`}>{t("preview.weaponsMatch", { field: hintField(hint.field), term: hint.term })}</li>
            ))}
          </ul>
          {viewer === "owner" && <p className="mt-2 text-sm">{t("preview.weaponsSubmit")}</p>}
        </section>
      )}

    </>
  );
}

async function AttributeRow({ attribute, value }: { attribute: string; value: unknown }) {
  const t = await getTranslations("Listings");
  if (attribute === "legal_ack") return null;
  const shown = Array.isArray(value)
    ? value.map((v) => (t.has(`options.${attribute}.${String(v)}`) ? t(`options.${attribute}.${String(v)}`) : String(v))).join(", ")
    : typeof value === "boolean"
      ? t(value ? "fields.yes" : "fields.no")
      : t.has(`options.${attribute}.${String(value)}`)
        ? t(`options.${attribute}.${String(value)}`)
        : String(value);
  return (
    <>
      <dt className="font-medium">{t(`attributes.${attribute}`)}</dt>
      <dd className="break-words whitespace-pre-line">{shown}</dd>
    </>
  );
}
