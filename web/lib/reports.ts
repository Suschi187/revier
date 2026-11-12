import { z } from "zod";
import { REJECT_CODES } from "@/lib/moderation";
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

/** Maßnahmen je Zieltyp im Admin (resolve_reports); target_gone setzt nur die DB. */
export const OUTCOMES_BY_TARGET: Record<ReportTarget, readonly Exclude<ReportOutcome, "target_gone">[]> = {
  listing: ["no_action", "content_removed", "point_removed", "account_warned", "account_blocked"],
  profile: ["no_action", "account_warned", "account_blocked"],
  message: ["no_action", "account_warned", "account_blocked"],
};

const adminNote = z
  .string()
  .transform((v) => v.trim())
  .refine((v) => [...v].length <= REPORT_NOTE_MAX, { error: "note" })
  .transform((v) => v || null);

/** Admin-Formular „Meldungen entscheiden“: Code passend zur Maßnahme, Begründung bei Entfernen und „anderer Grund“. */
export const resolveSchema = z
  .object({
    outcome: z.enum(["no_action", "content_removed", "point_removed", "account_warned", "account_blocked"]),
    code: z.string().nullable(),
    note: adminNote,
    version: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.outcome === "account_warned" || value.outcome === "account_blocked") {
      if (!(ACCOUNT_CODES as readonly string[]).includes(value.code ?? "")) ctx.addIssue({ code: "custom", path: ["code"], message: "code" });
    }
    if (value.outcome === "content_removed" || value.outcome === "point_removed") {
      // Anzeigen-Grund (listings.reject_code), Begründung Pflicht (QA M9b F3, F5).
      if (!(REJECT_CODES as readonly string[]).includes(value.code ?? "")) ctx.addIssue({ code: "custom", path: ["code"], message: "code" });
      if (!value.note) ctx.addIssue({ code: "custom", path: ["note"], message: "note" });
    }
    if (value.outcome === "content_removed" && !value.version) ctx.addIssue({ code: "custom", path: ["version"], message: "changed" });
    if (value.code === "other" && !value.note) ctx.addIssue({ code: "custom", path: ["note"], message: "note" });
  });

/** Admin-Formular „Konto sperren / verwarnen / entsperren“. */
export const accountActionSchema = z
  .object({ action: z.enum(["block", "unblock", "warn"]), code: z.enum(ACCOUNT_CODES).nullable(), note: adminNote })
  .superRefine((value, ctx) => {
    if (value.action !== "unblock" && !value.code) ctx.addIssue({ code: "custom", path: ["code"], message: "code" });
    if (value.code === "other" && !value.note) ctx.addIssue({ code: "custom", path: ["note"], message: "note" });
  });

/** Admin-Formular „Beschwerde entscheiden“: Begründung Pflicht (Art. 20 Abs. 5). */
export const appealDecisionSchema = z.object({
  outcome: z.enum(["upheld", "reversed"]),
  note: z
    .string()
    .transform((v) => v.trim())
    .refine((v) => [...v].length >= 1 && [...v].length <= REPORT_NOTE_MAX, { error: "note" }),
});
