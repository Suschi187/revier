import { z } from "zod";
import type { Database } from "@/lib/supabase/database.types";

// Verifizierung (ADR 020): Dokumenttypen, Grund-Codes und Dateiregeln. Die Listen spiegeln die Checks in
// 20261112100000_verification.sql; verification.test.ts vergleicht beide.

export const DOCUMENT_TYPES = ["jagdschein", "jagdkarte", "revierbescheinigung", "gewerbe"] as const satisfies readonly Database["public"]["Enums"]["document_type"][];
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const VERIFICATION_REJECT_CODES = ["unreadable", "expired", "mismatch", "wrong_document", "other"] as const;
export type VerificationRejectCode = (typeof VERIFICATION_REJECT_CODES)[number];

export const REVOKE_CODES = ["expired", "mismatch", "fraud", "other"] as const;
export type RevokeCode = (typeof REVOKE_CODES)[number];

export const VERIFICATION_NOTE_MAX = 1000;
/** Bucket-Grenze (storage.buckets.file_size_limit). */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const DOCUMENT_MIME_TYPES = ["image/jpeg", "image/png", "application/pdf"] as const;
export type DocumentMime = (typeof DOCUMENT_MIME_TYPES)[number];

/** `gewerbe` nur für gewerbliche Konten (begin_verification prüft dasselbe). */
export function documentTypesFor(accountType: Database["public"]["Enums"]["account_type"]): readonly DocumentType[] {
  return accountType === "business" ? DOCUMENT_TYPES : DOCUMENT_TYPES.filter((type) => type !== "gewerbe");
}

/**
 * Tatsächlicher Dateityp nach den ersten Bytes (Review A6): Der Bucket prüft nur den gemeldeten Content-Type.
 * JPEG `FF D8 FF`, PNG `89 50 4E 47`, PDF `%PDF-`; alles andere `null`.
 */
export function sniffDocument(bytes: Uint8Array): DocumentMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-") return "application/pdf";
  return null;
}

export type FileProblem = "fileType" | "fileSize" | "fileEmpty";

/** Vorprüfung im Browser vor dem Upload; verbindlich sind Bucket und Admin-Prüfung. */
export function checkDocumentFile(file: { size: number; type: string }, head: Uint8Array): { ok: true; mime: DocumentMime } | { ok: false; problem: FileProblem } {
  if (file.size === 0) return { ok: false, problem: "fileEmpty" };
  if (file.size > MAX_DOCUMENT_BYTES) return { ok: false, problem: "fileSize" };
  const mime = sniffDocument(head);
  // Gemeldeter und erkannter Typ müssen übereinstimmen (HEIC und umbenannte Dateien fallen hier heraus).
  if (!mime || (file.type && file.type.toLowerCase() !== mime)) return { ok: false, problem: "fileType" };
  return { ok: true, mime };
}

const note = z
  .string()
  .transform((v) => v.trim())
  .refine((v) => [...v].length <= VERIFICATION_NOTE_MAX, { error: "noteTooLong" })
  .transform((v) => v || null);

/** Admin-Formular „Entscheidung“: Code bei Ablehnung, Freitext bei „anderer Grund“. */
export const verificationDecisionSchema = z
  .object({ decision: z.enum(["verify", "reject"]), code: z.enum(VERIFICATION_REJECT_CODES).nullable(), note })
  .superRefine((value, ctx) => {
    if (value.decision === "reject" && !value.code) ctx.addIssue({ code: "custom", path: ["code"], message: "codeRequired" });
    if (value.decision === "reject" && value.code === "other" && !value.note) ctx.addIssue({ code: "custom", path: ["note"], message: "noteRequired" });
  });

/** Admin-Formular „Widerruf“. */
export const revokeSchema = z
  .object({ code: z.enum(REVOKE_CODES), note })
  .superRefine((value, ctx) => {
    if (value.code === "other" && !value.note) ctx.addIssue({ code: "custom", path: ["note"], message: "noteRequired" });
  });
