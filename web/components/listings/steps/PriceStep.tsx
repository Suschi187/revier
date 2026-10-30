import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { PRICE_UNITS } from "@/lib/listing-wizard";
import { Constants, type Database } from "@/lib/supabase/database.types";
import { minorToInput } from "@/lib/validation/price";
import { buttonClass, describedBy, FieldError, inputClass, labelClass } from "../WizardChrome";

type Enums = Database["public"]["Enums"];

/** Preis (keiner, auf Anfrage oder Betrag mit Währung und Einheit) und optionaler Zeitraum. */
export async function PriceStep({
  locale,
  action,
  listingId,
  priceMinor,
  currency,
  priceUnit,
  defaultCurrency,
  startDate,
  endDate,
  errors,
}: {
  locale: AppLocale;
  action: (form: FormData) => Promise<void>;
  listingId: string;
  priceMinor: number | null;
  currency: Enums["currency_code"] | null;
  priceUnit: Enums["price_unit"] | null;
  defaultCurrency: Enums["currency_code"];
  startDate: string | null;
  endDate: string | null;
  errors: string[];
}) {
  const t = await getTranslations("Listings");
  // Ohne gespeicherten Preis ist keine Option gewählt; ein eingetragener Betrag gilt dann als Betrag (QA M3 F3).
  const mode = priceUnit === "on_request" ? "on_request" : priceMinor !== null ? "amount" : null;
  const decimal = locale === "en" ? "." : ",";
  return (
    <form action={action} className="mt-6 flex flex-col gap-6">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="id" value={listingId} />
      <input type="hidden" name="step" value="price" />

      <fieldset className="flex flex-col gap-2">
        <legend className={labelClass}>{t("fields.price")}</legend>
        {(["none", "on_request", "amount"] as const).map((value) => (
          <label key={value} className="flex items-center gap-2">
            <input type="radio" name="priceMode" value={value} defaultChecked={mode === value} />
            {t(value === "none" ? "fields.priceNone" : value === "on_request" ? "fields.priceOnRequest" : "fields.priceAmount")}
          </label>
        ))}
      </fieldset>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="f-amount" className={labelClass}>
            {t("fields.amount")}
          </label>
          <input
            id="f-amount"
            name="amount"
            inputMode="decimal"
            defaultValue={priceMinor === null ? "" : minorToInput(priceMinor, decimal)}
            className={inputClass}
            {...describedBy(errors, "f-amount", "f-amount-hint")}
          />
          <p id="f-amount-hint" className="text-xs text-stone-700">
            {t("fields.amountHint")}
          </p>
          <FieldError codes={errors} fieldId="f-amount" />
        </div>
        <div>
          <label htmlFor="f-currency" className={labelClass}>
            {t("fields.currency")}
          </label>
          <select id="f-currency" name="currency" defaultValue={currency ?? defaultCurrency} className={inputClass}>
            {Constants.public.Enums.currency_code.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="f-unit" className={labelClass}>
            {t("fields.unit")}
          </label>
          <select id="f-unit" name="priceUnit" defaultValue={priceUnit && priceUnit !== "on_request" ? priceUnit : "total"} className={inputClass}>
            {PRICE_UNITS.map((unit) => (
              <option key={unit} value={unit}>
                {t(`priceUnits.${unit}`)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <legend className={labelClass}>{t("fields.period")}</legend>
        <div>
          <label htmlFor="f-start" className={labelClass}>
            {t("fields.startDate")}
          </label>
          <input id="f-start" type="date" name="startDate" defaultValue={startDate ?? ""} className={inputClass} />
        </div>
        <div>
          <label htmlFor="f-end" className={labelClass}>
            {t("fields.endDate")}
          </label>
          <input id="f-end" type="date" name="endDate" defaultValue={endDate ?? ""} className={inputClass} {...describedBy(errors, "f-end")} />
          <FieldError codes={errors} fieldId="f-end" />
        </div>
      </fieldset>

      <button type="submit" className={buttonClass}>
        {t("wizard.save")}
      </button>
    </form>
  );
}
