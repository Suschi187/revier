import { getTranslations } from "next-intl/server";
import { routing, type AppLocale } from "@/i18n/routing";
import type { Region } from "@/lib/services/regions";
import { LISTING_DIRECTIONS, LISTING_KINDS, TITLE_MAX, TITLE_MIN, type ListingDirection, type ListingKind } from "@/lib/validation/listing";
import { buttonClass, describedBy, FieldError, inputClass, labelClass } from "../WizardChrome";

export type BasicsValues = { kind: ListingKind | null; direction: ListingDirection | null; title: string; contentLanguage: AppLocale };

/** Art, Richtung, Titel und Sprache. Beim Anlegen zusätzlich Land und Kreis (Pflichtspalten des Entwurfs). */
export async function BasicsStep({
  locale,
  action,
  listingId,
  values,
  errors,
  district,
}: {
  locale: AppLocale;
  action: (form: FormData) => Promise<void>;
  listingId: string | null;
  values: BasicsValues;
  errors: string[];
  district?: React.ReactNode;
}) {
  const t = await getTranslations("Listings");
  const tLocale = await getTranslations("LocaleSwitcher");
  return (
    <form action={action} className="mt-6 flex flex-col gap-6">
      <input type="hidden" name="locale" value={locale} />
      {listingId && <input type="hidden" name="id" value={listingId} />}
      <input type="hidden" name="step" value="basics" />

      <fieldset className="flex flex-col gap-2" id="f-kind">
        <legend className={labelClass}>{t("fields.kind")}</legend>
        {LISTING_KINDS.map((kind) => (
          <label key={kind} className="flex items-center gap-2">
            <input type="radio" name="kind" value={kind} defaultChecked={values.kind === kind} required />
            {t(`kinds.${kind}`)}
          </label>
        ))}
      </fieldset>

      <fieldset className="flex flex-col gap-2" id="f-direction">
        <legend className={labelClass}>{t("fields.direction")}</legend>
        {LISTING_DIRECTIONS.map((direction) => (
          <label key={direction} className="flex items-center gap-2">
            <input type="radio" name="direction" value={direction} defaultChecked={values.direction === direction} required />
            {t(`directions.${direction}`)}
          </label>
        ))}
      </fieldset>

      <div>
        <label htmlFor="f-title" className={labelClass}>
          {t("fields.title")}
        </label>
        <p id="f-title-hint" className="text-sm text-stone-700">
          {t("fields.titleHint")}
        </p>
        <input
          id="f-title"
          name="title"
          defaultValue={values.title}
          required
          minLength={TITLE_MIN}
          maxLength={TITLE_MAX}
          className={inputClass}
          {...describedBy(errors, "f-title", "f-title-hint")}
        />
        <FieldError codes={errors} fieldId="f-title" />
      </div>

      <div>
        <label htmlFor="f-language" className={labelClass}>
          {t("fields.language")}
        </label>
        <select id="f-language" name="contentLanguage" defaultValue={values.contentLanguage} className={inputClass}>
          {routing.locales.map((code) => (
            <option key={code} value={code}>
              {tLocale(`names.${code}`)}
            </option>
          ))}
        </select>
      </div>

      {district}

      <button type="submit" className={buttonClass}>
        {listingId ? t("wizard.save") : t("wizard.create")}
      </button>
    </form>
  );
}

/** Kreise eines Landes, gruppiert nach Bundesland bzw. Region. */
export async function DistrictSelect({ states, districts, selected, errors }: { states: Region[]; districts: Region[]; selected: string | null; errors: string[] }) {
  const t = await getTranslations("Listings.fields");
  return (
    <div>
      <label htmlFor="f-district" className={labelClass}>
        {t("district")}
      </label>
      <select
        id="f-district"
        name="regionId"
        defaultValue={selected ?? ""}
        required
        className={inputClass}
        {...describedBy(errors, "f-district")}
      >
        <option value="" disabled>
          {t("choose")}
        </option>
        {states.map((state) => (
          <optgroup key={state.id} label={state.name}>
            {districts
              .filter((d) => d.parentId === state.id)
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
      <FieldError codes={errors} fieldId="f-district" />
    </div>
  );
}

/** Land wechseln per GET (ohne JavaScript bedienbar); lädt die Kreise des Landes. */
export async function CountrySwitch({ country, countries, hidden }: { country: string; countries: readonly string[]; hidden: Record<string, string> }) {
  const [t, tProfile] = await Promise.all([getTranslations("Listings"), getTranslations("Profile")]);
  return (
    <form method="get" className="mt-6 flex flex-wrap items-end gap-2">
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <div>
        <label htmlFor="f-country" className={labelClass}>
          {t("fields.country")}
        </label>
        <select id="f-country" name="country" defaultValue={country} className={inputClass}>
          {countries.map((code) => (
            <option key={code} value={code}>
              {tProfile(`countries.${code}`)}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" className="rounded border border-stone-400 px-3 py-2">
        {t("wizard.countryApply")}
      </button>
    </form>
  );
}
