import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { OwnPhoto } from "./listings";

// Fotos einer eigenen Anzeige (ADR 011). Hochladen und Verarbeiten laufen im Browser (photo-upload.ts),
// weil die Datei nicht durch den Next.js-Server gehen soll.

export type PhotoResult = "ok" | "failed";

export async function setAltText(photoId: string, altText: string | null): Promise<PhotoResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("listing_photos").update({ alt_text: altText }).eq("id", photoId).select("id");
  return error || !data?.length ? "failed" : "ok";
}

export async function reorderPhotos(listingId: string, photoIds: string[]): Promise<PhotoResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("reorder_listing_photos", { p_listing_id: listingId, p_photo_ids: photoIds });
  return error ? "failed" : "ok";
}

/**
 * Entfernt ein Foto: erst die Dateien (Bild und Thumbnail), dann die Zeile. Ein noch liegender Eingang
 * ist für den Besitzer nicht löschbar; den räumt der Job in M9 ab (ADR 011).
 */
export async function removePhoto(listingId: string, photo: OwnPhoto): Promise<PhotoResult> {
  const supabase = await createSupabaseServerClient();
  if (photo.processed) await supabase.storage.from("listing-photos").remove([photo.storagePath, photo.thumbPath]);
  const { data, error } = await supabase.from("listing_photos").delete().eq("id", photo.id).eq("listing_id", listingId).select("id");
  return error || !data?.length ? "failed" : "ok";
}

/** Signierte URLs der Thumbnails verarbeiteter Fotos (Bucket privat), 1 Stunde gültig. */
export async function thumbnailUrls(photos: OwnPhoto[]): Promise<Record<string, string>> {
  const processed = photos.filter((p) => p.processed);
  if (!processed.length) return {};
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.storage.from("listing-photos").createSignedUrls(processed.map((p) => p.thumbPath), 3600);
  const byPath = new Map((data ?? []).map((entry) => [entry.path, entry.signedUrl]));
  return Object.fromEntries(processed.flatMap((p) => (byPath.get(p.thumbPath) ? [[p.id, byPath.get(p.thumbPath)!]] : [])));
}
