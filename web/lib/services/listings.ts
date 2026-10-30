import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { fieldsFromHint, type Attributes, type ListingDirection, type ListingKind } from "@/lib/validation/listing";

// Anzeigen des angemeldeten Nutzers (Plan M3 7, ADR 013). Rechte und Regeln liegen in der DB (RLS, Guard,
// Bereitschaftsprüfung); diese Schicht übersetzt nur deren Fehler. 0 betroffene Zeilen gelten als Fehler (D2).

type Enums = Database["public"]["Enums"];
export type ListingStatus = Enums["listing_status"];

export type ListingError =
  | { kind: "legal" }
  | { kind: "rateLimited"; retryAfter: string | null }
  | { kind: "fields"; fields: string[] }
  | { kind: "notFound" }
  | { kind: "failed" };

export type Result<T = void> = { ok: true; value: T } | { ok: false; error: ListingError };

type DbError = { code?: string; hint?: string | null } | null;

function toError(error: DbError): ListingError {
  if (!error) return { kind: "notFound" };
  if (error.code === "RV001") return { kind: "legal" };
  if (error.code === "RV002") {
    let retryAfter: string | null = null;
    try {
      const value = (JSON.parse(error.hint ?? "{}") as { retry_after?: unknown }).retry_after;
      retryAfter = typeof value === "string" ? value : null;
    } catch {
      retryAfter = null;
    }
    return { kind: "rateLimited", retryAfter };
  }
  if (error.code === "23514") {
    const fields = fieldsFromHint(error.hint);
    return { kind: "fields", fields: fields.length ? fields : ["form"] };
  }
  if (error.code === "42501") return { kind: "notFound" };
  return { kind: "failed" };
}

function fail(error: DbError): { ok: false; error: ListingError } {
  return { ok: false, error: toError(error) };
}

export type OwnListingSummary = {
  id: string;
  title: string;
  kind: ListingKind;
  direction: ListingDirection;
  status: ListingStatus;
  rejectReason: string | null;
  expiresAt: string | null;
  createdAt: string;
};

export async function listOwnListings(userId: string): Promise<OwnListingSummary[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("listings")
    .select("id, title, kind, direction, status, reject_reason, expires_at, created_at")
    .eq("owner_id", userId)
    .order("created_at", { ascending: false });
  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    kind: row.kind,
    direction: row.direction,
    status: row.status,
    rejectReason: row.reject_reason,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  }));
}

export type OwnPhoto = {
  id: string;
  sortOrder: number;
  altText: string | null;
  uploadPath: string;
  storagePath: string;
  thumbPath: string;
  processed: boolean;
  attempts: number;
};

export type OwnListing = OwnListingSummary & {
  description: string;
  contentLanguage: Enums["language_code"];
  country: Enums["country_code"];
  regionId: string;
  priceMinor: number | null;
  currency: Enums["currency_code"] | null;
  priceUnit: Enums["price_unit"] | null;
  areaHectares: number | null;
  startDate: string | null;
  endDate: string | null;
  attributes: Attributes;
  species: string[];
  place: { postalCode: string | null; placeName: string | null } | null;
  photos: OwnPhoto[];
};

export async function getOwnListing(userId: string, id: string): Promise<OwnListing | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("listings")
    .select(
      "id, title, kind, direction, status, reject_reason, expires_at, created_at, description, content_language, country, region_id, " +
        "price_minor, currency, price_unit, area_hectares, start_date, end_date, attributes, " +
        "listing_species(species_code), listing_places(postal_code, place_name), " +
        "listing_photos(id, sort_order, alt_text, upload_path, storage_path, thumb_path, processed_at, processing_attempts)",
    )
    .eq("id", id)
    .eq("owner_id", userId)
    .maybeSingle();
  if (!data) return null;
  const row = data as unknown as Database["public"]["Tables"]["listings"]["Row"] & {
    listing_species: { species_code: string }[];
    listing_places: { postal_code: string | null; place_name: string | null } | null;
    listing_photos: { id: string; sort_order: number; alt_text: string | null; upload_path: string; storage_path: string; thumb_path: string; processed_at: string | null; processing_attempts: number }[];
  };
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    direction: row.direction,
    status: row.status,
    rejectReason: row.reject_reason,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    description: row.description,
    contentLanguage: row.content_language,
    country: row.country,
    regionId: row.region_id,
    priceMinor: row.price_minor,
    currency: row.currency,
    priceUnit: row.price_unit,
    areaHectares: row.area_hectares,
    startDate: row.start_date,
    endDate: row.end_date,
    attributes: (row.attributes ?? {}) as Attributes,
    species: row.listing_species.map((s) => s.species_code).sort(),
    place: row.listing_places ? { postalCode: row.listing_places.postal_code, placeName: row.listing_places.place_name } : null,
    photos: row.listing_photos
      .map((p) => ({
        id: p.id,
        sortOrder: p.sort_order,
        altText: p.alt_text,
        uploadPath: p.upload_path,
        storagePath: p.storage_path,
        thumbPath: p.thumb_path,
        processed: p.processed_at !== null,
        attempts: p.processing_attempts,
      }))
      .sort((x, y) => x.sortOrder - y.sortOrder),
  };
}

export type DraftInput = {
  kind: ListingKind;
  direction: ListingDirection;
  title: string;
  regionId: string;
  contentLanguage: Enums["language_code"];
};

export async function createDraft(input: DraftInput): Promise<Result<string>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("listings")
    // country leitet der Guard aus dem Kreis ab; der generierte Typ kennt den Trigger nicht.
    .insert({
      kind: input.kind, direction: input.direction, title: input.title, region_id: input.regionId, content_language: input.contentLanguage,
    } as Database["public"]["Tables"]["listings"]["Insert"])
    .select("id")
    .single();
  if (error || !data) return fail(error);
  return { ok: true, value: data.id };
}

export type ListingPatch = Partial<{
  kind: ListingKind;
  direction: ListingDirection;
  title: string;
  description: string;
  contentLanguage: Enums["language_code"];
  priceMinor: number | null;
  currency: Enums["currency_code"] | null;
  priceUnit: Enums["price_unit"] | null;
  areaHectares: number | null;
  startDate: string | null;
  endDate: string | null;
  attributes: Attributes;
}>;

export async function updateListing(id: string, patch: ListingPatch): Promise<Result> {
  const supabase = await createSupabaseServerClient();
  const row: Database["public"]["Tables"]["listings"]["Update"] = {};
  if (patch.kind !== undefined) row.kind = patch.kind;
  if (patch.direction !== undefined) row.direction = patch.direction;
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.description !== undefined) row.description = patch.description;
  if (patch.contentLanguage !== undefined) row.content_language = patch.contentLanguage;
  if (patch.priceMinor !== undefined) row.price_minor = patch.priceMinor;
  if (patch.currency !== undefined) row.currency = patch.currency;
  if (patch.priceUnit !== undefined) row.price_unit = patch.priceUnit;
  if (patch.areaHectares !== undefined) row.area_hectares = patch.areaHectares;
  if (patch.startDate !== undefined) row.start_date = patch.startDate;
  if (patch.endDate !== undefined) row.end_date = patch.endDate;
  if (patch.attributes !== undefined) row.attributes = patch.attributes as Database["public"]["Tables"]["listings"]["Update"]["attributes"];
  const { data, error } = await supabase.from("listings").update(row).eq("id", id).select("id");
  if (error || !data?.length) return fail(error);
  return { ok: true, value: undefined };
}

/** Kreis und Ort in einem Schritt (RPC, ADR 012). */
export async function setLocation(id: string, regionId: string, postalCode: string | null, placeName: string | null): Promise<Result> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("set_listing_location", {
    p_listing_id: id,
    p_region_id: regionId,
    p_postal_code: postalCode ?? undefined,
    p_place_name: placeName ?? undefined,
  });
  if (error) return fail(error);
  return { ok: true, value: undefined };
}

/** Erst neue Wildarten anlegen, dann entfernte löschen: So bleibt eine eingereichte Anzeige bereit (ADR 013). */
export async function setSpecies(id: string, codes: string[]): Promise<Result> {
  const supabase = await createSupabaseServerClient();
  const { data: current, error: readError } = await supabase.from("listing_species").select("species_code").eq("listing_id", id);
  if (readError || !current) return fail(readError);
  const have = new Set(current.map((row) => row.species_code));
  const want = new Set(codes);
  const add = [...want].filter((code) => !have.has(code));
  const remove = [...have].filter((code) => !want.has(code));
  if (add.length) {
    const { error } = await supabase.from("listing_species").insert(add.map((species_code) => ({ listing_id: id, species_code })));
    if (error) return fail(error);
  }
  if (remove.length) {
    const { error } = await supabase.from("listing_species").delete().eq("listing_id", id).in("species_code", remove);
    if (error) return fail(error);
  }
  return { ok: true, value: undefined };
}

async function setStatus(id: string, status: ListingStatus): Promise<Result<ListingStatus>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("listings").update({ status }).eq("id", id).select("status");
  if (error || !data?.length) return fail(error);
  // Fortsetzen kann in der Prüfung landen (Inhalt seit der Freigabe geändert).
  return { ok: true, value: data[0].status };
}

export const submitListing = (id: string) => setStatus(id, "pending_review");
export const withdrawListing = (id: string) => setStatus(id, "draft");
export const pauseListing = (id: string) => setStatus(id, "paused");
export const resumeListing = (id: string) => setStatus(id, "active");

/** Löscht einen Entwurf. Fotos zuerst aus dem Storage (ADR 011), dann die Zeile (cascade). */
export async function deleteDraft(id: string): Promise<Result> {
  const supabase = await createSupabaseServerClient();
  // Dateien nur entfernen, wenn die Anzeige jetzt noch ein Entwurf ist (QA M3 F6): Bei veralteter Ansicht
  // verlöre eine schon eingereichte Anzeige sonst ihre Bilder. Erst danach die Zeile, denn die Storage-Policy
  // verlangt zum Löschen eine bearbeitbare Anzeige.
  const { data: draft } = await supabase
    .from("listings")
    .select("listing_photos(storage_path, thumb_path)")
    .eq("id", id)
    .eq("status", "draft")
    .maybeSingle();
  if (!draft) return fail(null);
  const paths = draft.listing_photos.flatMap((p) => [p.storage_path, p.thumb_path]).filter((p): p is string => Boolean(p));
  if (paths.length) await supabase.storage.from("listing-photos").remove(paths);
  const { data, error } = await supabase.from("listings").delete().eq("id", id).eq("status", "draft").select("id");
  if (error || !data?.length) return fail(error);
  return { ok: true, value: undefined };
}

export type ContentHint = { field: string; term: string; language: Enums["language_code"]; category: string };

export async function getContentHints(id: string): Promise<ContentHint[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("listing_content_hints", { p_listing_id: id });
  return (data ?? []) as ContentHint[];
}
