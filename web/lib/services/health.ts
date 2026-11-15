// Gesundheitsprüfung für den Uptime-Check (M10). Prüft nur, ob Supabase Auth mit dem öffentlichen Key antwortet;
// gibt keine Versionen, Hosts oder Fehlermeldungen heraus.

export type Health = { ok: boolean; supabase: "ok" | "down" };

export async function checkHealth(
  supabaseUrl: string,
  anonKey: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 3000,
): Promise<Health> {
  try {
    const response = await fetchImpl(`${supabaseUrl}/auth/v1/health`, {
      headers: { apikey: anonKey },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const up = response.ok;
    return { ok: up, supabase: up ? "ok" : "down" };
  } catch {
    return { ok: false, supabase: "down" };
  }
}
