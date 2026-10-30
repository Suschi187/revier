import type { Metadata } from "next";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { ListingSummary } from "@/components/listings/ListingSummary";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { fieldMessageKey, parseErrorCodes } from "@/lib/listing-wizard";
import { DECISIONS, NOTE_MAX, REJECT_CODES } from "@/lib/moderation";
import { requireAdmin } from "@/lib/services/admin";
import { getListingForReview } from "@/lib/services/moderation";
import { listRegions, listSpecies } from "@/lib/services/regions";
import { decideListing } from "./actions";

// `instant = false` nimmt die Seite aus der Instant-Navigation-Prüfung, damit sie die Session ohne
// Suspense-Grenze liest. Den Status (403, Login) setzt der Proxy; die Prüfung hier autorisiert nur und kann
// den schon gesendeten Status nicht mehr ändern (ADR 014, QA M4 F1).
// Die Version wird vor dem Inhalt gelesen (Review B1).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Admin.review");
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ERRORS = ["changed", "code", "note", "notReady", "forbidden", "failed"] as const;

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function ReviewListingPage({ params, searchParams }: Props) {
  const locale = (await getLocale()) as AppLocale;
  const [{ id }, query] = await Promise.all([params, searchParams]);
  await requireAdmin(locale, `/${locale}/admin/listings/${UUID.test(id) ? id : ""}`);
  if (!UUID.test(id)) notFound();
  const review = await getListingForReview(id);
  if (!review) notFound();

  const [t, tl, tm, tLocale, format] = await Promise.all([
    getTranslations("Admin.review"),
    getTranslations("Listings"),
    getTranslations("Moderation"),
    getTranslations("LocaleSwitcher"),
    getFormatter(),
  ]);
  if (!review.version) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
        <Link href="/admin/listings" className="underline">
          {t("back")}
        </Link>
        <h1 className="mt-4 text-3xl font-semibold break-words">{review.listing.title}</h1>
        <p className="mt-4">{t("notPending", { status: tl(`status.${review.listing.status}`) })}</p>
      </main>
    );
  }
  const { listing } = review;

  const [regions, species] = await Promise.all([listRegions(listing.country, locale), listSpecies(locale)]);
  const error = ERRORS.find((e) => e === query.error);
  const missing = error === "notReady" ? parseErrorCodes(query.fields) : [];
  const radio = "flex items-center gap-2";

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
      <Link href="/admin/listings" className="underline">
        {t("back")}
      </Link>
      <div className="mt-4 flex flex-col gap-6">
        <ListingSummary
          locale={locale}
          listing={listing}
          district={regions.districts.find((d) => d.id === listing.regionId) ?? null}
          species={species}
          hints={review.hints}
          viewer="moderator"
          photos={review.photos}
        />
        <section className="text-sm">
          <p>{t("contentLanguage", { language: tLocale(`names.${listing.contentLanguage}`) })}</p>
          {review.owner.name && (
            <p>
              {t("owner", {
                name: review.owner.name,
                date: review.owner.memberSince ? format.dateTime(new Date(review.owner.memberSince), { dateStyle: "medium" }) : "–",
              })}
            </p>
          )}
          <p>{t("previousRejections", { count: review.previousRejections })}</p>
        </section>

        <form action={decideListing} id="decision" className="flex flex-col gap-4 rounded border border-stone-400 p-4">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="id" value={listing.id} />
          <input type="hidden" name="version" value={review.version} />
          {error && (
            <div id="r-error" role="alert" className="rounded bg-red-50 p-3 text-red-800">
              <p>{t(`errors.${error}`)}</p>
              {missing.length > 0 && (
                <ul className="mt-1 list-disc pl-5">
                  {missing.map((code) => (
                    <li key={code}>{tl(`fieldErrors.${fieldMessageKey(code)}`)}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <fieldset className="flex flex-col gap-2" aria-describedby={error ? "r-error" : undefined}>
            <legend className="font-medium">{t("decision")}</legend>
            {DECISIONS.map((decision) => (
              <label key={decision} className={radio}>
                <input type="radio" name="decision" value={decision} required />
                {tm(`decisions.${decision}`)}
              </label>
            ))}
          </fieldset>
          <div>
            <label htmlFor="r-code" className="font-medium">
              {t("reason")}
            </label>
            <select
              id="r-code"
              name="code"
              defaultValue=""
              aria-describedby={error === "code" ? "r-code-hint r-error" : "r-code-hint"}
              aria-invalid={error === "code" || undefined}
              className="mt-1 w-full rounded border border-stone-400 px-3 py-2"
            >
              <option value="">{t("reasonNone")}</option>
              {REJECT_CODES.map((code) => (
                <option key={code} value={code}>
                  {tm(`reasons.${code}`)}
                </option>
              ))}
            </select>
            <p id="r-code-hint" className="text-xs text-stone-700">
              {t("reasonHint")}
            </p>
          </div>
          <div>
            <label htmlFor="r-note" className="font-medium">
              {t("note")}
            </label>
            <textarea
              id="r-note"
              name="note"
              rows={4}
              maxLength={NOTE_MAX}
              aria-describedby={error === "note" ? "r-note-hint r-error" : "r-note-hint"}
              aria-invalid={error === "note" || undefined}
              className="mt-1 w-full rounded border border-stone-400 px-3 py-2"
            />
            <p id="r-note-hint" className="text-xs text-stone-700">
              {t("noteHint")}
            </p>
          </div>
          <button type="submit" className="self-start rounded bg-emerald-800 px-4 py-2 font-medium text-white">
            {t("submit")}
          </button>
        </form>
      </div>
    </main>
  );
}
