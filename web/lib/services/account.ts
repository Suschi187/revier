import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Konto löschen und Datenexport (ADR 019). Beide über die Session des Nutzers und Definer-RPCs, ohne service_role.
// Die Fehlercodes sind der Vertrag für Web und iOS: RV007 frische Anmeldung, RV005 TOTP, 42501 mit
// hint admin_role, RV002 Export-Limit.

export type DeletionResult = "ok" | "reauth" | "step_up" | "admin_role" | "failed";

function hintOf(hint: string | null | undefined): Record<string, unknown> {
  try {
    const parsed: unknown = hint ? JSON.parse(hint) : null;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function requestAccountDeletion(): Promise<DeletionResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("request_account_deletion");
  if (!error) return "ok";
  if (error.code === "RV007") return "reauth";
  if (error.code === "RV005") return "step_up";
  if (error.code === "42501" && hintOf(error.hint).reason === "admin_role") return "admin_role";
  return "failed";
}

/** Läuft für dieses Konto schon eine Löschung (deleted_at gesetzt)? */
export async function deletionPending(userId: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("profiles").select("deleted_at").eq("user_id", userId).maybeSingle();
  return !!data?.deleted_at;
}

export type ExportResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: "rate_limited"; retryAfter: string | null }
  | { ok: false; error: "not_allowed" | "failed" };

export async function exportMyData(): Promise<ExportResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("export_my_data");
  if (!error && data && typeof data === "object" && !Array.isArray(data)) return { ok: true, data: data as Record<string, unknown> };
  if (error?.code === "RV002") {
    const retry = hintOf(error.hint).retry_after;
    return { ok: false, error: "rate_limited", retryAfter: typeof retry === "string" ? retry : null };
  }
  if (error?.code === "42501") return { ok: false, error: "not_allowed" };
  return { ok: false, error: "failed" };
}

/**
 * Foto-Links im Export (ADR 019, Review 10.4/6): `download_url` je verarbeitetem Foto. Die Route verlangt Login und
 * Eigentum und leitet auf eine 60-Sekunden-URL weiter; der Export selbst enthält kein Token.
 */
export function withPhotoLinks(data: Record<string, unknown>, siteUrl: string): Record<string, unknown> {
  const base = siteUrl.replace(/\/+$/, "");
  const listings = Array.isArray(data.listings) ? data.listings : [];
  return {
    ...data,
    listings: listings.map((listing) => {
      if (!listing || typeof listing !== "object") return listing;
      const record = listing as Record<string, unknown>;
      const photos = Array.isArray(record.photos) ? record.photos : [];
      return {
        ...record,
        photos: photos.map((photo) =>
          photo && typeof photo === "object" && typeof (photo as { id?: unknown }).id === "string"
            ? { ...photo, download_url: `${base}/api/account/photos/${(photo as { id: string }).id}` }
            : photo,
        ),
      };
    }),
  };
}

/** Signierte 60-Sekunden-URL für ein eigenes, verarbeitetes Foto; `null` für fremde, unbekannte und unverarbeitete. */
export async function ownPhotoUrl(photoId: string): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const { data: claims } = await supabase.auth.getClaims();
  const uid = claims?.claims?.sub;
  if (typeof uid !== "string") return null;
  const { data: photo } = await supabase
    .from("listing_photos")
    .select("storage_path, processed_at, listings!inner(owner_id)")
    .eq("id", photoId)
    .eq("listings.owner_id", uid)
    .maybeSingle();
  if (!photo?.storage_path || !photo.processed_at) return null;
  const { data } = await supabase.storage.from("listing-photos").createSignedUrl(photo.storage_path, 60);
  return data?.signedUrl ?? null;
}
