import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { ATTRIBUTE_FIELDS, type AttributeField } from "@/lib/listing-wizard";
import type { Species } from "@/lib/services/regions";
import { DESCRIPTION_MAX, type Attributes, type ListingKind } from "@/lib/validation/listing";
import { buttonClass, describedBy, FieldError, inputClass, labelClass } from "../WizardChrome";

/** Beschreibung, Angaben je Art, Fläche (Pacht) und Wildarten. Pflicht prüft erst das Absenden. */
export async function DetailsStep({
  locale,
  action,
  listingId,
  kind,
  description,
  areaHectares,
  attributes,
  species,
  selectedSpecies,
  errors,
}: {
  locale: AppLocale;
  action: (form: FormData) => Promise<void>;
  listingId: string;
  kind: ListingKind;
  description: string;
  areaHectares: number | null;
  attributes: Attributes;
  species: Species[];
  selectedSpecies: string[];
  errors: string[];
}) {
  const t = await getTranslations("Listings");
  return (
    <form action={action} className="mt-6 flex flex-col gap-6">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="id" value={listingId} />
      <input type="hidden" name="step" value="details" />

      <div>
        <label htmlFor="f-description" className={labelClass}>
          {t("fields.description")}
        </label>
        <p id="f-description-hint" className="text-sm text-stone-700">
          {t("fields.descriptionHint")}
        </p>
        <textarea
          id="f-description"
          name="description"
          defaultValue={description}
          rows={8}
          maxLength={DESCRIPTION_MAX}
          className={inputClass}
          {...describedBy(errors, "f-description", "f-description-hint")}
        />
        <FieldError codes={errors} fieldId="f-description" />
      </div>

      <fieldset className="flex flex-col gap-4" id="f-kind-details">
        <legend className="text-lg font-semibold">{t("fields.kindDetails", { kind: t(`kinds.${kind}`) })}</legend>
        <FieldError codes={errors} fieldId="f-kind-details" />
        {kind === "lease" && (
          <div>
            <label htmlFor="f-area" className={labelClass}>
              {t("fields.area")}
            </label>
            <input
              id="f-area"
              name="areaHectares"
              defaultValue={areaHectares === null ? "" : String(areaHectares).replace(".", locale === "en" ? "." : ",")}
              inputMode="decimal"
              className={inputClass}
              {...describedBy(errors, "f-area")}
            />
            <FieldError codes={errors} fieldId="f-area" />
          </div>
        )}
        {ATTRIBUTE_FIELDS[kind].map((field) => (
          <AttributeInput key={field.key} field={field} value={attributes[field.key]} errors={errors} />
        ))}
      </fieldset>

      <fieldset className="flex flex-col gap-2" id="f-species" {...describedBy(errors, "f-species", "f-species-hint")}>
        <legend className={labelClass}>{t("fields.species")}</legend>
        <p id="f-species-hint" className="text-sm text-stone-700">
          {t("fields.speciesHint")}
        </p>
        <FieldError codes={errors} fieldId="f-species" />
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {species.map((s) => (
            <label key={s.code} className="flex items-center gap-2">
              <input type="checkbox" name="species" value={s.code} defaultChecked={selectedSpecies.includes(s.code)} />
              {s.name}
            </label>
          ))}
        </div>
      </fieldset>

      <button type="submit" className={buttonClass}>
        {t("wizard.save")}
      </button>
    </form>
  );
}

async function AttributeInput({ field, value, errors }: { field: AttributeField; value: unknown; errors: string[] }) {
  const t = await getTranslations("Listings");
  const id = `f-attr-${field.key}`;
  const name = `attr.${field.key}`;
  const label = t(`attributes.${field.key}`);
  const hintKey = field.key === "tasks" || field.key === "legal_ack" ? `attributeHints.${field.key}` : null;
  const hintId = hintKey ? `${id}-hint` : undefined;
  const hint = hintKey ? (
    <p id={hintId} className="text-sm text-stone-700">
      {t(hintKey)}
    </p>
  ) : null;
  const aria = describedBy(errors, id, hintId);
  const error = <FieldError codes={errors} fieldId={id} />;

  switch (field.type) {
    case "choice":
      return (
        <div>
          <label htmlFor={id} className={labelClass}>
            {label}
          </label>
          <select id={id} name={name} defaultValue={typeof value === "string" ? value : ""} className={inputClass} {...aria}>
            <option value="">{t("fields.notSpecified")}</option>
            {field.options.map((option) => (
              <option key={option} value={option}>
                {t(`options.${field.key}.${option}`)}
              </option>
            ))}
          </select>
          {error}
        </div>
      );
    case "choices":
      return (
        <fieldset id={id} {...aria}>
          <legend className={labelClass}>{label}</legend>
          {error}
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {field.options.map((option) => (
              <label key={option} className="flex items-center gap-2">
                <input type="checkbox" name={name} value={option} defaultChecked={Array.isArray(value) && value.includes(option)} />
                {t(`options.${field.key}.${option}`)}
              </label>
            ))}
          </div>
        </fieldset>
      );
    case "yesno":
      return (
        <fieldset id={id} {...aria}>
          <legend className={labelClass}>{label}</legend>
          {error}
          <div className="flex gap-4">
            {(["yes", "no"] as const).map((option) => (
              <label key={option} className="flex items-center gap-2">
                <input type="radio" name={name} value={option} defaultChecked={value === (option === "yes")} />
                {t(`fields.${option}`)}
              </label>
            ))}
          </div>
        </fieldset>
      );
    case "flag":
      return (
        <div>
          <label className="flex items-start gap-2">
            <input id={id} type="checkbox" name={name} defaultChecked={value === true} className="mt-1" {...aria} />
            <span>{label}</span>
          </label>
          {hint}
          {error}
        </div>
      );
    case "date":
      return (
        <div>
          <label htmlFor={id} className={labelClass}>
            {label}
          </label>
          <input id={id} type="date" name={name} defaultValue={typeof value === "string" ? value : ""} className={inputClass} {...aria} />
          {error}
        </div>
      );
    case "int":
      return (
        <div>
          <label htmlFor={id} className={labelClass}>
            {label}
          </label>
          <input
            id={id}
            type="number"
            name={name}
            min={field.min}
            max={field.max}
            step={1}
            defaultValue={typeof value === "number" ? String(value) : ""}
            className={inputClass}
            {...aria}
          />
          {error}
        </div>
      );
    case "text":
      return (
        <div>
          <label htmlFor={id} className={labelClass}>
            {label}
          </label>
          {field.multiline ? (
            <textarea id={id} name={name} rows={3} maxLength={field.max} defaultValue={typeof value === "string" ? value : ""} className={inputClass} {...aria} />
          ) : (
            <input id={id} name={name} maxLength={field.max} defaultValue={typeof value === "string" ? value : ""} className={inputClass} {...aria} />
          )}
          {error}
        </div>
      );
    case "lines":
      return (
        <div>
          <label htmlFor={id} className={labelClass}>
            {label}
          </label>
          {hint}
          <textarea
            id={id}
            name={name}
            rows={4}
            defaultValue={Array.isArray(value) ? value.join("\n") : ""}
            className={inputClass}
            {...aria}
          />
          {error}
        </div>
      );
  }
}
