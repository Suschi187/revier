import { getTranslations } from "next-intl/server";
import { ui } from "@/components/ui/styles";
import { Link } from "@/i18n/navigation";
import { fieldIdOf, fieldMessageKey, stepOfField, WIZARD_STEPS, type WizardStep } from "@/lib/listing-wizard";

// Rahmen des Assistenten (Plan M3 7, Barrierefreiheit): Fortschritt „Schritt x von n“, Schrittnavigation,
// Fehlerzusammenfassung mit Ankern zu den Feldern.

export async function StepNav({ listingId, current }: { listingId: string | null; current: WizardStep }) {
  const t = await getTranslations("Listings.wizard");
  const index = WIZARD_STEPS.indexOf(current);
  const chip = "inline-flex min-h-9 items-center rounded-pill px-3 text-sm";
  return (
    <nav aria-label={t("stepsLabel")} className="mt-4">
      <p className="text-sm font-semibold">{t("progress", { current: index + 1, total: WIZARD_STEPS.length })}</p>
      <div aria-hidden="true" className="mt-2 h-1.5 overflow-hidden rounded-pill bg-sand">
        <div className="h-full rounded-pill bg-brand" style={{ width: `${((index + 1) / WIZARD_STEPS.length) * 100}%` }} />
      </div>
      <ol className="mt-3 flex flex-wrap gap-2">
        {WIZARD_STEPS.map((step, i) => {
          const label = `${i + 1}. ${t(`steps.${step}`)}`;
          if (step === current) {
            return (
              <li key={step} aria-current="step" className={`${chip} bg-forest font-semibold text-offwhite`}>
                {label}
              </li>
            );
          }
          return (
            <li key={step}>
              {listingId ? (
                <Link href={`/account/listings/${listingId}/edit?step=${step}`} className={`${chip} border border-sand bg-surface text-forest underline underline-offset-2`}>
                  {label}
                </Link>
              ) : (
                <span className={`${chip} border border-sand text-muted`}>{label}</span>
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
    <div role="alert" tabIndex={-1} id="error-summary" className="mt-6 rounded-card border border-error bg-error-soft p-4">
      <p className="font-semibold text-error">{t("wizard.errorSummary")}</p>
      <ul className="mt-2 list-disc pl-5">
        {codes.map((code) => {
          const step = stepOfField(code);
          const href = step === current || !listingId ? `#${fieldIdOf(code)}` : `/account/listings/${listingId}/edit?step=${step}#${fieldIdOf(code)}`;
          return (
            <li key={code}>
              {step === current || !listingId ? (
                <a href={href} className="text-error underline">
                  {t(`fieldErrors.${fieldMessageKey(code)}`)}
                </a>
              ) : (
                <Link href={href} className="text-error underline">
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
    <p id={`${fieldId}-error`} className="text-sm text-error">
      {t(fieldMessageKey(code))}
    </p>
  );
}

/**
 * Hinweis und Fehler am Feld. Für Gruppen (`<fieldset>`) ohne `aria-invalid`, das ARIA 1.2 dort nicht vorsieht;
 * der Fehlertext hängt per `aria-describedby` an (QA M3 F7).
 */
export function describedBy(
  codes: string[],
  fieldId: string,
  hintId?: string,
  group = false,
): { "aria-invalid"?: true; "aria-describedby"?: string } {
  const invalid = codes.some((c) => fieldIdOf(c) === fieldId);
  const ids = [hintId, invalid ? `${fieldId}-error` : undefined].filter(Boolean).join(" ");
  return { ...(invalid && !group ? { "aria-invalid": true as const } : {}), ...(ids ? { "aria-describedby": ids } : {}) };
}

export const inputClass = `mt-1 ${ui.input}`;
export const labelClass = "font-semibold";
export const buttonClass = `${ui.btnPrimary} self-start`;
