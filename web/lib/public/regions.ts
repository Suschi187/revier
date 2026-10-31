import type { Database } from "@/lib/supabase/database.types";
import data from "./reference-data.json";

// Regions-Slugs und Wildarten-Codes aus den Referenzdaten (ADR 015), erzeugt mit `npm run gen:reference`.
// Der Proxy prüft Kategorie- und Regionspfade damit ohne DB-Aufruf; ein Integrationstest gleicht mit der DB ab.

type Country = Database["public"]["Enums"]["country_code"];
type StateEntry = { code: string; country: string; districts: Record<string, string> };

const STATES = data.states as Record<string, StateEntry>;
const SPECIES = new Set(data.species);

export type RegionRef = { code: string; country: Country; slug: string; level: "state" | "district"; stateSlug: string };

const BY_CODE = new Map<string, RegionRef>();
for (const [stateSlug, state] of Object.entries(STATES)) {
  BY_CODE.set(state.code, { code: state.code, country: state.country as Country, slug: stateSlug, level: "state", stateSlug });
  for (const [slug, code] of Object.entries(state.districts)) {
    BY_CODE.set(code, { code, country: state.country as Country, slug, level: "district", stateSlug });
  }
}

/** Bundesland und optional Kreis aus den URL-Slugs; null, wenn es die Kombination nicht gibt. */
export function regionFromSlugs(state: string, district?: string): RegionRef | null {
  const entry = Object.hasOwn(STATES, state) ? STATES[state] : undefined;
  if (!entry) return null;
  if (district === undefined) return BY_CODE.get(entry.code) ?? null;
  const code = Object.hasOwn(entry.districts, district) ? entry.districts[district] : undefined;
  return code ? (BY_CODE.get(code) ?? null) : null;
}

export function regionByCode(code: string): RegionRef | null {
  return BY_CODE.get(code) ?? null;
}

export function isSpeciesCode(code: string): boolean {
  return SPECIES.has(code);
}

export function allRegionRefs(): RegionRef[] {
  return [...BY_CODE.values()];
}
