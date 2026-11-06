import "server-only";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { regionNames, speciesNames } from "@/lib/services/regions";
import type { FilterTexts } from "./rules";

/** Labels der Suche (Listings, Public.filters, Profile.countries) für Name-Vorschlag und Kurzbeschreibung. */
export async function filterTexts(locale: AppLocale): Promise<FilterTexts> {
  const [tl, tf, tc, ts, regions, species] = await Promise.all([
    getTranslations({ locale, namespace: "Listings" }),
    getTranslations({ locale, namespace: "Public.filters" }),
    getTranslations({ locale, namespace: "Profile.countries" }),
    getTranslations({ locale, namespace: "SavedSearches" }),
    regionNames(locale),
    speciesNames(locale),
  ]);
  return {
    kind: (kind) => tl(`kinds.${kind}`),
    direction: (direction) => tl(`directions.${direction}`),
    country: (country) => tc(country),
    unit: (unit) => tl(`priceUnits.${unit}`),
    regionName: (code) => regions[code],
    speciesName: (code) => species[code],
    quoted: (text) => ts("quoted", { text }),
    labels: {
      q: tf("q"),
      species: tl("fields.species"),
      price: tl("fields.price"),
      area: tl("fields.area"),
      period: tf("period"),
      from: tf("min"),
      to: tf("max"),
    },
    verifiedOnly: tf("verifiedOnly"),
    mapArea: ts("mapArea"),
    allListings: ts("allListings"),
  };
}
