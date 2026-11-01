import { publicEnv } from "@/lib/env";

// Zustand von Detail- und Anbieterseiten für den Proxy (ADR 015, Review A3): ungecacht, mit Timeout. Bei einem
// Fehler entscheidet die Seite selbst (fail-open, dort Soft 404 mit noindex).

export type PageState = "public" | "gone" | "missing" | "error";

const TIMEOUT_MS = 800;

export async function fetchPageState(kind: "listing" | "provider", id: string): Promise<PageState> {
  try {
    const response = await fetch(`${publicEnv.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/public_page_state`, {
      method: "POST",
      headers: { apikey: publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ p_kind: kind, p_id: id }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) return "error";
    const state: unknown = await response.json();
    return state === "public" || state === "gone" ? state : "missing";
  } catch {
    return "error";
  }
}

/** Nur Dokumentanfragen prüfen: Prefetch und RSC-Navigation lösen sonst je Link einen DB-Aufruf aus. */
export function isDocumentRequest(headers: Headers): boolean {
  return !headers.has("rsc") && !headers.has("next-router-prefetch") && headers.get("purpose") !== "prefetch";
}
