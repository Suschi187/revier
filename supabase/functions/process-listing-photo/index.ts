// Edge Function process-listing-photo (ADR 011): verarbeitet ein hochgeladenes Original aus dem privaten Eingang
// `listing-uploads` zu Bild und Thumbnail ohne Metadaten in `listing-photos`.
// Aufruf: POST { "photo_id": "<uuid>" } mit dem Access Token des Besitzers (verify_jwt = true).
// Antworten (JSON): 200 { status: "processed", width, height } oder { error: <code> } mit
//   400 bad_request, 401 unauthorized, 404 not_found (unbekannt und fremd gleich), 409 not_uploaded,
//   413 too_large, 422 unsupported | corrupt, 429 attempts_exhausted, 500 internal.
// Logs enthalten nur Foto-id, Ergebnis und Dauer: keine Pfade, keine Bildbytes, keine EXIF-Werte (Auflage 9).
import { createClient } from "@supabase/supabase-js";
import { processJpeg } from "./pipeline.ts";

const MAX_BYTES = 15 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Code =
  | "processed" | "bad_request" | "unauthorized" | "not_found" | "not_uploaded" | "too_large" | "unsupported" | "corrupt"
  | "attempts_exhausted" | "internal";

const STATUS: Record<Code, number> = {
  processed: 200, bad_request: 400, unauthorized: 401, not_found: 404, not_uploaded: 409, too_large: 413,
  unsupported: 422, corrupt: 422, attempts_exhausted: 429, internal: 500,
};

// Aufrufe kommen aus dem Browser mit Bearer-Token (keine Cookies), deshalb ist `*` ausreichend.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(code: Code, photo: string | null, started: number, extra: Record<string, number> = {}): Response {
  console.log(JSON.stringify({ fn: "process-listing-photo", photo, result: code, ms: Math.round(performance.now() - started) }));
  const body = code === "processed" ? { status: code, ...extra } : { error: code };
  return Response.json(body, { status: STATUS[code], headers: CORS });
}

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function photoIdFrom(request: Request): Promise<string | null> {
  try {
    const body = await request.json();
    return typeof body?.photo_id === "string" && UUID.test(body.photo_id) ? body.photo_id : null;
  } catch {
    return null;
  }
}

async function handle(request: Request, started: number): Promise<Response> {
  if (request.method !== "POST") return reply("bad_request", null, started);
  const photoId = await photoIdFrom(request);
  if (!photoId) return reply("bad_request", null, started);

  // Gateway prüft die Signatur (verify_jwt); getUser prüft zusätzlich, dass das Konto existiert.
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth.user) return reply("unauthorized", photoId, started);
  const userId = auth.user.id;

  // Besitz ausdrücklich prüfen; fremde und unbekannte Fotos bekommen dieselbe Antwort.
  const { data: photo, error: photoError } = await admin
    .from("listing_photos")
    .select("upload_path, processed_at, listings!inner(owner_id)")
    .eq("id", photoId)
    .eq("listings.owner_id", userId)
    .maybeSingle<{ upload_path: string; processed_at: string | null }>();
  if (photoError) throw photoError;
  if (!photo) return reply("not_found", photoId, started);
  if (photo.processed_at) return reply("processed", photoId, started);

  const uploads = admin.storage.from("listing-uploads");
  const removeInput = () => uploads.remove([photo.upload_path]);
  const { data: blob, error: downloadError } = await uploads.download(photo.upload_path);
  if (downloadError || !blob) return reply("not_uploaded", photoId, started);
  if (blob.size > MAX_BYTES) {
    await removeInput();
    return reply("too_large", photoId, started);
  }

  // Versuch erst nach dem Download zählen: Ein noch nicht hochgeladenes Foto kostet keinen Versuch.
  const { data: claims, error: claimError } = await admin.rpc("claim_photo_processing", { p_photo_id: photoId, p_user_id: userId });
  if (claimError) throw claimError;
  const claim = (claims as { state: string; storage_path: string; thumb_path: string }[])[0];
  if (claim.state === "processed") return reply("processed", photoId, started);
  if (claim.state === "exhausted") return reply("attempts_exhausted", photoId, started);
  if (claim.state !== "claimed") {
    await removeInput();
    return reply("not_found", photoId, started);
  }

  const result = processJpeg(new Uint8Array(await blob.arrayBuffer()));
  if (!result.ok) {
    // Eingang löschen, damit der Client neu hochladen kann (neue Fotozeile, ADR 011).
    await removeInput();
    return reply(result.error, photoId, started);
  }

  const photos = admin.storage.from("listing-photos");
  for (const [path, bytes] of [[claim.storage_path, result.full], [claim.thumb_path, result.thumb]] as const) {
    const { error } = await photos.upload(path, bytes, { contentType: "image/jpeg", upsert: true, cacheControl: "31536000" });
    if (error) throw error;
  }
  const { data: state, error: completeError } = await admin.rpc("complete_photo_processing", {
    p_photo_id: photoId, p_width: result.width, p_height: result.height,
  });
  if (completeError) throw completeError;
  if (state === "gone") {
    // Foto während der Verarbeitung gelöscht: eigene Ausgaben wieder entfernen.
    await photos.remove([claim.storage_path, claim.thumb_path]);
    await removeInput();
    return reply("not_found", photoId, started);
  }
  await removeInput();
  return reply("processed", photoId, started, { width: result.width, height: result.height });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const started = performance.now();
  try {
    return await handle(request, started);
  } catch {
    // Keine Details ins Log: Fehlerobjekte von Storage/PostgREST können Pfade mit der Nutzer-id enthalten.
    // Der Eingang bleibt liegen; ein neuer Versuch ist bis zur Grenze möglich.
    return reply("internal", null, started);
  }
});
