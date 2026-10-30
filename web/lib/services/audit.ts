import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";

// Audit-Log lesen (ADR 014). Nur Admins mit aal2 sehen Zeilen (RLS audit_log_select_admin).

export const AUDIT_ACTIONS = [
  "listing.active",
  "listing.draft",
  "listing.rejected",
  "listing.removed",
  "role.granted",
  "role.revoked",
  "user.looked_up",
  "profile.blocked",
  "profile.unblocked",
  "verification.verified",
  "verification.rejected",
  "report.handled",
] as const;

export const AUDIT_PAGE = 50;

export type AuditEntry = {
  id: string;
  createdAt: string;
  action: string;
  targetType: string;
  targetId: string;
  actorName: string | null;
  details: Record<string, Json | undefined>;
};

export type AuditFilter = { action: string | null; targetId: string | null; before: { createdAt: string; id: string } | null };

/** Neueste zuerst, Keyset-Paging über (created_at, id). */
export async function getAuditLog({ action, targetId, before }: AuditFilter): Promise<AuditEntry[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("audit_log")
    .select("id, created_at, action, target_type, target_id, details, profiles(display_name)")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(AUDIT_PAGE);
  if (action) query = query.eq("action", action);
  if (targetId) query = query.eq("target_id", targetId);
  if (before) query = query.or(`created_at.lt.${before.createdAt},and(created_at.eq.${before.createdAt},id.lt.${before.id})`);
  const { data } = await query;
  return (data ?? []).map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    actorName: (row.profiles as { display_name: string } | null)?.display_name ?? null,
    details: (row.details ?? {}) as Record<string, Json | undefined>,
  }));
}
