import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

// Fotos im Browser vorbereiten und hochladen (ADR 011, Vertrag für Clients). Die Verkleinerung entlastet
// nur; Metadaten entfernt verbindlich der Server (Edge Function process-listing-photo).

export const CLIENT_MAX_LONG_SIDE = 2560;
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
/** Vor dem Dekodieren: größere Originale würden den Tab einfrieren lassen (QA M3 F7). */
export const MAX_SOURCE_BYTES = 40 * 1024 * 1024;
export const MAX_SOURCE_PIXELS = 50_000_000;
const JPEG_QUALITY = 0.9;
const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];

export type PhotoError =
  | "heic" | "unsupported" | "tooLarge" | "corrupt" | "limit" | "dailyLimit" | "attempts" | "network" | "failed";

/** HEIC/HEIF erkennen: Dateityp, Endung oder `ftyp`-Box mit HEIF-Marke (iPhones liefern oft keinen Typ). */
export async function isHeic(file: Blob & { name?: string }): Promise<boolean> {
  if (/^image\/hei[cf]/i.test(file.type) || /\.(heic|heif)$/i.test(file.name ?? "")) return true;
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const box = String.fromCharCode(...head.slice(4, 12));
  return /^ftyp(heic|heix|hevc|hevx|heim|heis|mif1|msf1)/.test(box);
}

export function acceptedType(type: string): boolean {
  return ACCEPTED.includes(type.toLowerCase());
}

/** Zielgröße: lange Seite höchstens `max`, Seitenverhältnis bleibt, ganze Pixel. */
export function targetSize(width: number, height: number, max = CLIENT_MAX_LONG_SIDE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * Wandelt nach JPEG (sRGB, Orientierung in die Pixel gedreht, lange Seite ≤ 2560 px). PNG und WebP werden so
 * ebenfalls JPEG; Transparenz bekommt weißen Grund.
 */
export async function prepareForUpload(file: File): Promise<{ ok: true; blob: Blob } | { ok: false; error: PhotoError }> {
  if (await isHeic(file)) return { ok: false, error: "heic" };
  if (!acceptedType(file.type)) return { ok: false, error: "unsupported" };
  if (file.size > MAX_SOURCE_BYTES) return { ok: false, error: "tooLarge" };
  const dimensions = await readDimensions(file);
  if (!dimensions) return { ok: false, error: "corrupt" };
  if (dimensions.width * dimensions.height > MAX_SOURCE_PIXELS) return { ok: false, error: "tooLarge" };
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return { ok: false, error: "corrupt" };
  }
  const size = targetSize(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) return { ok: false, error: "failed" };
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, size.width, size.height);
  context.drawImage(bitmap, 0, 0, size.width, size.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
  if (!blob) return { ok: false, error: "failed" };
  if (blob.size > MAX_UPLOAD_BYTES) return { ok: false, error: "tooLarge" };
  return { ok: true, blob };
}

/** Abmessungen aus dem Bildkopf, ohne die Pixel in voller Größe zu dekodieren. */
async function readDimensions(file: Blob): Promise<{ width: number; height: number } | null> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("load"));
    });
    return { width: image.naturalWidth, height: image.naturalHeight };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Antwortcode der Function bzw. Plattform → Fehler für die Meldung (Spike-Review Auflage 1). */
export function errorFromFunction(status: number, code: string | undefined): PhotoError {
  if (code === "unsupported") return "unsupported";
  if (code === "too_large" || status === 413) return "tooLarge";
  if (code === "corrupt") return "corrupt";
  if (code === "attempts_exhausted" || status === 429) return "attempts";
  // 500, 502, 504, 546 (Ressourcenlimit), Netzabbruch: neu hochladen mit neuer Fotozeile
  return "failed";
}

/**
 * Registriert das Foto (Zeile zuerst, Pfade setzt der Server), lädt es in den Eingang und lässt es verarbeiten.
 * Bei einem Fehler nach dem Registrieren wird die Zeile wieder entfernt, damit „neu hochladen“ sauber startet.
 */
export async function uploadPhoto(
  supabase: SupabaseClient<Database>,
  listingId: string,
  sortOrder: number,
  blob: Blob,
): Promise<{ ok: true } | { ok: false; error: PhotoError }> {
  const row = await supabase
    .from("listing_photos")
    .insert({ listing_id: listingId, sort_order: sortOrder })
    .select("id, upload_path")
    .single();
  if (row.error || !row.data) {
    if (row.error?.code === "RV002") return { ok: false, error: "dailyLimit" };
    if (row.error?.code === "23514") return { ok: false, error: "limit" };
    return { ok: false, error: "failed" };
  }
  const { id, upload_path: path } = row.data;
  const discard = () => supabase.from("listing_photos").delete().eq("id", id);
  if (!path) {
    await discard();
    return { ok: false, error: "failed" };
  }

  const upload = await supabase.storage.from("listing-uploads").upload(path, blob, { contentType: "image/jpeg", upsert: false });
  if (upload.error) {
    await discard();
    return { ok: false, error: "failed" };
  }

  try {
    const { error } = await supabase.functions.invoke("process-listing-photo", { body: { photo_id: id } });
    if (!error) return { ok: true };
    const response = (error as { context?: Response }).context;
    let code: string | undefined;
    try {
      code = response ? ((await response.clone().json()) as { error?: string }).error : undefined;
    } catch {
      code = undefined;
    }
    const failure = errorFromFunction(response?.status ?? 0, code);
    await discard();
    return { ok: false, error: failure };
  } catch {
    await discard();
    return { ok: false, error: "network" };
  }
}
