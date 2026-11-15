import { connection } from "next/server";
import { publicEnv } from "@/lib/env";
import { checkHealth } from "@/lib/services/health";

// Für den Uptime-Check (M10, docs/WEB-RELEASE.md E): 200 wenn Next läuft und Supabase antwortet, sonst 503.
// Nie gecacht, nicht indexiert, ohne Cookies.

export async function GET(): Promise<Response> {
  await connection();
  const health = await checkHealth(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  return Response.json(health, {
    status: health.ok ? 200 : 503,
    headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });
}
