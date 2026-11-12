import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkDocumentFile,
  DOCUMENT_MIME_TYPES,
  DOCUMENT_TYPES,
  documentTypesFor,
  MAX_DOCUMENT_BYTES,
  REVOKE_CODES,
  revokeSchema,
  sniffDocument,
  VERIFICATION_REJECT_CODES,
  verificationDecisionSchema,
} from "./verification";

const sql = readFileSync(join(__dirname, "..", "..", "supabase", "migrations", "20261112100000_verification.sql"), "utf8");
const codesOf = (column: string) => [...new RegExp(`${column} text check \\(${column} in \\(([^)]*)\\)`).exec(sql)![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

describe("Listen = Migration (ADR 020)", () => {
  it("Grund-Codes für Ablehnung und Widerruf", () => {
    expect(codesOf("reject_code")).toEqual([...VERIFICATION_REJECT_CODES]);
    expect(codesOf("revoke_code")).toEqual([...REVOKE_CODES]);
  });

  it("Dateitypen des Buckets (kein HEIC)", () => {
    const types = /allowed_mime_types = array\[([^\]]*)\]/.exec(sql)![1];
    expect([...types.matchAll(/'([a-z/]+)'/g)].map((m) => m[1])).toEqual([...DOCUMENT_MIME_TYPES]);
  });

  it("gewerbe nur für gewerbliche Konten", () => {
    expect(documentTypesFor("private")).toEqual(["jagdschein", "jagdkarte", "revierbescheinigung"]);
    expect(documentTypesFor("business")).toEqual([...DOCUMENT_TYPES]);
  });
});

const bytes = (...values: number[]) => new Uint8Array(values);
const text = (value: string) => new TextEncoder().encode(value);

describe("sniffDocument (Review A6)", () => {
  it("erkennt JPEG, PNG und PDF an den ersten Bytes", () => {
    expect(sniffDocument(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffDocument(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a))).toBe("image/png");
    expect(sniffDocument(text("%PDF-1.7"))).toBe("application/pdf");
  });

  it("alles andere ist null (HEIC, HTML, SVG, leer, abgeschnitten)", () => {
    expect(sniffDocument(bytes(0, 0, 0, 0x18, ...text("ftypheic")))).toBeNull();
    expect(sniffDocument(text("<html><script>"))).toBeNull();
    expect(sniffDocument(text("<svg xmlns"))).toBeNull();
    expect(sniffDocument(bytes())).toBeNull();
    expect(sniffDocument(bytes(0xff, 0xd8))).toBeNull();
    expect(sniffDocument(text("%PDF"))).toBeNull();
  });
});

describe("checkDocumentFile", () => {
  const jpeg = bytes(0xff, 0xd8, 0xff, 0xe0);
  it("gemeldeter und erkannter Typ müssen passen", () => {
    expect(checkDocumentFile({ size: 10, type: "image/jpeg" }, jpeg)).toEqual({ ok: true, mime: "image/jpeg" });
    expect(checkDocumentFile({ size: 10, type: "" }, jpeg)).toEqual({ ok: true, mime: "image/jpeg" });
    expect(checkDocumentFile({ size: 10, type: "image/png" }, jpeg)).toEqual({ ok: false, problem: "fileType" });
    expect(checkDocumentFile({ size: 10, type: "image/heic" }, bytes(0, 0, 0, 0x18))).toEqual({ ok: false, problem: "fileType" });
  });

  it("Größe: leer und über 10 MB", () => {
    expect(checkDocumentFile({ size: 0, type: "image/jpeg" }, jpeg)).toEqual({ ok: false, problem: "fileEmpty" });
    expect(checkDocumentFile({ size: MAX_DOCUMENT_BYTES + 1, type: "image/jpeg" }, jpeg)).toEqual({ ok: false, problem: "fileSize" });
    expect(checkDocumentFile({ size: MAX_DOCUMENT_BYTES, type: "image/jpeg" }, jpeg).ok).toBe(true);
  });
});

describe("Admin-Formulare", () => {
  it("Verifizieren ohne Grund, Ablehnen mit Code, other mit Freitext", () => {
    expect(verificationDecisionSchema.safeParse({ decision: "verify", code: null, note: "" }).success).toBe(true);
    expect(verificationDecisionSchema.safeParse({ decision: "reject", code: null, note: "" }).error?.issues[0]).toMatchObject({ path: ["code"] });
    expect(verificationDecisionSchema.safeParse({ decision: "reject", code: "unreadable", note: "" }).success).toBe(true);
    expect(verificationDecisionSchema.safeParse({ decision: "reject", code: "other", note: "  " }).error?.issues[0]).toMatchObject({ path: ["note"] });
    expect(verificationDecisionSchema.safeParse({ decision: "reject", code: "other", note: "x".repeat(1001) }).success).toBe(false);
  });

  it("Widerruf: Code Pflicht, other mit Freitext", () => {
    expect(revokeSchema.safeParse({ code: "fraud", note: "" }).success).toBe(true);
    expect(revokeSchema.safeParse({ code: "other", note: "" }).success).toBe(false);
    expect(revokeSchema.safeParse({ code: "unreadable", note: "" }).success).toBe(false);
  });
});
