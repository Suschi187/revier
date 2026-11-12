import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Entscheidungen und Beschwerden der Betroffenen und Meldenden (DSA Art. 17, 20; ADR 020). Ohne Legal-Gate und auch
// für gesperrte Konten. Nie die Admin-Identität. Fremde, unbekannte und abgelaufene Entscheidungen: P0002.

export type Decision = {
  id: string;
  action: string;
  createdAt: string;
  code: string | null;
  reason: string | null;
  targetType: string;
  targetId: string;
  targetLabel: string | null;
  outcome: string | null;
  appealUntil: string;
  appealable: boolean;
  appealId: string | null;
  appealStatus: "open" | "upheld" | "reversed" | null;
};

export async function listMyDecisions(): Promise<Decision[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("my_decisions");
  return (data ?? []).map((row) => ({
    id: row.id,
    action: row.action,
    createdAt: row.created_at,
    code: row.code ?? null,
    reason: row.reason ?? null,
    targetType: row.target_type,
    targetId: row.target_id,
    targetLabel: row.target_label ?? null,
    outcome: row.outcome ?? null,
    appealUntil: row.appeal_until,
    appealable: row.appealable,
    appealId: row.appeal_id ?? null,
    appealStatus: (row.appeal_status as Decision["appealStatus"]) ?? null,
  }));
}

export async function getMyDecision(id: string): Promise<Decision | null> {
  return (await listMyDecisions()).find((d) => d.id === id) ?? null;
}

export type AppealDetails = { status: "open" | "upheld" | "reversed"; text: string; createdAt: string; decidedAt: string | null; decisionNote: string | null };

export async function getMyAppeal(id: string): Promise<AppealDetails | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("appeals").select("status, text, created_at, decided_at, decision_note").eq("id", id).maybeSingle();
  return data
    ? { status: data.status as AppealDetails["status"], text: data.text, createdAt: data.created_at, decidedAt: data.decided_at, decisionNote: data.decision_note }
    : null;
}

export type SubmitAppealResult = "ok" | "duplicate" | "notFound" | "text" | "failed";

export async function submitAppeal(decisionId: string, text: string): Promise<SubmitAppealResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("submit_appeal", { p_decision_id: decisionId, p_text: text });
  if (!error) return "ok";
  if (error.code === "23505") return "duplicate";
  if (error.code === "P0002") return "notFound";
  if (error.code === "23514") return "text";
  return "failed";
}
