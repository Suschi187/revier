import "server-only";
import type { ReportOutcome, ReportReason, ReportTarget } from "@/lib/reports";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { anonClient } from "@/lib/supabase/anon";
import type { Database } from "@/lib/supabase/database.types";

// Melden von Anzeigen und Profilen und „Meine Meldungen“ (ADR 020). Melden ohne Legal-Gate und auch für gesperrte
// Konten (reports_insert_own); nur sichtbare Ziele (can_report). Fremde, unbekannte und nicht sichtbare Ziele ergeben
// dieselbe Antwort (kein Orakel).

type Enums = Database["public"]["Enums"];

export type ReportableTarget = { type: "listing" | "profile"; id: string; label: string };

/** Ziel für die Meldeseite: nur öffentlich sichtbare, fremde Anzeigen und Anbieter (public_page_state), sonst null. */
export async function reportableTarget(type: "listing" | "profile", id: string, userId: string): Promise<ReportableTarget | null> {
  if (type === "profile" && id === userId) return null;
  const anon = anonClient();
  const { data: state } = await anon.rpc("public_page_state", { p_kind: type === "listing" ? "listing" : "provider", p_id: id });
  if (state !== "public") return null;
  if (type === "listing") {
    const { data } = await anon.from("listings").select("title, owner_id").eq("id", id).maybeSingle();
    return data && data.owner_id !== userId ? { type, id, label: data.title } : null;
  }
  const { data } = await anon.from("public_profiles").select("display_name").eq("user_id", id).maybeSingle();
  return data?.display_name ? { type, id, label: data.display_name } : null;
}

export type SubmitReportResult = "ok" | "duplicate" | "limit" | "unavailable" | "failed";

export async function submitReport(type: "listing" | "profile", id: string, reason: ReportReason, note: string | null): Promise<SubmitReportResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("reports").insert({ target_type: type, target_id: id, reason, note });
  if (!error) return "ok";
  if (error.code === "23505") return "duplicate";
  if (error.code === "54000") return "limit";
  // RLS (can_report): nicht sichtbares, fremdes oder unbekanntes Ziel.
  if (error.code === "42501") return "unavailable";
  return "failed";
}

export type OwnReport = {
  id: string;
  targetType: ReportTarget;
  targetId: string;
  reason: Enums["report_reason"];
  status: Enums["report_status"];
  outcome: ReportOutcome | null;
  createdAt: string;
  handledAt: string | null;
};

/** Eigene Meldungen mit Stand und Ergebnis (DSA Art. 16 Abs. 5), ohne bearbeitenden Admin. */
export async function listOwnReports(userId: string): Promise<OwnReport[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("reports")
    .select("id, target_type, target_id, reason, status, outcome, created_at, handled_at")
    .eq("reporter_id", userId)
    .order("created_at", { ascending: false })
    .limit(200);
  return (data ?? []).map((row) => ({
    id: row.id,
    targetType: row.target_type,
    targetId: row.target_id,
    reason: row.reason,
    status: row.status,
    outcome: row.outcome as ReportOutcome | null,
    createdAt: row.created_at,
    handledAt: row.handled_at,
  }));
}
