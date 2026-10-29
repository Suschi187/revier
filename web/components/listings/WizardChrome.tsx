import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { fieldIdOf, fieldMessageKey, stepOfField, WIZARD_STEPS, type WizardStep } from "@/lib/listing-wizard";

// Rahmen des Assistenten (Plan M3 7, Barrierefreiheit): Fortschritt „Schritt x von n“, Schrittnavigation,
// Fehlerzusammenfassung mit Ankern zu den Feldern.

export async function StepNav({ listingId, current }: { listingId: string | null; current: WizardStep }) {
  const t = await getTranslations("Listings.wizard");
  const index = WIZARD_STEPS.indexOf(current);
  return (
    <nav aria-label={t("stepsLabel")} className="mt-4">
      <p className="text-sm font-medium">{t("progress", { current: index + 1, total: WIZARD_STEPS.length })}</p>
      <ol className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {WIZARD_STEPS.map((step, i) => {
          const label = `${i + 1}. ${t(`steps.${step}`)}`;
          if (step === current) {
            return (
              <li key={step} aria-current="step" className="font-semibold">
                {label}
              </li>
            );
          }
          return (
            <li key={step}>
              {listingId ? (
                <Link href={`/account/listings/${listingId}/edit?step=${step}`} className="underline">
                  {label}
                </Link>
              ) : (
                <span className="text-stone-500">{label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export async function ErrorSummary({ codes, listingId, current }: { codes: string[]; listingId: string | null; current: WizardStep }) {
  if (codes.length === 0) return null;
  const t = await getTranslations("Listings");
  return (
    <div role="alert" tabIndex={-1} id="error-summary" className="mt-6 rounded border border-red-700 bg-red-50 p-4">
      <p className="font-semibold text-red-900">{t("wizard.errorSummary")}</p>
      <ul className="mt-2 list-disc pl-5">
        {codes.map((code) => {
          const step = stepOfField(code);
          const href = step === current || !listingId ? `#${fieldIdOf(code)}` : `/account/listings/${listingId}/edit?step=${step}#${fieldIdOf(code)}`;
          return (
            <li key={code}>
              {step === current || !listingId ? (
                <a href={href} className="text-red-900 underline">
                  {t(`fieldErrors.${fieldMessageKey(code)}`)}
                </a>
              ) : (
                <Link href={href} className="text-red-900 underline">
                  {t(`fieldErrors.${fieldMessageKey(code)}`)} – {t("preview.fix", { step: t(`wizard.steps.${step}`) })}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Fehlertext direkt am Feld; `id` passt zu aria-describedby. */
export async function FieldError({ codes, fieldId }: { codes: string[]; fieldId: string }) {
  const code = codes.find((c) => fieldIdOf(c) === fieldId);
  if (!code) return null;
  const t = await getTranslations("Listings.fieldErrors");
  return (
    <p id={`${fieldId}-error`} className="text-sm text-red-800">
      {t(fieldMessageKey(code))}
    </p>
  );
}

export function describedBy(codes: string[], fieldId: string, hintId?: string): { "aria-invalid"?: true; "aria-describedby"?: string } {
  const invalid = codes.some((c) => fieldIdOf(c) === fieldId);
  const ids = [hintId, invalid ? `${fieldId}-error` : undefined].filter(Boolean).join(" ");
  return { ...(invalid ? { "aria-invalid": true as const } : {}), ...(ids ? { "aria-describedby": ids } : {}) };
}

export const inputClass = "mt-1 w-full rounded border border-stone-400 px-3 py-2";
export const labelClass = "font-medium";
export const buttonClass = "self-start rounded bg-emerald-800 px-4 py-2 font-medium text-white";
