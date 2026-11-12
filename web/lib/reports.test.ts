import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Constants } from "./supabase/database.types";
import { ACCOUNT_CODES, actionKey, appealSchema, DECISION_ACTIONS, REPORT_OUTCOMES, REPORT_REASONS, reportSchema } from "./reports";

const sql = readFileSync(join(__dirname, "..", "..", "supabase", "migrations", "20261112120000_reports_appeals.sql"), "utf8");
const quoted = (text: string) => [...text.matchAll(/'([a-z_.]+)'/g)].map((m) => m[1]);
const ID = "3f2b8c1e-6a4d-4e7b-9c10-5d8e2f1a0b7c";

describe("Listen = Migration (ADR 020)", () => {
  it("Ergebnisse, Konto-Codes, Entscheidungsarten", () => {
    expect(quoted(/outcome text check \(outcome in \(([^)]*)\)/.exec(sql)![1])).toEqual([...REPORT_OUTCOMES]);
    expect(quoted(/select array\[([^\]]*)\] \$\$/.exec(sql)![1])).toEqual([...ACCOUNT_CODES]);
    const decisions = [...sql.matchAll(/a\.action in \(([^)]*)\)/g)].flatMap((m) => quoted(m[1]));
    expect(new Set([...decisions, "report.handled"])).toEqual(new Set(DECISION_ACTIONS));
  });

  it("Gründe im Formular sind Werte des Enums report_reason", () => {
    for (const reasons of Object.values(REPORT_REASONS)) for (const r of reasons) expect(Constants.public.Enums.report_reason).toContain(r);
  });

  it("actionKey nur für bekannte Arten", () => {
    expect(actionKey("listing.removed")).toBe("listing_removed");
    expect(actionKey("role.granted")).toBeNull();
  });
});

describe("reportSchema", () => {
  const base = { type: "listing", id: ID, reason: "scam", note: "", goodFaith: "on" };
  it("Grund passt zum Ziel, Zusicherung Pflicht, Notiz ≤ 1000", () => {
    expect(reportSchema.safeParse(base).success).toBe(true);
    expect(reportSchema.safeParse({ ...base, reason: "harassment" }).error?.issues[0]?.path).toEqual(["reason"]);
    expect(reportSchema.safeParse({ ...base, type: "profile", reason: "harassment" }).success).toBe(true);
    expect(reportSchema.safeParse({ ...base, goodFaith: undefined }).error?.issues[0]?.path).toEqual(["goodFaith"]);
    expect(reportSchema.safeParse({ ...base, note: "x".repeat(1001) }).success).toBe(false);
    expect(reportSchema.safeParse({ ...base, type: "message" }).success).toBe(false);
  });
});

describe("appealSchema", () => {
  it("10 bis 2000 Zeichen nach dem Trimmen", () => {
    expect(appealSchema.safeParse({ id: ID, text: "   kurz    " }).success).toBe(false);
    expect(appealSchema.safeParse({ id: ID, text: "Das war ein Irrtum." }).success).toBe(true);
    expect(appealSchema.safeParse({ id: ID, text: "x".repeat(2001) }).success).toBe(false);
  });
});
