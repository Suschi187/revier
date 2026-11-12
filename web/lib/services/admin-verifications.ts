import "server-only";
import { publicEnv } from "@/lib/env";
import type { DocumentType, RevokeCode, VerificationRejectCode } from "@/lib/verification";
import { fieldsFromHint } from "@/lib/validation/listing";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

// Verifizierung im Admin (ADR 020). Rechte prüft die DB (is_admin mit aal2, nie das eigene Konto). Das Dokument
// liefert nur die Edge Function verification-document aus (Audit je Abruf, erste Bytes, no-store; Review B3, A6,
// QA M9b F6).

type Enums = Database["public"]["Enums"];

export const VERIFICATION_QUEUE_PAGE = 25;

/** Eingereichte offene Anträge ohne die eigenen. */
export async function countPendingVerifications(adminId: string): Promise<number> {
  const supabase = await createSupabaseServerClient();
  const { count } = await supabase
    .from("verifications")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending")
    .not("submitted_at", "is", null)
    .neq("user_id", adminId);
  return count ?? 0;
}

export type VerificationQueueItem = {
  id: string;
  submittedAt: string;
  documentType: DocumentType;
  displayName: string;
  accountType: Enums["account_type"];
  country: Enums["country_code"];
  profileStatus: Enums["verification_status"];
  previousRequests: number;
  isOwn: boolean;
};

export async function getVerificationQueue(after: { submittedAt: string; id: string } | null): Promise<VerificationQueueItem[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("admin_verification_queue", {
    p_after_submitted: after?.submittedAt,
    p_after_id: after?.id,
    p_limit: VERIFICATION_QUEUE_PAGE,
  });
  return (data ?? []).map((row) => ({
    id: row.id,
    submittedAt: row.submitted_at,
    documentType: row.document_type,
    displayName: row.display_name,
    accountType: row.account_type,
    country: row.country,
    profileStatus: row.profile_status,
    previousRequests: row.previous_requests,
    isOwn: row.is_own,
  }));
}

export type AdminVerification = {
  id: string;
  status: Enums["verification_request_status"];
  documentType: DocumentType;
  submittedAt: string;
  decidedAt: string | null;
  rejectCode: VerificationRejectCode | null;
  rejectReason: string | null;
  revokedAt: string | null;
  revokeCode: RevokeCode | null;
  revokeReason: string | null;
  documentPresent: boolean;
  documentMime: string | null;
  isOwn: boolean;
  user: {
    id: string;
    displayName: string;
    accountType: Enums["account_type"];
    businessName: string | null;
    country: Enums["country_code"];
    verificationStatus: Enums["verification_status"];
    isBlocked: boolean;
    memberSince: string;
  };
  history: { id: string; status: Enums["verification_request_status"]; documentType: DocumentType; decidedAt: string | null; rejectCode: VerificationRejectCode | null; revokedAt: string | null }[];
};

type Raw = {
  id: string; status: AdminVerification["status"]; document_type: DocumentType; submitted_at: string; decided_at: string | null;
  reject_code: VerificationRejectCode | null; reject_reason: string | null; revoked_at: string | null; revoke_code: RevokeCode | null;
  revoke_reason: string | null; document_present: boolean; document_mime: string | null; is_own: boolean;
  user: { id: string; display_name: string; account_type: Enums["account_type"]; business_name: string | null; country: Enums["country_code"];
          verification_status: Enums["verification_status"]; is_blocked: boolean; member_since: string };
  history: { id: string; status: AdminVerification["status"]; document_type: DocumentType; decided_at: string | null;
             reject_code: VerificationRejectCode | null; revoked_at: string | null }[];
};

/** Antrag mit Konto und Verlauf; `null` für unbekannte, nicht eingereichte oder fremde Zugriffe ohne Recht. */
export async function getVerification(id: string): Promise<AdminVerification | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_verification", { p_id: id });
  if (error || !data) return null;
  const v = data as unknown as Raw;
  return {
    id: v.id,
    status: v.status,
    documentType: v.document_type,
    submittedAt: v.submitted_at,
    decidedAt: v.decided_at,
    rejectCode: v.reject_code,
    rejectReason: v.reject_reason,
    revokedAt: v.revoked_at,
    revokeCode: v.revoke_code,
    revokeReason: v.revoke_reason,
    documentPresent: v.document_present,
    documentMime: v.document_mime,
    isOwn: v.is_own,
    user: {
      id: v.user.id,
      displayName: v.user.display_name,
      accountType: v.user.account_type,
      businessName: v.user.business_name,
      country: v.user.country,
      verificationStatus: v.user.verification_status,
      isBlocked: v.user.is_blocked,
      memberSince: v.user.member_since,
    },
    history: v.history.map((h) => ({
      id: h.id,
      status: h.status,
      documentType: h.document_type,
      decidedAt: h.decided_at,
      rejectCode: h.reject_code,
      revokedAt: h.revoked_at,
    })),
  };
}

/**
 * Dokument über die Edge Function verification-document (QA M9b F6): Admins haben keinen Lesezugriff über die
 * Storage-API mehr. Die Function schreibt je Abruf das Audit, prüft die ersten Bytes und antwortet mit no-store.
 */
export type DocumentView =
  | { ok: true; mime: "image/jpeg" | "image/png"; dataUrl: string }
  | { ok: true; mime: "application/pdf" }
  | { ok: false; error: "mismatch" | "missing" | "forbidden" };

/**
 * Ein Abruf für die Admin-Ansicht (QA M9b N3): Die Function prüft die ersten Bytes, die Seite zeigt nach dem erkannten
 * Typ an. Bilder werden eingebettet (kein zweiter Abruf, ein Audit je Ansicht), PDFs als Download über die Route.
 */
export async function documentView(id: string): Promise<DocumentView> {
  const response = await fetchDocument(id);
  if (!response) return { ok: false, error: "forbidden" };
  if (response.status === 415) return { ok: false, error: "mismatch" };
  if (response.status === 403) return { ok: false, error: "forbidden" };
  if (!response.ok) return { ok: false, error: "missing" };
  const mime = response.headers.get("content-type");
  if (mime === "application/pdf") {
    await response.body?.cancel();
    return { ok: true, mime };
  }
  if (mime !== "image/jpeg" && mime !== "image/png") return { ok: false, error: "mismatch" };
  const bytes = Buffer.from(await response.arrayBuffer());
  return { ok: true, mime, dataUrl: `data:${mime};base64,${bytes.toString("base64")}` };
}

export async function fetchDocument(id: string): Promise<Response | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  return fetch(`${publicEnv.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/verification-document`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, apikey: publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
    cache: "no-store",
  });
}

export type AdminDecisionResult = { ok: true } | { ok: false; error: "decided" | "notFound" | "code" | "note" | "forbidden" | "failed" };

function decisionError(error: { code?: string; hint?: string | null }): AdminDecisionResult {
  if (error.code === "RV003") return { ok: false, error: "decided" };
  if (error.code === "P0002") return { ok: false, error: "notFound" };
  if (error.code === "42501") return { ok: false, error: "forbidden" };
  if (error.code === "23514") {
    const fields = fieldsFromHint(error.hint ?? null);
    return { ok: false, error: fields.some((f) => f.endsWith("_reason")) ? "note" : "code" };
  }
  return { ok: false, error: "failed" };
}

export async function decideVerification(id: string, decision: "verify" | "reject", code: VerificationRejectCode | null, note: string | null): Promise<AdminDecisionResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("decide_verification", { p_id: id, p_decision: decision, p_code: code ?? undefined, p_note: note ?? undefined });
  return error ? decisionError(error) : { ok: true };
}

export async function revokeVerification(userId: string, code: RevokeCode, note: string | null): Promise<AdminDecisionResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("revoke_verification", { p_user_id: userId, p_code: code, p_note: note ?? undefined });
  return error ? decisionError(error) : { ok: true };
}
