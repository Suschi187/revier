import "server-only";
import type { DocumentType, RevokeCode, VerificationRejectCode } from "@/lib/verification";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

// Verifizierung für Nutzer (ADR 020): Antrag beginnen, Datei liegt dann im Browser-Upload auf dem Serverpfad,
// einreichen, zurückziehen. Alles über die Session des Nutzers und die RPCs; die Fehlercodes sind der Vertrag für
// Web und iOS (23505 offener Antrag, RV002 Limit, RV001 Zustimmung, 23514 Typ bzw. Datei, RV003 schon eingereicht).

type Enums = Database["public"]["Enums"];

export type OwnVerification = {
  id: string;
  status: Enums["verification_request_status"];
  documentType: DocumentType;
  createdAt: string;
  submittedAt: string | null;
  decidedAt: string | null;
  rejectCode: VerificationRejectCode | null;
  rejectReason: string | null;
  revokedAt: string | null;
  revokeCode: RevokeCode | null;
  revokeReason: string | null;
  documentPath: string | null;
};

/** Eigene Anträge, neueste zuerst (RLS: nur die eigenen; Prüfer sind nicht lesbar). */
export async function listOwnVerifications(userId: string): Promise<OwnVerification[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("verifications")
    .select("id, status, document_type, created_at, submitted_at, decided_at, reject_code, reject_reason, revoked_at, revoke_code, revoke_reason, document_path")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  return (data ?? []).map((row) => ({
    id: row.id,
    status: row.status,
    documentType: row.document_type,
    createdAt: row.created_at,
    submittedAt: row.submitted_at,
    decidedAt: row.decided_at,
    rejectCode: row.reject_code as VerificationRejectCode | null,
    rejectReason: row.reject_reason,
    revokedAt: row.revoked_at,
    revokeCode: row.revoke_code as RevokeCode | null,
    revokeReason: row.revoke_reason,
    documentPath: row.document_path,
  }));
}

function hintOf(hint: string | null | undefined): Record<string, unknown> {
  try {
    const parsed: unknown = hint ? JSON.parse(hint) : null;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export type BeginResult =
  | { ok: true; id: string; path: string }
  | { ok: false; error: "rateLimited"; retryAfter: string | null }
  | { ok: false; error: "open" | "legal" | "type" | "notAllowed" | "failed" };

export async function beginVerification(type: DocumentType): Promise<BeginResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("begin_verification", { p_document_type: type });
  const row = data as { id?: unknown; path?: unknown } | null;
  if (!error && typeof row?.id === "string" && typeof row.path === "string") return { ok: true, id: row.id, path: row.path };
  if (error?.code === "RV002") {
    const retry = hintOf(error.hint).retry_after;
    return { ok: false, error: "rateLimited", retryAfter: typeof retry === "string" ? retry : null };
  }
  if (error?.code === "23505") return { ok: false, error: "open" };
  if (error?.code === "RV001") return { ok: false, error: "legal" };
  if (error?.code === "23514") return { ok: false, error: "type" };
  if (error?.code === "42501") return { ok: false, error: "notAllowed" };
  return { ok: false, error: "failed" };
}

export type SubmitResult = { ok: true } | { ok: false; error: "missingFile" | "submitted" | "notFound" | "legal" | "notAllowed" | "failed" };

export async function submitVerification(id: string): Promise<SubmitResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("submit_verification", { p_id: id });
  if (!error) return { ok: true };
  if (error.code === "23514") return { ok: false, error: "missingFile" };
  if (error.code === "RV003") return { ok: false, error: "submitted" };
  if (error.code === "P0002") return { ok: false, error: "notFound" };
  if (error.code === "RV001") return { ok: false, error: "legal" };
  if (error.code === "42501") return { ok: false, error: "notAllowed" };
  return { ok: false, error: "failed" };
}

/**
 * Zurückziehen eines offenen Antrags. Vor der Einreichung löscht die Session des Nutzers zuerst die Datei
 * (Delete-Policy bis zur Einreichung, Review A6); danach räumt sie der 24-h-Job ab.
 */
export async function withdrawVerification(userId: string, id: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data: row } = await supabase
    .from("verifications")
    .select("document_path, submitted_at, status")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!row || row.status !== "pending") return false;
  if (!row.submitted_at && row.document_path) await supabase.storage.from("verification-docs").remove([row.document_path]);
  const { error } = await supabase.rpc("withdraw_verification", { p_id: id });
  return !error;
}
