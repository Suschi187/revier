import { anonClient } from "@/lib/supabase/anon";
import { publicEnv } from "@/lib/env";

// Öffentliche Fotos (ADR 015, Review A5): Bucket bleibt privat, gelesen wird mit dem Anon-Client (RLS
// entscheidet). Jeder Abruf prüft die Sichtbarkeit neu (`no-cache` + ETag, 304 ohne Inhalt), damit ein
// entferntes, gesperrtes oder gelöschtes Foto sofort nicht mehr abrufbar ist, auch unter gespeicherter URL.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const VARIANTS = { thumb: "thumb_path", full: "storage_path" } as const;

function status(code: 404 | 502, cache: string): Response {
  return new Response(null, { status: code, headers: { "Cache-Control": cache, "X-Content-Type-Options": "nosniff" } });
}

export async function GET(request: Request, ctx: RouteContext<"/api/photos/[id]/[variant]">): Promise<Response> {
  const { id, variant } = await ctx.params;
  // Eingaben prüfen, bevor die DB gefragt wird; 404 kurz cachebar (kein Verstärker für Zufalls-IDs).
  if (!UUID_RE.test(id) || !Object.hasOwn(VARIANTS, variant)) return status(404, "public, max-age=60");
  const column = VARIANTS[variant as keyof typeof VARIANTS];

  const client = anonClient();
  const { data: photo, error } = await client
    .from("listing_photos")
    .select("storage_path, thumb_path, processed_at")
    .eq("id", id)
    .not("processed_at", "is", null)
    .maybeSingle();
  if (error) return status(502, "no-store");
  const path = photo?.[column];
  if (!photo || !path) return status(404, "public, max-age=60");

  const etag = `"${id}-${variant}-${new Date(photo.processed_at!).getTime()}"`;
  const headers = {
    "Cache-Control": "public, no-cache",
    ETag: etag,
    "X-Content-Type-Options": "nosniff",
  };
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });

  // Storage-RLS prüft erneut (nur verarbeitete Fotos sichtbarer Anzeigen); der Inhalt wird gestreamt.
  const base = publicEnv.NEXT_PUBLIC_SUPABASE_URL;
  const key = publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const file = await fetch(`${base}/storage/v1/object/authenticated/listing-photos/${path.split("/").map(encodeURIComponent).join("/")}`, {
    headers: { apikey: key },
    cache: "no-store",
  });
  if (file.status === 400 || file.status === 404) return status(404, "public, max-age=60");
  if (!file.ok || !file.body) return status(502, "no-store");
  return new Response(file.body, {
    status: 200,
    headers: {
      ...headers,
      "Content-Type": "image/jpeg",
      "Content-Disposition": "inline",
      ...(file.headers.get("content-length") ? { "Content-Length": file.headers.get("content-length")! } : {}),
    },
  });
}
