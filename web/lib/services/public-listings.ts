import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { z } from "zod";
import { anonClient } from "@/lib/supabase/anon";
import { Constants, type Database } from "@/lib/supabase/database.types";
import type { Filters } from "@/lib/search/filters";
import { parsePoint, type LngLat } from "@/lib/map/geo";
import { regionGeo } from "./regions";

// Öffentliche Daten (ADR 015): nur Anon-Client ohne Cookies, feste Spaltenlisten, nie PLZ und Ort und vor
// M6 kein Kartenpunkt. Gecacht mit dem Profil `publicListings` (höchstens 5 Minuten alt); der
// Cache-Zähler `epoch` ist Teil jedes Schlüssels, damit Entfernen, Sperren und Löschen sofort wirken.

const E = Constants.public.Enums;
type Enums = Database["public"]["Enums"];

export const PUBLIC_TAGS = {
  all: "listings",
  listing: (id: string) => `listing:${id}`,
  provider: (id: string) => `provider:${id}`,
} as const;

/** Je Anfrage ungecacht: steigt bei Entfernen, Sperren und Konto-Löschung (Trigger in der DB). */
export async function cacheEpoch(): Promise<number> {
  const { data, error } = await anonClient().rpc("public_cache_epoch");
  // Ohne Zähler ein fester Schlüssel (QA M5 Hinweis): kein neuer Cache-Eintrag je Anfrage, höchstens 5 Minuten alt.
  return error || typeof data !== "number" ? -1 : data;
}

const providerSchema = z.object({
  id: z.uuid(),
  display_name: z.string(),
  account_type: z.enum(E.account_type),
  business_name: z.string().nullable(),
  verified: z.boolean(),
});
export type PublicProvider = z.infer<typeof providerSchema>;

const cardSchema = z.object({
  id: z.uuid(),
  kind: z.enum(E.listing_kind),
  direction: z.enum(E.listing_direction),
  title: z.string(),
  content_language: z.enum(E.language_code),
  country: z.enum(E.country_code),
  district_code: z.string(),
  state_code: z.string(),
  postal_prefix: z.string().nullable(),
  price_minor: z.number().int().nullable(),
  currency: z.enum(E.currency_code).nullable(),
  price_unit: z.enum(E.price_unit).nullable(),
  area_hectares: z.number().nullable(),
  start_date: z.string().nullable(),
  end_date: z.string().nullable(),
  event_date: z.string().nullable(),
  published_at: z.string(),
  /** Verfremdeter Punkt oder Kreismittelpunkt (ADR 016), genau wie gespeichert. */
  point: z.object({ lng: z.number(), lat: z.number() }),
  approx: z.enum(["point", "district"]),
  photo: z
    .object({ id: z.uuid(), width: z.number().int().nullable(), height: z.number().int().nullable(), alt_text: z.string().nullable() })
    .nullable(),
  provider: providerSchema.nullable(),
});
export type ListingCard = z.infer<typeof cardSchema>;

const pageSchema = z.object({
  items: z.array(cardSchema),
  next_cursor: z.string().nullable(),
  total: z.number().int().optional(),
  total_capped: z.boolean().optional(),
});
const favoritesSchema = z.object({ items: z.array(cardSchema), unavailable: z.number().int() });

/** Antwort von `my_favorites` (gleiche Karten wie die Suche). */
export function parseFavorites(data: unknown): { items: ListingCard[]; unavailable: number } | null {
  const parsed = favoritesSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}
export type ListingPage = { items: ListingCard[]; nextCursor: string | null; total: number | null; totalCapped: boolean };

export type SearchResult = { ok: true; page: ListingPage } | { ok: false; error: "invalid" | "failed"; key?: string };

function toPage(data: unknown): ListingPage | null {
  const parsed = pageSchema.safeParse(data);
  if (!parsed.success) return null;
  const { items, next_cursor, total, total_capped } = parsed.data;
  return { items, nextCursor: next_cursor, total: total ?? null, totalCapped: total_capped ?? false };
}

async function runSearch(filters: Filters, cursor: string | null, limit: number): Promise<SearchResult> {
  const { data, error } = await anonClient().rpc("search_listings", { p_filters: filters, p_cursor: cursor ?? undefined, p_limit: limit });
  if (error) return error.code === "22023" ? { ok: false, error: "invalid", key: error.hint ?? undefined } : { ok: false, error: "failed" };
  const page = toPage(data);
  return page ? { ok: true, page } : { ok: false, error: "failed" };
}

/**
 * Listen ohne freien Text und ohne Cursor (Start, Kategorie, Region): gecacht. Alles mit Suchtext, freien
 * Filtern oder Cursor geht über `searchListings` ungecacht (Review A2: beliebige Schlüssel verdrängen den Cache).
 */
export async function cachedListings(filters: Filters, limit: number, epoch: number): Promise<SearchResult> {
  "use cache";
  cacheLife("publicListings");
  cacheTag(PUBLIC_TAGS.all);
  void epoch;
  return runSearch(filters, null, limit);
}

export async function searchListings(filters: Filters, cursor: string | null, limit = 20): Promise<SearchResult> {
  return runSearch(filters, cursor, limit);
}

export type RegionCount = { code: string; level: Enums["region_level"]; listings: number };

export async function regionCounts(kind: Enums["listing_kind"] | null, epoch: number): Promise<RegionCount[]> {
  "use cache";
  cacheLife("publicListings");
  cacheTag(PUBLIC_TAGS.all);
  void epoch;
  const { data } = await anonClient().rpc("listing_region_counts", kind ? { p_kind: kind } : {});
  return (data ?? []).map((row) => ({ code: row.region_code, level: row.level, listings: row.listings }));
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

const LISTING_COLUMNS =
  "id, kind, direction, title, description, content_language, country, region_id, postal_prefix, price_minor, currency, price_unit, " +
  "area_hectares, start_date, end_date, attributes, published_at, approved_at, owner_id, map_point";

export type PublicPhoto = { id: string; width: number | null; height: number | null; altText: string | null };

export type PublicListing = {
  id: string;
  kind: Enums["listing_kind"];
  direction: Enums["listing_direction"];
  title: string;
  description: string;
  contentLanguage: Enums["language_code"];
  country: Enums["country_code"];
  regionId: string;
  districtCode: string;
  /** Verfremdeter Punkt oder Kreismittelpunkt (ADR 016); approx sagt, welches von beiden. */
  point: LngLat | null;
  approx: "point" | "district";
  postalPrefix: string | null;
  priceMinor: number | null;
  currency: Enums["currency_code"] | null;
  priceUnit: Enums["price_unit"] | null;
  areaHectares: number | null;
  startDate: string | null;
  endDate: string | null;
  attributes: Record<string, unknown>;
  publishedAt: string;
  approvedAt: string | null;
  ownerId: string;
  species: string[];
  photos: PublicPhoto[];
  provider: PublicProvider | null;
};

type ListingRow = {
  id: string;
  kind: Enums["listing_kind"];
  direction: Enums["listing_direction"];
  title: string;
  description: string;
  content_language: Enums["language_code"];
  country: Enums["country_code"];
  region_id: string;
  postal_prefix: string | null;
  price_minor: number | null;
  currency: Enums["currency_code"] | null;
  price_unit: Enums["price_unit"] | null;
  area_hectares: number | null;
  start_date: string | null;
  end_date: string | null;
  attributes: Record<string, unknown>;
  published_at: string;
  approved_at: string | null;
  owner_id: string;
  map_point: unknown;
};

/** Öffentliche Anzeige oder null (nicht öffentlich oder unbekannt; den Status setzt der Proxy). */
export async function getPublicListing(id: string, epoch: number): Promise<PublicListing | null> {
  "use cache";
  cacheLife("publicListings");
  cacheTag(PUBLIC_TAGS.all, PUBLIC_TAGS.listing(id));
  void epoch;
  const client = anonClient();
  const { data: row } = await client.from("listings").select(LISTING_COLUMNS).eq("id", id).maybeSingle<ListingRow>();
  if (!row) return null;
  cacheTag(PUBLIC_TAGS.provider(row.owner_id));
  const [region, species, photos, provider] = await Promise.all([
    client.from("regions").select("code").eq("id", row.region_id).single(),
    client.from("listing_species").select("species_code").eq("listing_id", id),
    client
      .from("listing_photos")
      .select("id, width, height, alt_text")
      .eq("listing_id", id)
      .not("processed_at", "is", null)
      .not("storage_path", "is", null)
      .order("sort_order"),
    getProvider(row.owner_id, epoch),
  ]);
  // Ohne eigenen Punkt liegt map_point genau auf dem Kreismittelpunkt (Trigger, ADR 016).
  const point = parsePoint(row.map_point);
  const centre = region.data?.code ? (await regionGeo())[region.data.code] : undefined;
  const approx: "point" | "district" = point && centre && point.lng === centre.lng && point.lat === centre.lat ? "district" : "point";
  return {
    id: row.id,
    kind: row.kind,
    direction: row.direction,
    title: row.title,
    description: row.description,
    contentLanguage: row.content_language,
    country: row.country,
    regionId: row.region_id,
    districtCode: region.data?.code ?? "",
    point,
    approx,
    postalPrefix: row.postal_prefix,
    priceMinor: row.price_minor,
    currency: row.currency,
    priceUnit: row.price_unit,
    areaHectares: row.area_hectares,
    startDate: row.start_date,
    endDate: row.end_date,
    attributes: row.attributes ?? {},
    publishedAt: row.published_at,
    approvedAt: row.approved_at,
    ownerId: row.owner_id,
    species: (species.data ?? []).map((s) => s.species_code),
    photos: (photos.data ?? []).map((p) => ({ id: p.id, width: p.width, height: p.height, altText: p.alt_text })),
    provider,
  };
}

// ---------------------------------------------------------------------------
// Anbieter
// ---------------------------------------------------------------------------

/** Öffentliches Profil (nur Anbieter mit öffentlicher Anzeige, SPEC 3.4) oder null. */
export async function getProvider(id: string, epoch: number): Promise<PublicProvider | null> {
  "use cache";
  cacheLife("publicListings");
  cacheTag(PUBLIC_TAGS.all, PUBLIC_TAGS.provider(id));
  void epoch;
  const { data } = await anonClient()
    .from("public_profiles")
    .select("user_id, display_name, account_type, business_name, verification_status")
    .eq("user_id", id)
    .maybeSingle();
  if (!data?.user_id || !data.display_name || !data.account_type) return null;
  return {
    id: data.user_id,
    display_name: data.display_name,
    account_type: data.account_type,
    business_name: data.business_name,
    verified: data.verification_status === "verified",
  };
}

/** Erste Seite gecacht; weitere Seiten (Cursor) ungecacht, damit beliebige Cursor den Cache nicht füllen. */
export async function providerListings(id: string, cursor: string | null, epoch: number): Promise<ListingPage | null> {
  return cursor ? runProviderListings(id, cursor) : cachedProviderListings(id, epoch);
}

async function cachedProviderListings(id: string, epoch: number): Promise<ListingPage | null> {
  "use cache";
  cacheLife("publicListings");
  cacheTag(PUBLIC_TAGS.all, PUBLIC_TAGS.provider(id));
  void epoch;
  return runProviderListings(id, null);
}

async function runProviderListings(id: string, cursor: string | null): Promise<ListingPage | null> {
  const { data, error } = await anonClient().rpc("provider_listings", { p_owner: id, p_cursor: cursor ?? undefined, p_limit: 20 });
  return error ? null : toPage(data);
}

// ---------------------------------------------------------------------------
// Karte (ADR 016): Punkte im Bereich, ungecacht (Review A6), mit Zeitlimit (A5).
// ---------------------------------------------------------------------------

const mapPointSchema = z.object({
  id: z.uuid(),
  lng: z.number(),
  lat: z.number(),
  kind: z.enum(E.listing_kind),
  direction: z.enum(E.listing_direction),
  title: z.string(),
  price_minor: z.number().int().nullable(),
  currency: z.enum(E.currency_code).nullable(),
  price_unit: z.enum(E.price_unit).nullable(),
  district_code: z.string(),
  approx: z.enum(["point", "district"]),
});
export type MapPoint = z.infer<typeof mapPointSchema>;
const mapSchema = z.object({ points: z.array(mapPointSchema), truncated: z.boolean() });

export type MapResult = { ok: true; points: MapPoint[]; truncated: boolean } | { ok: false; error: "invalid" | "failed"; key?: string };

const MAP_TIMEOUT_MS = 2000;

export async function mapPoints(filters: Filters): Promise<MapResult> {
  const { data, error } = await anonClient().rpc("map_listings", { p_filters: filters }).abortSignal(AbortSignal.timeout(MAP_TIMEOUT_MS));
  if (error) return error.code === "22023" ? { ok: false, error: "invalid", key: error.hint ?? undefined } : { ok: false, error: "failed" };
  const parsed = mapSchema.safeParse(data);
  return parsed.success ? { ok: true, ...parsed.data } : { ok: false, error: "failed" };
}
