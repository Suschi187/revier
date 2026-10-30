import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Moderation von Anzeigen (ADR 014). Rechte prüft die DB (is_admin mit aal2); Admin-Seiten lesen nur
// Anzeigen in der Prüfung, keine fremden Entwürfe (Review H6).

export async function countPendingListings(): Promise<number> {
  const supabase = await createSupabaseServerClient();
  const { count } = await supabase.from("listings").select("id", { count: "exact", head: true }).eq("status", "pending_review");
  return count ?? 0;
}
