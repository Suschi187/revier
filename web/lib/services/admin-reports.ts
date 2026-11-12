import "server-only";
import type { RejectCode } from "@/lib/moderation";
import type { AccountCode, ReportOutcome, ReportTarget } from "@/lib/reports";
import { fieldsFromHint } from "@/lib/validation/listing";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

// Meldungen, Konten und Beschwerden im Admin (ADR 020). Rechte prüft die DB (aal2, nie das eigene Konto, keine Konten
// mit Rolle, nicht der ursprüngliche Admin). Kopien gemeldeter Nachrichten nur hinter einem Klick, jeder Abruf
// auditiert (ADR 017).

type Enums = Database["public"]["Enums"];

export const REPORT_QUEUE_PAGE = 25;

export async function countOpenReports(): Promise<number> {
  const supabase = await createSupabaseServerClient();
  const { count } = await supabase.from("reports").select("id", { count: "exact", head: true }).eq("status", "open");
  return count ?? 0;
}

export async function countOpenAppeals(): Promise<number> {
  const supabase = await createSupabaseServerClient();
  const { count } = await supabase.from("appeals").select("id", { count: "exact", head: true }).eq("status", "open");
  return count ?? 0;
}

export type ReportQueueItem = {
  targetType: ReportTarget;
  targetId: string;
  count: number;
  reasons: Enums["report_reason"][];
  oldest: string;
  label: string | null;
  gone: boolean;
};

export async function getReportQueue(after: { oldest: string; type: ReportTarget; id: string } | null): Promise<ReportQueueItem[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("admin_report_queue", {
    p_after_oldest: after?.oldest,
    p_after_type: after?.type,
    p_after_id: after?.id,
    p_limit: REPORT_QUEUE_PAGE,
  });
  return (data ?? []).map((row) => ({
    targetType: row.target_type,
    targetId: row.target_id,
    count: row.report_count,
    reasons: row.reasons,
    oldest: row.oldest,
    label: row.label ?? null,
    gone: row.target_gone,
  }));
}

export type ReportTargetView = {
  targetType: ReportTarget;
  targetId: string;
  label: string | null;
  gone: boolean;
  listing: { id: string; title: string; status: Enums["listing_status"]; hasPoint: boolean; version: string | null; isPublic: boolean } | null;
  account: {
    id: string; displayName: string; accountType: Enums["account_type"]; country: Enums["country_code"]; isBlocked: boolean;
    verificationStatus: Enums["verification_status"]; memberSince: string; isOwn: boolean; hasRole: boolean; listingCount: number;
  } | null;
  open: { id: string; reason: Enums["report_reason"]; note: string | null; createdAt: string }[];
  handledCount: number;
};

type RawTarget = {
  target_type: ReportTarget; target_id: string; label: string | null; gone: boolean;
  listing: { id: string; title: string; status: Enums["listing_status"]; has_point: boolean; version: string | null; is_public: boolean } | null;
  account: { id: string; display_name: string; account_type: Enums["account_type"]; country: Enums["country_code"]; is_blocked: boolean;
             verification_status: Enums["verification_status"]; member_since: string; is_own: boolean; has_role: boolean; listing_count: number } | null;
  open: { id: string; reason: Enums["report_reason"]; note: string | null; created_at: string }[];
  handled_count: number;
};

export async function getReportTarget(type: ReportTarget, id: string): Promise<ReportTargetView | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_report_target", { p_target_type: type, p_target_id: id });
  if (error || !data) return null;
  const t = data as unknown as RawTarget;
  return {
    targetType: t.target_type,
    targetId: t.target_id,
    label: t.label,
    gone: t.gone,
    listing: t.listing && { id: t.listing.id, title: t.listing.title, status: t.listing.status, hasPoint: t.listing.has_point, version: t.listing.version, isPublic: t.listing.is_public },
    account: t.account && {
      id: t.account.id, displayName: t.account.display_name, accountType: t.account.account_type, country: t.account.country,
      isBlocked: t.account.is_blocked, verificationStatus: t.account.verification_status, memberSince: t.account.member_since,
      isOwn: t.account.is_own, hasRole: t.account.has_role, listingCount: t.account.listing_count,
    },
    open: t.open.map((r) => ({ id: r.id, reason: r.reason, note: r.note, createdAt: r.created_at })),
    handledCount: t.handled_count,
  };
}

export type ReportedMessage = { body: string; messageCreatedAt: string; sender: string | null };

/** Kopie einer gemeldeten Nachricht; jeder Abruf schreibt `report.message_viewed`. */
export async function readReportedMessage(reportId: string): Promise<ReportedMessage | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_report_message", { p_report_id: reportId });
  if (error || !data) return null;
  const m = data as { body: string; message_created_at: string; sender: string | null };
  return { body: m.body, messageCreatedAt: m.message_created_at, sender: m.sender };
}

export type AdminActionResult =
  | { ok: true; outcome?: string }
  | { ok: false; error: "changed" | "decided" | "code" | "note" | "forbidden" | "adminRole" | "notFound" | "failed" };

function actionError(error: { code?: string; hint?: string | null }): AdminActionResult {
  if (error.code === "RV004") return { ok: false, error: "changed" };
  if (error.code === "RV003") return { ok: false, error: "decided" };
  if (error.code === "P0002") return { ok: false, error: "notFound" };
  if (error.code === "42501") {
    try {
      if ((JSON.parse(error.hint ?? "{}") as { reason?: string }).reason === "admin_role") return { ok: false, error: "adminRole" };
    } catch {
      // kein JSON-Hinweis
    }
    return { ok: false, error: "forbidden" };
  }
  if (error.code === "23514") {
    const fields = fieldsFromHint(error.hint ?? null);
    return { ok: false, error: fields.some((f) => f === "note" || f.endsWith("_reason")) ? "note" : "code" };
  }
  return { ok: false, error: "failed" };
}

export async function resolveReports(
  type: ReportTarget,
  id: string,
  outcome: Exclude<ReportOutcome, "target_gone">,
  code: RejectCode | AccountCode | null,
  note: string | null,
  version: string | null,
): Promise<AdminActionResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("resolve_reports", {
    p_target_type: type,
    p_target_id: id,
    p_outcome: outcome,
    p_code: code ?? undefined,
    p_note: note ?? undefined,
    p_expected_version: version ?? undefined,
  });
  return error ? actionError(error) : { ok: true, outcome: data as string };
}

export type FoundAccount = {
  id: string; displayName: string; accountType: Enums["account_type"]; country: Enums["country_code"]; isBlocked: boolean;
  verificationStatus: Enums["verification_status"]; memberSince: string; hasRole: boolean; listingCount: number; openReports: number;
};

export type FindResult = { ok: true; account: FoundAccount | null } | { ok: false; error: "limit" | "failed" };

/** Exakte E-Mail oder UUID (Review A9: gemeinsames Limit mit admin_find_user, Audit ohne gesuchte Adresse). */
export async function findAccount(query: string): Promise<FindResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_find_account", { p_query: query });
  if (error) return { ok: false, error: error.code === "54000" ? "limit" : "failed" };
  const row = data?.[0];
  return {
    ok: true,
    account: row
      ? {
          id: row.user_id, displayName: row.display_name, accountType: row.account_type, country: row.country, isBlocked: row.is_blocked,
          verificationStatus: row.verification_status, memberSince: row.member_since, hasRole: row.has_role, listingCount: row.listing_count,
          openReports: row.open_reports,
        }
      : null,
  };
}

export async function setAccountBlocked(userId: string, blocked: boolean, code: AccountCode | null, note: string | null): Promise<AdminActionResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("admin_set_account_blocked", { p_user_id: userId, p_blocked: blocked, p_code: code ?? undefined, p_note: note ?? undefined });
  return error ? actionError(error) : { ok: true };
}

export async function warnAccount(userId: string, code: AccountCode, note: string | null): Promise<AdminActionResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("admin_warn_account", { p_user_id: userId, p_code: code, p_note: note ?? undefined });
  return error ? actionError(error) : { ok: true };
}

export type AppealQueueItem = { id: string; createdAt: string; decisionAction: string; displayName: string; sameReviewerOnly: boolean };

export async function getAppealQueue(after: { createdAt: string; id: string } | null): Promise<AppealQueueItem[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("admin_appeal_queue", { p_after_created: after?.createdAt, p_after_id: after?.id, p_limit: REPORT_QUEUE_PAGE });
  return (data ?? []).map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    decisionAction: row.decision_action,
    displayName: row.display_name,
    sameReviewerOnly: row.same_reviewer_only,
  }));
}

export type AppealView = {
  id: string; createdAt: string; status: "open" | "upheld" | "reversed"; text: string; decidedAt: string | null; decisionNote: string | null;
  sameReviewer: boolean; isOwn: boolean; decisionAction: string;
  user: { id: string; displayName: string; isBlocked: boolean };
  decision: { id: string; action: string; createdAt: string; code: string | null; reason: string | null; targetType: string; targetId: string;
              targetLabel: string | null; outcome: string | null; byMe: boolean } | null;
};

export async function getAppeal(id: string): Promise<AppealView | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_appeal", { p_id: id });
  if (error || !data) return null;
  const a = data as {
    id: string; created_at: string; status: AppealView["status"]; text: string; decided_at: string | null; decision_note: string | null;
    same_reviewer: boolean; is_own: boolean; decision_action: string; user: { id: string; display_name: string; is_blocked: boolean };
    decision: { id: string; action: string; created_at: string; code: string | null; reason: string | null; target_type: string; target_id: string;
                target_label: string | null; outcome: string | null; by_me: boolean } | null;
  };
  return {
    id: a.id, createdAt: a.created_at, status: a.status, text: a.text, decidedAt: a.decided_at, decisionNote: a.decision_note,
    sameReviewer: a.same_reviewer, isOwn: a.is_own, decisionAction: a.decision_action,
    user: { id: a.user.id, displayName: a.user.display_name, isBlocked: a.user.is_blocked },
    decision: a.decision && {
      id: a.decision.id, action: a.decision.action, createdAt: a.decision.created_at, code: a.decision.code, reason: a.decision.reason,
      targetType: a.decision.target_type, targetId: a.decision.target_id, targetLabel: a.decision.target_label, outcome: a.decision.outcome,
      byMe: a.decision.by_me,
    },
  };
}

export async function decideAppeal(id: string, outcome: "upheld" | "reversed", note: string): Promise<AdminActionResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("decide_appeal", { p_appeal_id: id, p_outcome: outcome, p_note: note });
  if (error?.code === "42501") {
    try {
      if ((JSON.parse(error.hint ?? "{}") as { reason?: string }).reason === "same_reviewer") return { ok: false, error: "forbidden" };
    } catch {
      // kein JSON-Hinweis
    }
  }
  return error ? actionError(error) : { ok: true };
}
