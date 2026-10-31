import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { allRegionRefs } from "@/lib/public/regions";
import { PARAM_NAMES, SORTS, type Filters } from "@/lib/search/filters";
import type { Species } from "@/lib/services/regions";
import { Constants } from "@/lib/supabase/database.types";

const E = Constants.public.Enums;
const UNITS = E.price_unit.filter((u) => u !== "on_request");
const input = "w-full rounded border border-stone-400 px-2 py-1.5";

/**
 * Filter als GET-Formular (ohne JavaScript bedienbar, ADR 015, Review A12). Werte aus dem Pfad (Art, Region)
 * sind fest und erscheinen nicht als Feld. Preise in Haupteinheiten; Umrechnung gibt es nicht.
 */
export async function FilterForm({
  action,
  filters,
  fixed,
  locale,
  species,
  regionNames,
}: {
  action: string;
  filters: Filters;
  fixed: (keyof Filters)[];
  locale: AppLocale;
  species: Species[];
  regionNames: Record<string, string>;
}) {
  const [t, tl, tc] = await Promise.all([getTranslations("Public.filters"), getTranslations("Listings"), getTranslations("Profile.countries")]);
  const states = allRegionRefs()
    .filter((r) => r.level === "state")
    .map((r) => ({ ...r, name: regionNames[r.code] ?? r.code }))
    .sort((a, b) => a.name.localeCompare(b.name, locale));
  const countries = [...new Set(states.map((s) => s.country))];
  const major = (minor: number | undefined) => (minor === undefined ? "" : String(Math.floor(minor / 100)));
  const show = (key: keyof Filters) => !fixed.includes(key);

  return (
    <form action={action} method="get" className="mt-6 grid gap-4 rounded border border-stone-300 p-4" aria-labelledby="filters-heading">
      <h2 id="filters-heading" className="text-lg font-semibold">{t("heading")}</h2>
      <div>
        <label htmlFor="f-q" className="block font-medium">{t("q")}</label>
        <input id="f-q" name={PARAM_NAMES.q} type="search" maxLength={200} defaultValue={filters.q ?? ""} className={input} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {show("kind") && (
          <div>
            <label htmlFor="f-kind" className="block font-medium">{tl("fields.kind")}</label>
            <select id="f-kind" name={PARAM_NAMES.kind} defaultValue={filters.kind ?? ""} className={input}>
              <option value="">{t("any")}</option>
              {E.listing_kind.map((kind) => <option key={kind} value={kind}>{tl(`kinds.${kind}`)}</option>)}
            </select>
          </div>
        )}
        <div>
          <label htmlFor="f-dir" className="block font-medium">{tl("fields.direction")}</label>
          <select id="f-dir" name={PARAM_NAMES.direction} defaultValue={filters.direction ?? ""} className={input}>
            <option value="">{t("any")}</option>
            {E.listing_direction.map((d) => <option key={d} value={d}>{tl(`directions.${d}`)}</option>)}
          </select>
        </div>
        {show("country") && show("region") && (
          <div>
            <label htmlFor="f-country" className="block font-medium">{tl("fields.country")}</label>
            <select id="f-country" name={PARAM_NAMES.country} defaultValue={filters.country ?? ""} className={input}>
              <option value="">{t("any")}</option>
              {E.country_code.map((c) => <option key={c} value={c}>{tc(c)}</option>)}
            </select>
          </div>
        )}
        {show("region") && (
          <div>
            <label htmlFor="f-region" className="block font-medium">{t("region")}</label>
            <select id="f-region" name={PARAM_NAMES.region} defaultValue={filters.region ?? ""} className={input}>
              <option value="">{t("any")}</option>
              {countries.map((country) => (
                <optgroup key={country} label={tc(country)}>
                  {states.filter((s) => s.country === country).map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
        )}
      </div>

      <fieldset>
        <legend className="font-medium">{tl("fields.species")}</legend>
        <div className="mt-1 grid grid-cols-1 gap-1 sm:grid-cols-3">
          {species.map((s) => (
            <label key={s.code} className="flex items-center gap-2">
              <input type="checkbox" name={`${PARAM_NAMES.species}`} value={s.code} defaultChecked={filters.species?.includes(s.code)} />
              {s.name}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset aria-describedby="f-price-hint">
        <legend className="font-medium">{tl("fields.price")}</legend>
        <p id="f-price-hint" className="text-sm text-stone-700">{t("priceHint")}</p>
        <div className="mt-1 grid gap-3 sm:grid-cols-4">
          <div>
            <label htmlFor="f-cur" className="block text-sm">{tl("fields.currency")}</label>
            <select id="f-cur" name={PARAM_NAMES.currency} defaultValue={filters.currency ?? ""} className={input} aria-describedby="f-price-hint">
              <option value="">{t("any")}</option>
              {E.currency_code.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="f-pmin" className="block text-sm">{t("min")}</label>
            <input id="f-pmin" name={PARAM_NAMES.price_min} inputMode="numeric" pattern="[0-9]*" defaultValue={major(filters.price_min)} className={input} />
          </div>
          <div>
            <label htmlFor="f-pmax" className="block text-sm">{t("max")}</label>
            <input id="f-pmax" name={PARAM_NAMES.price_max} inputMode="numeric" pattern="[0-9]*" defaultValue={major(filters.price_max)} className={input} />
          </div>
          <div>
            <label htmlFor="f-unit" className="block text-sm">{tl("fields.unit")}</label>
            <select id="f-unit" name={PARAM_NAMES.price_unit} defaultValue={filters.price_unit ?? ""} className={input}>
              <option value="">{t("any")}</option>
              {UNITS.map((u) => <option key={u} value={u}>{tl(`priceUnits.${u}`)}</option>)}
            </select>
          </div>
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <fieldset>
          <legend className="font-medium">{tl("fields.area")}</legend>
          <div className="mt-1 grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="f-amin" className="block text-sm">{t("min")}</label>
              <input id="f-amin" name={PARAM_NAMES.area_min} inputMode="decimal" defaultValue={filters.area_min ?? ""} className={input} />
            </div>
            <div>
              <label htmlFor="f-amax" className="block text-sm">{t("max")}</label>
              <input id="f-amax" name={PARAM_NAMES.area_max} inputMode="decimal" defaultValue={filters.area_max ?? ""} className={input} />
            </div>
          </div>
        </fieldset>
        <fieldset aria-describedby="f-date-hint">
          <legend className="font-medium">{t("period")}</legend>
          <p id="f-date-hint" className="text-sm text-stone-700">{t("periodHint")}</p>
          <div className="mt-1 grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="f-from" className="block text-sm">{t("from")}</label>
              <input id="f-from" name={PARAM_NAMES.date_from} type="date" defaultValue={filters.date_from ?? ""} className={input} />
            </div>
            <div>
              <label htmlFor="f-to" className="block text-sm">{t("to")}</label>
              <input id="f-to" name={PARAM_NAMES.date_to} type="date" defaultValue={filters.date_to ?? ""} className={input} />
            </div>
          </div>
        </fieldset>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex items-center gap-2">
          <input type="checkbox" name={PARAM_NAMES.verified_only} value="1" defaultChecked={filters.verified_only === true} />
          {t("verifiedOnly")}
        </label>
        <div>
          <label htmlFor="f-sort" className="block font-medium">{t("sort")}</label>
          <select id="f-sort" name={PARAM_NAMES.sort} defaultValue={filters.sort ?? "newest"} className={input} aria-describedby="f-sort-hint">
            {SORTS.map((s) => <option key={s} value={s}>{t(`sorts.${s}`)}</option>)}
          </select>
          <p id="f-sort-hint" className="text-sm text-stone-700">{t("sortHint")}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" className="rounded bg-stone-900 px-4 py-2 text-white">{t("apply")}</button>
        <a href={action} className="underline">{t("reset")}</a>
      </div>
    </form>
  );
}
