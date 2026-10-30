import "server-only";
import { fieldsFromHint } from "@/lib/validation/listing";
import type { Decision, RejectCode } from "@/lib/moderation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { getContentHints, loadListing, type ContentHint, type OwnListing } from "./listings";

// Moderation von Anzeigen (ADR 014). Rechte prüft die DB (is_admin mit aal2); Admin-Seiten lesen nur
// Anzeigen in der Prüfung, keine fremden Entwürfe (Review H6).

type Enums = Database["public"]["Enums"];

export async function countPendingListings(): Promise<number> {
  const supabase = await createSupabaseServerClient();
  const { count } = await supabase.from("listings").select("id", { count: "exact", head: true }).eq("status", "pending_review");
  return count ?? 0;
}

export type QueueItem = {
  id: string;
  title: string;
  kind: Enums["listing_kind"];
  direction: Enums["listing_direction"];
  country: Enums["country_code"];
  regionId: string;
  submittedAt: string;
  ownerName: string | null;
  hintCount: number;
  listingRejections: number;
  ownerRejections: number;
};

export const QUEUE_PAGE = 25;

/** Warteschlange, älteste Einreichung zuerst; `after` ist der Cursor (submitted_at und id) der letzten Zeile. */
export async function getReviewQueue(after: { submittedAt: string; id: string } | null): Promise<QueueItem[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("admin_review_queue", {
    p_after_submitted: after?.submittedAt,
    p_after_id: after?.id,
    p_limit: QUEUE_PAGE,
  });
  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    kind: row.kind,
    direction: row.direction,
    country: row.country,
    regionId: row.region_id,
    submittedAt: row.submitted_at,
    ownerName: row.owner_name,
    hintCount: row.hint_count,
    listingRejections: row.listing_rejections,
    ownerRejections: row.owner_rejections,
  }));
}

export type ReviewPhoto = { id: string; url: string; alt: string };

export type Review = {
  /** Version des Inhalts, gelesen vor dem Inhalt (Review B1); null, wenn die Anzeige nicht moderierbar ist. */
  version: string | null;
  listing: OwnListing;
  owner: { name: string | null; memberSince: string | null };
  previousRejections: number;
  hints: ContentHint[];
  photos: ReviewPhoto[];
};

/** Anzeige zur Prüfung. Die Version kommt zuerst, damit sie nie zu einem neueren Stand passt als angezeigt. */
export async function getListingForReview(id: string): Promise<Review | null> {
  const supabase = await createSupabaseServerClient();
  const { data: version } = await supabase.rpc("admin_listing_version", { p_listing_id: id });
  const listing = await loadListing(id, null);
  if (!listing) return null;
  // Schon entschieden oder (eigene) nicht moderierbar: nur der Status, keine weiteren Daten (H6).
  if (listing.status !== "pending_review" || !version) {
    return { version: null, listing, owner: { name: null, memberSince: null }, previousRejections: 0, hints: [], photos: [] };
  }

  const [{ data: row }, { count }, hints, photos] = await Promise.all([
    supabase.from("listings").select("owner_id, profiles(display_name, created_at)").eq("id", id).single(),
    supabase.from("audit_log").select("id", { count: "exact", head: true }).eq("target_id", id).eq("action", "listing.rejected"),
    getContentHints(id),
    signedPhotos(listing),
  ]);
  const profile = (row as unknown as { profiles: { display_name: string; created_at: string } | null } | null)?.profiles ?? null;
  return {
    version: (version as string | null) ?? null,
    listing,
    owner: { name: profile?.display_name ?? null, memberSince: profile?.created_at ?? null },
    previousRejections: count ?? 0,
    hints,
    photos,
  };
}

/** Signierte URLs mit der Session des Admins (Storage-RLS greift), 10 Minuten, nie in geteilten Caches (A10). */
async function signedPhotos(listing: OwnListing): Promise<ReviewPhoto[]> {
  const processed = listing.photos.filter((p) => p.processed);
  if (!processed.length) return [];
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.storage.from("listing-photos").createSignedUrls(processed.map((p) => p.storagePath), 600);
  const byPath = new Map((data ?? []).map((entry) => [entry.path, entry.signedUrl]));
  return processed.flatMap((p, index) => {
    const url = byPath.get(p.storagePath);
    return url ? [{ id: p.id, url, alt: p.altText ?? `${listing.title}, ${index + 1}/${processed.length}` }] : [];
  });
}

export type DecisionResult =
  | { ok: true }
  | { ok: false; error: "changed" | "decided" | "notReady" | "code" | "note" | "forbidden" | "failed"; fields?: string[] };

/** Entscheidung per RPC (ADR 014); übersetzt den Fehlervertrag für die Oberfläche. */
export async function decide(id: string, decision: Decision, version: string, code: RejectCode | null, note: string | null): Promise<DecisionResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("moderate_listing", {
    p_listing_id: id,
    p_decision: decision,
    p_expected_version: version,
    p_code: code ?? undefined,
    p_note: note ?? undefined,
  });
  if (!error) return { ok: true };
  if (error.code === "RV004") return { ok: false, error: "changed" };
  if (error.code === "RV003") return { ok: false, error: "decided" };
  if (error.code === "42501") return { ok: false, error: "forbidden" };
  if (error.code === "23514") {
    const fields = fieldsFromHint(error.hint);
    if (fields.includes("reject_code")) return { ok: false, error: "code" };
    if (fields.includes("reject_reason")) return { ok: false, error: "note" };
    return { ok: false, error: "notReady", fields };
  }
  return { ok: false, error: "failed" };
}
