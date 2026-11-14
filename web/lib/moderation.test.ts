import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decisionSchema, REJECT_CODES } from "./moderation";

const version = "a".repeat(64);
const parse = (input: Record<string, unknown>) => decisionSchema.safeParse({ code: null, note: "", version, ...input });

describe("Grund-Codes", () => {
  it("entsprechen der jüngsten Definition der Domain listing_reject_code (ADR 014, ADR 022 S3)", () => {
    // Ein neuer Code ändert nur die Domain (create domain … bzw. alter domain … add constraint) in einer neuen Migration.
    const dir = join(__dirname, "..", "..", "supabase", "migrations");
    const definitions = readdirSync(dir)
      .filter((name) => name.endsWith(".sql"))
      .sort()
      .flatMap((name) => [...readFileSync(join(dir, name), "utf8").matchAll(/domain public\.listing_reject_code[\s\S]*?check \(value in \(([^)]*)\)/g)])
      .map((m) => m[1]);
    expect(definitions.length).toBeGreaterThan(0);
    expect([...definitions.at(-1)!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])).toEqual([...REJECT_CODES]);
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
