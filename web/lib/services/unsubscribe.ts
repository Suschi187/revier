import "server-only";
import { anonClient } from "@/lib/supabase/anon";

// Abbestellen (ADR 018): anon-Client ohne Session und ohne Cookies, nie service_role. unsubscribe(p_token) macht für
// gültige und ungültige Token dieselbe Arbeit und liefert void (kein Orakel). Fehler nur als Code loggen, nie den Token.

export async function unsubscribeWithToken(token: string): Promise<void> {
  try {
    const { error } = await anonClient().rpc("unsubscribe", { p_token: token });
    if (error) console.error(JSON.stringify({ fn: "unsubscribe", kind: "rpc_failed", code: error.code ?? null }));
  } catch {
    console.error(JSON.stringify({ fn: "unsubscribe", kind: "request_failed" }));
  }
}
