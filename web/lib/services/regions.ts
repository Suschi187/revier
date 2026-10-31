import "server-only";
import { cacheLife } from "next/cache";
import type { AppLocale } from "@/i18n/routing";
import type { Database } from "@/lib/supabase/database.types";
import { anonClient } from "@/lib/supabase/anon";

// Öffentliche Referenzdaten (Regionen, Wildarten, PLZ): ohne Session lesbar und deshalb cachebar.
// Kein Cookie-Client, damit "use cache" keine Request-Daten mitnimmt.

type Enums = Database["public"]["Enums"];
export type Country = Enums["country_code"];

const referenceClient = anonClient;

const nameColumn = (locale: AppLocale) => `name_${locale}` as const;

export type Region = { id: string; code: string; name: string; parentId: string | null };

export async function listRegions(country: Country, locale: AppLocale): Promise<{ states: Region[]; districts: Region[] }> {
  "use cache";
  cacheLife("days");
  const { data } = await referenceClient()
    .from("regions")
    .select("id, code, level, parent_id, name_de, name_en, name_cs, name_pl")
    .eq("country", country);
  const toRegion = (row: NonNullable<typeof data>[number]): Region => ({
    id: row.id,
    code: row.code,
    name: row[nameColumn(locale)],
    parentId: row.parent_id,
  });
  const byName = (x: Region, y: Region) => x.name.localeCompare(y.name, locale);
  return {
    states: (data ?? []).filter((r) => r.level === "state").map(toRegion).sort(byName),
    districts: (data ?? []).filter((r) => r.level === "district").map(toRegion).sort(byName),
  };
}

/** Land eines Kreises, z. B. für das PLZ-Format; null bei unbekannter id. */
export async function getRegionCountry(regionId: string): Promise<Country | null> {
  "use cache";
  cacheLife("days");
  const { data } = await referenceClient().from("regions").select("country").eq("id", regionId).maybeSingle();
  return data?.country ?? null;
}

/** Länder mit Regionsdaten (ADR 007); weitere Märkte kommen mit ihren Kreisen und PLZ. */
export const LISTING_COUNTRIES = ["DE", "AT"] as const satisfies readonly Country[];

export type Species = { code: string; name: string };

export async function listSpecies(locale: AppLocale): Promise<Species[]> {
  "use cache";
  cacheLife("days");
  const { data } = await referenceClient().from("game_species").select("code, name_de, name_en, name_cs, name_pl");
  return (data ?? []).map((row) => ({ code: row.code, name: row[nameColumn(locale)] })).sort((x, y) => x.name.localeCompare(y.name, locale));
}

export type PostalCodeOption = { code: string; places: string[] };

/**
 * Alle PLZ eines Kreises mit Ortsnamen. Der Assistent lädt sie auf einmal nach der Kreiswahl und prüft
 * lokal, statt eine einzelne PLZ abzufragen (sonst stünde sie mit dem Nutzer im API-Log, ADR 012).
 */
export async function listPostalCodes(regionId: string): Promise<PostalCodeOption[]> {
  "use cache";
  cacheLife("days");
  const client = referenceClient();
  const { data: links } = await client.from("postal_code_regions").select("country, code").eq("region_id", regionId);
  if (!links?.length) return [];
  const codes = links.map((l) => l.code);
  const { data: places } = await client
    .from("postal_code_places")
    .select("code, place_name")
    .eq("country", links[0].country)
    .in("code", codes);
  const byCode = new Map<string, string[]>(codes.map((c) => [c, []]));
  for (const p of places ?? []) byCode.get(p.code)?.push(p.place_name);
  return [...byCode.entries()]
    .map(([code, names]) => ({ code, places: names.sort() }))
    .sort((x, y) => x.code.localeCompare(y.code));
}
