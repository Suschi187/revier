import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { fieldIdOf, fieldMessageKey, stepOfField } from "@/lib/listing-wizard";
import type { ContentHint, OwnListing } from "@/lib/services/listings";
import type { Region, Species } from "@/lib/services/regions";
import { Link } from "@/i18n/navigation";
import { ListingSummary } from "../ListingSummary";
import { buttonClass } from "../WizardChrome";

/**
 * Vorschau mit allen Angaben. PLZ und Ort sind als „nur für dich und die Moderation“ gekennzeichnet
 * (Review PLZ 7). Zeigt fehlende Angaben und den Waffenhinweis (Entscheidung 6, Absenden bleibt möglich).
 */
export async function PreviewStep({
  locale,
  action,
  listing,
  district,
  species,
  missing,
  hints,
}: {
  locale: AppLocale;
  action: (form: FormData) => Promise<void>;
  listing: OwnListing;
  district: Region | null;
  species: Species[];
  missing: string[];
  hints: ContentHint[];
}) {
  const t = await getTranslations("Listings");
  const submittable = listing.status === "draft" || listing.status === "rejected" || listing.status === "expired";
  return (
    <div className="mt-6 flex flex-col gap-6">
      <ListingSummary locale={locale} listing={listing} district={district} species={species} hints={hints} viewer="owner" />

      {submittable ? (
        <>
          {missing.length > 0 ? (
            <section aria-labelledby="missing-title" className="rounded border border-stone-400 p-4">
              <h2 id="missing-title" className="font-semibold">
                {t("preview.missing")}
              </h2>
              <ul className="mt-2 list-disc pl-5">
                {missing.map((code) => (
                  <li key={code}>
                    <Link href={`/account/listings/${listing.id}/edit?step=${stepOfField(code)}#${fieldIdOf(code)}`} className="underline">
                      {t(`fieldErrors.${fieldMessageKey(code)}`)}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <p role="status">{t("preview.ready")}</p>
          )}
          <form action={action}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="id" value={listing.id} />
            <input type="hidden" name="step" value="preview" />
            <button type="submit" className={buttonClass}>
              {t("preview.submit")}
            </button>
          </form>
        </>
      ) : (
        <p>{t("preview.notSubmittable")}</p>
      )}
    </div>
  );
}
