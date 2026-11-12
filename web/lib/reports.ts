import { z } from "zod";
import type { Database } from "@/lib/supabase/database.types";

// Melden, Ergebnisse und Beschwerden (ADR 020). Die Listen spiegeln die Checks und Enums der Migrationen;
// reports.test.ts vergleicht beide.

type Enums = Database["public"]["Enums"];

export type ReportTarget = Enums["report_target"];
export type ReportReason = Enums["report_reason"];

/** Gründe je Ziel im Formular „Melden“ (der Chat hat eigene, CHAT_REPORT_REASONS). */
export const REPORT_REASONS: Record<"listing" | "profile", readonly ReportReason[]> = {
  listing: ["scam", "illegal", "weapons", "wrong_category", "other"],
  profile: ["scam", "harassment", "illegal", "other"],
};

export const REPORT_OUTCOMES = ["no_action", "content_removed", "point_removed", "account_warned", "account_blocked", "target_gone"] as const;
export type ReportOutcome = (typeof REPORT_OUTCOMES)[number];

/** Codes für Maßnahmen gegen Konten (private.account_action_codes). */
export const ACCOUNT_CODES = ["scam", "illegal", "weapons", "harassment", "spam", "other"] as const;
export type AccountCode = (typeof ACCOUNT_CODES)[number];

/** Audit-Arten, die als Entscheidung gelten (private.decisions_for). In Texten mit „_“ statt „.“. */
export const DECISION_ACTIONS = [
  "listing.rejected",
  "listing.draft",
  "listing.removed",
  "listing.point_removed",
  "profile.blocked",
  "profile.warned",
  "verification.rejected",
  "verification.revoked",
  "report.handled",
] as const;
export type DecisionAction = (typeof DECISION_ACTIONS)[number];

export function actionKey(action: string): string | null {
  return (DECISION_ACTIONS as readonly string[]).includes(action) ? action.replace(".", "_") : null;
}

export const REPORT_NOTE_MAX = 1000;
export const APPEAL_MIN = 10;
export const APPEAL_MAX = 2000;

/** Formular „Melden“: Grund je Ziel, Notiz, Zusicherung „in gutem Glauben“ (nur im Client, nicht gespeichert). */
export const reportSchema = z
  .object({
    type: z.enum(["listing", "profile"]),
    id: z.uuid(),
    reason: z.string(),
    note: z
      .string()
      .transform((v) => v.trim())
      .refine((v) => [...v].length <= REPORT_NOTE_MAX, { error: "noteTooLong" })
      .transform((v) => v || null),
    goodFaith: z.literal("on", { error: "goodFaith" }),
  })
  .superRefine((value, ctx) => {
    if (!(REPORT_REASONS[value.type] as readonly string[]).includes(value.reason)) ctx.addIssue({ code: "custom", path: ["reason"], message: "reason" });
  })
  .transform((value) => ({ ...value, reason: value.reason as ReportReason }));

export const appealSchema = z.object({
  id: z.uuid(),
  text: z
    .string()
    .transform((v) => v.trim())
    .refine((v) => [...v].length >= APPEAL_MIN && [...v].length <= APPEAL_MAX, { error: "text" }),
});
