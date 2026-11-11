import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { anonClient } from "@/lib/supabase/anon";

// Abgeleitete PLZ-Tabelle zum Download (ADR 012, ODbL Share-Alike): nur Referenzdaten aus der Datenbank, öffentlich
// lesbar und ohne Personenbezug. Seitenweise wegen `max_rows` (1000); die Daten ändern sich nur per Migration.

const PAGE = 1000;

type RegionRow = { country: string; code: string; regions: { code: string } | null };
type PlaceRow = { country: string; code: string; place_name: string };

async function allRows<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[] | null> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await fetchPage(from, from + PAGE - 1);
    if (error || !data) return null;
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

function csvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** CSV mit `country,postal_code,region_code,place_names` (Ortsnamen mit `|` getrennt), `null` bei Fehler. */
export async function postalCodesCsv(): Promise<string | null> {
  "use cache";
  cacheLife("days");
  cacheTag("postal-codes");
  const client = anonClient();
  const [regions, places] = await Promise.all([
    allRows<RegionRow>((from, to) =>
      client.from("postal_code_regions").select("country, code, regions(code)").order("country").order("code").order("region_id").range(from, to),
    ),
    allRows<PlaceRow>((from, to) =>
      client.from("postal_code_places").select("country, code, place_name").order("country").order("code").order("place_name").range(from, to),
    ),
  ]);
  if (!regions || !places) return null;
  const names = new Map<string, string[]>();
  for (const p of places) {
    const key = `${p.country}-${p.code}`;
    names.set(key, [...(names.get(key) ?? []), p.place_name]);
  }
  const lines = ["country,postal_code,region_code,place_names"];
  for (const r of regions) {
    if (!r.regions) return null;
    lines.push([r.country, r.code, r.regions.code, (names.get(`${r.country}-${r.code}`) ?? []).join("|")].map(csvField).join(","));
  }
  return lines.join("\n") + "\n";
}
