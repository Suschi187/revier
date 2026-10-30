import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decisionSchema, REJECT_CODES } from "./moderation";

const version = "a".repeat(64);
const parse = (input: Record<string, unknown>) => decisionSchema.safeParse({ code: null, note: "", version, ...input });

describe("Grund-Codes", () => {
  it("entsprechen dem Check in der Migration (ADR 014)", () => {
    const sql = readFileSync(join(__dirname, "..", "..", "supabase", "migrations", "20261030110000_moderation_fields.sql"), "utf8");
    const check = /reject_code in \(([^)]*)\)/.exec(sql)![1];
    expect([...check.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])).toEqual([...REJECT_CODES]);
  });
});

describe("decisionSchema", () => {
  it("Freigeben braucht keinen Grund", () => {
    expect(parse({ decision: "approve" }).success).toBe(true);
  });

  it("Zurückgeben und Ablehnen brauchen einen Code", () => {
    for (const decision of ["request_changes", "reject"]) {
      const result = parse({ decision });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]).toMatchObject({ path: ["code"], message: "codeRequired" });
    }
    expect(parse({ decision: "reject", code: "duplicate" }).success).toBe(true);
  });

  it("„anderer Grund“ braucht Freitext; Leerraum zählt nicht", () => {
    expect(parse({ decision: "reject", code: "other", note: " \n " }).error?.issues[0]).toMatchObject({ path: ["note"] });
    expect(parse({ decision: "reject", code: "other", note: "  Passt nicht.  " }).data?.note).toBe("Passt nicht.");
  });

  it("Freitext höchstens 1000 Zeichen (Codepoints), Version als hex", () => {
    expect(parse({ decision: "reject", code: "other", note: "🦌".repeat(1000) }).success).toBe(true);
    expect(parse({ decision: "reject", code: "other", note: "🦌".repeat(1001) }).success).toBe(false);
    expect(parse({ decision: "approve", version: "xyz" }).success).toBe(false);
  });
});
