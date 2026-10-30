import { z } from "zod";

// Moderation (ADR 014): Grund-Vorlagen und Entscheidungen. Die Liste spiegelt den Check auf
// listings.reject_code (Migration moderation_fields); moderation.test.ts vergleicht beide.

export const REJECT_CODES = [
  "incomplete",
  "wrong_category",
  "weapons",
  "prohibited_content",
  "duplicate",
  "contact_in_text",
  "implausible",
  "other",
] as const;
export type RejectCode = (typeof REJECT_CODES)[number];

export const DECISIONS = ["approve", "request_changes", "reject"] as const;
export type Decision = (typeof DECISIONS)[number];

export const NOTE_MAX = 1000;

export function asRejectCode(value: string | null): RejectCode | null {
  return REJECT_CODES.includes(value as RejectCode) ? (value as RejectCode) : null;
}

/** Formular „Entscheidung“: Code bei Zurückgeben und Ablehnen, Freitext bei „anderer Grund“. */
export const decisionSchema = z
  .object({
    decision: z.enum(DECISIONS),
    code: z.enum(REJECT_CODES).nullable(),
    note: z
      .string()
      .transform((v) => v.trim())
      .refine((v) => [...v].length <= NOTE_MAX, { error: "noteTooLong" })
      .transform((v) => v || null),
    version: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .superRefine((value, ctx) => {
    if (value.decision !== "approve" && !value.code) ctx.addIssue({ code: "custom", path: ["code"], message: "codeRequired" });
    if (value.decision !== "approve" && value.code === "other" && !value.note) {
      ctx.addIssue({ code: "custom", path: ["note"], message: "noteRequired" });
    }
  });
