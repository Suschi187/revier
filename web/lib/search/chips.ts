import type { AppLocale } from "@/i18n/routing";
import { areaText, periodText, priceText, type FilterTexts } from "@/lib/saved-searches/rules";
import { filtersFromParams, paramsFromFilters, type Filters } from "./filters";

/** Ein aktiver Filter über der Trefferliste; `href` ist dieselbe Suche ohne ihn. */
export type FilterChip = { key: string; label: string; href: string };

const CHIP_KEYS = ["kind", "country", "region", "q", "species", "currency", "price_min", "price_max", "price_unit", "area_min",
  "area_max", "date_from", "date_to", "verified_only", "bbox"] as const satisfies (keyof Filters)[];

/**
 * Chips der aktiven Filter in der Reihenfolge des Formulars. Werte aus dem Pfad (Art, Region) sind fest und
 * bekommen keinen Chip; Angebot/Gesuch steht schon in den Reitern, die Sortierung ist kein Filter. Preis, Fläche
 * und Zeitraum fallen je als Gruppe weg, Wildarten einzeln. Danach wird neu geprüft, damit z. B. eine
 * Preis-Sortierung ohne Währung mit wegfällt. `clearAll` entfernt alle Chips auf einmal (Reiter und Ansicht bleiben).
 */
export function filterChips(
  filters: Filters,
  fixed: (keyof Filters)[],
  locale: AppLocale,
  texts: FilterTexts,
  path: string,
  keep: Record<string, string> = {},
): { chips: FilterChip[]; clearAll: string } {
  const fixedValues = Object.fromEntries(fixed.map((key) => [key, filters[key]])) as Partial<Filters>;
  const href = (next: Filters) => {
    const params = paramsFromFilters(filtersFromParams(paramsFromFilters(next), fixedValues), fixed);
    for (const [name, value] of Object.entries(keep)) params.set(name, value);
    return params.size ? `${path}?${params}` : path;
  };
  const without = (...keys: (keyof Filters)[]) => {
    const next: Filters = { ...filters };
    for (const key of keys) delete next[key];
    return href(next);
  };
  const free = (key: keyof Filters) => filters[key] !== undefined && !fixed.includes(key);

  const chips: FilterChip[] = [];
  if (free("kind")) chips.push({ key: "kind", label: texts.kind(filters.kind!), href: without("kind") });
  if (free("country") && !filters.region) chips.push({ key: "country", label: texts.country(filters.country!), href: without("country") });
  if (free("region")) chips.push({ key: "region", label: texts.regionName(filters.region!) ?? filters.region!, href: without("region") });
  if (filters.q) chips.push({ key: "q", label: `${texts.labels.q}: ${texts.quoted(filters.q)}`, href: without("q") });
  for (const code of filters.species ?? []) {
    const rest = filters.species!.filter((s) => s !== code);
    chips.push({
      key: `species:${code}`,
      label: texts.speciesName(code) ?? code,
      href: rest.length ? href({ ...filters, species: rest }) : without("species"),
    });
  }
  const price = priceText(filters, locale, texts);
  if (price) chips.push({ key: "price", label: price, href: without("currency", "price_min", "price_max", "price_unit") });
  const area = areaText(filters, locale, texts);
  if (area) chips.push({ key: "area", label: area, href: without("area_min", "area_max") });
  const period = periodText(filters, locale, texts);
  if (period) chips.push({ key: "period", label: period, href: without("date_from", "date_to") });
  if (filters.verified_only) chips.push({ key: "verified", label: texts.verifiedOnly, href: without("verified_only") });
  if (filters.bbox) chips.push({ key: "bbox", label: texts.mapArea, href: without("bbox") });
  return { chips, clearAll: without(...CHIP_KEYS.filter((key) => !fixed.includes(key))) };
}
