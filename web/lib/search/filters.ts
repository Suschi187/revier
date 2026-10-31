import { z } from "zod";
import { Constants } from "@/lib/supabase/database.types";
import { isSpeciesCode, regionByCode } from "@/lib/public/regions";

// Filterformat v1 der Suche (ADR 015), gleichlautend mit private.search_filters_error in der DB. Gemeinsame
// Fälle: supabase/tests/fixtures/search_filters.json. Dazu die Übersetzung zwischen URL-Parametern
// (sprachunabhängig, Preise in Haupteinheiten) und Filtern (Preise in Minor-Einheiten).

const E = Constants.public.Enums;
export const SORTS = ["newest", "price_asc", "price_desc", "relevance"] as const;
const FILTER_PRICE_UNITS = E.price_unit.filter((u) => u !== "on_request");

export type Filters = {
  v: 1;
  q?: string;
  country?: (typeof E.country_code)[number];
  region?: string;
  kind?: (typeof E.listing_kind)[number];
  direction?: (typeof E.listing_direction)[number];
  species?: string[];
  currency?: (typeof E.currency_code)[number];
  price_min?: number;
  price_max?: number;
  price_unit?: (typeof E.price_unit)[number];
  area_min?: number;
  area_max?: number;
  date_from?: string;
  date_to?: string;
  verified_only?: boolean;
  sort?: (typeof SORTS)[number];
};

/** trim() entfernt dieselben Zeichen wie private.trim_all in der DB (ADR 013, listing_whitespace). */
const trimAll = (value: string) => value.trim();

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
});
const price = z.number().int().min(0).max(1_000_000_000_000);
const area = z.number().min(0).max(10_000_000);

const KEY_SCHEMAS = {
  v: z.literal(1),
  q: z.string().refine((value) => {
    const trimmed = trimAll(value);
    return [...trimmed].length >= 1 && [...trimmed].length <= 200;
  }),
  country: z.enum(E.country_code),
  region: z.string().refine((code) => regionByCode(code) !== null),
  kind: z.enum(E.listing_kind),
  direction: z.enum(E.listing_direction),
  species: z
    .array(z.string())
    .min(1)
    .max(20)
    .refine((codes) => new Set(codes).size === codes.length && codes.every(isSpeciesCode)),
  currency: z.enum(E.currency_code),
  price_min: price,
  price_max: price,
  price_unit: z.enum(FILTER_PRICE_UNITS as [string, ...string[]]),
  area_min: area,
  area_max: area,
  date_from: isoDate,
  date_to: isoDate,
  verified_only: z.boolean(),
  sort: z.enum(SORTS),
} as const;

const KEYS = Object.keys(KEY_SCHEMAS) as (keyof typeof KEY_SCHEMAS)[];
// Reihenfolge der Prüfung wie in der DB: zuerst unbekannte Schlüssel (alphabetisch), dann v, dann je Schlüssel.
const CHECK_ORDER: (keyof typeof KEY_SCHEMAS)[] = ["q", "country", "kind", "direction", "currency", "price_unit", "sort", "region",
  "species", "price_min", "price_max", "area_min", "area_max", "date_from", "date_to", "verified_only"];

/** Erster fehlerhafter Schlüssel wie der hint der DB (22023), sonst null. */
export function filtersError(input: unknown): string | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return "filters";
  const filters = input as Record<string, unknown>;
  if (new TextEncoder().encode(JSON.stringify(filters)).length > 4096) return "filters";
  const unknown = Object.keys(filters).filter((key) => !(KEYS as string[]).includes(key)).sort();
  if (unknown.length) return unknown[0];
  if (!KEY_SCHEMAS.v.safeParse(filters.v).success) return "v";
  for (const key of CHECK_ORDER) {
    if (key in filters && !KEY_SCHEMAS[key].safeParse(filters[key]).success) return key;
    if (key === "region" && filters.region !== undefined && filters.country !== undefined
        && regionByCode(filters.region as string)?.country !== filters.country) return "region";
  }
  const f = filters as Filters;
  if ((f.price_min !== undefined || f.price_max !== undefined) && f.currency === undefined) return "currency";
  if (f.price_min !== undefined && f.price_max !== undefined && f.price_min > f.price_max) return "price_max";
  if (f.area_min !== undefined && f.area_max !== undefined && f.area_min > f.area_max) return "area_max";
  if (f.date_from !== undefined && f.date_to !== undefined && f.date_from > f.date_to) return "date_to";
  if ((f.sort === "price_asc" || f.sort === "price_desc") && (f.currency === undefined || f.price_unit === undefined)) return "sort";
  if (f.sort === "relevance" && f.q === undefined) return "sort";
  return null;
}

// ---------------------------------------------------------------------------
// URL-Parameter ↔ Filter. Ungültige Werte fallen einzeln weg; danach fallen auch Werte weg, deren
// Voraussetzung fehlt (Preis ohne Währung, Preis-Sortierung ohne Einheit).
// ---------------------------------------------------------------------------

export const PARAM_NAMES = {
  q: "q",
  country: "country",
  region: "region",
  kind: "kind",
  direction: "dir",
  species: "species",
  currency: "cur",
  price_min: "pmin",
  price_max: "pmax",
  price_unit: "unit",
  area_min: "amin",
  area_max: "amax",
  date_from: "from",
  date_to: "to",
  verified_only: "verified",
  sort: "sort",
} as const satisfies Record<Exclude<keyof Filters, "v">, string>;

export const CURSOR_PARAM = "cursor";
const MINOR = 100;

type Params = URLSearchParams | Record<string, string | string[] | undefined>;

function get(params: Params, name: string): string | undefined {
  const value = params instanceof URLSearchParams ? params.get(name) : params[name];
  const first = Array.isArray(value) ? value[0] : value;
  return first === undefined || first === null || first === "" ? undefined : first;
}

function number(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+(\.\d+)?$/.test(value)) return undefined;
  return Number(value);
}

/** Filter aus dem Query-String; `fixed` (Art, Region aus dem Pfad) geht vor. */
export function filtersFromParams(params: Params, fixed: Partial<Filters> = {}): Filters {
  const raw: Record<string, unknown> = { v: 1 };
  const text = (key: keyof typeof PARAM_NAMES) => get(params, PARAM_NAMES[key]);
  raw.q = text("q") ? trimAll(text("q")!) || undefined : undefined;
  for (const key of ["country", "region", "kind", "direction", "currency", "price_unit", "sort", "date_from", "date_to"] as const) {
    raw[key] = text(key);
  }
  // Formular: ein Feld je Wildart (species=a&species=b); Links: kommagetrennt (species=a,b).
  const speciesValues = params instanceof URLSearchParams ? params.getAll(PARAM_NAMES.species) : [params[PARAM_NAMES.species] ?? []].flat();
  const speciesCodes = speciesValues.flatMap((v) => v.split(",")).filter(Boolean);
  raw.species = speciesCodes.length ? speciesCodes : undefined;
  const pmin = number(text("price_min"));
  const pmax = number(text("price_max"));
  raw.price_min = pmin === undefined || !Number.isInteger(pmin) ? undefined : pmin * MINOR;
  raw.price_max = pmax === undefined || !Number.isInteger(pmax) ? undefined : pmax * MINOR;
  raw.area_min = number(text("area_min"));
  raw.area_max = number(text("area_max"));
  raw.verified_only = text("verified_only") === "1" ? true : undefined;
  Object.assign(raw, fixed);

  // Einzeln prüfen, Ungültiges entfernen; dann Abhängigkeiten, bis nichts mehr fehlt.
  for (const key of KEYS) {
    if (raw[key] === undefined) delete raw[key];
    else if (!KEY_SCHEMAS[key].safeParse(raw[key]).success) delete raw[key];
  }
  for (let round = 0; round < 6; round++) {
    const error = filtersError(raw);
    if (error === null) break;
    if (error === "currency") {
      delete raw.price_min;
      delete raw.price_max;
    } else if (error in fixed) {
      // Pfadwerte sind geprüft; ein Konflikt (Land passt nicht zur Region) entfernt den Query-Wert.
      delete raw[error === "region" ? "country" : error];
    } else {
      delete raw[error];
    }
  }
  return raw as Filters;
}

/** Query-Parameter für Links und Formulare; `omit` lässt Schlüssel weg (z. B. Pfadwerte oder q für `next`). */
export function paramsFromFilters(filters: Filters, omit: (keyof Filters)[] = []): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, name] of Object.entries(PARAM_NAMES) as [Exclude<keyof Filters, "v">, string][]) {
    const value = filters[key];
    if (value === undefined || omit.includes(key)) continue;
    if (key === "price_min" || key === "price_max") params.set(name, String(Math.floor((value as number) / MINOR)));
    else if (key === "species") params.set(name, (value as string[]).join(","));
    else if (key === "verified_only") params.set(name, "1");
    else params.set(name, String(value));
  }
  return params;
}
