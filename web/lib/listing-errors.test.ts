import { describe, expect, it } from "vitest";
import { toError } from "./listing-errors";

// QA M3 F10: Die Meldung „Limit erreicht“ hing ungetestet an RV002 und dem Hint `retry_after`.
describe("toError", () => {
  it("RV002 mit retry_after ergibt rateLimited mit Zeitpunkt", () => {
    expect(toError({ code: "RV002", hint: '{"retry_after":"2026-10-31T09:15:00+00:00"}' })).toEqual({
      kind: "rateLimited",
      retryAfter: "2026-10-31T09:15:00+00:00",
    });
  });

  it("RV002 ohne oder mit kaputtem Hint ergibt rateLimited ohne Zeitpunkt", () => {
    expect(toError({ code: "RV002", hint: null })).toEqual({ kind: "rateLimited", retryAfter: null });
    expect(toError({ code: "RV002", hint: "kein JSON" })).toEqual({ kind: "rateLimited", retryAfter: null });
    expect(toError({ code: "RV002", hint: '{"retry_after":42}' })).toEqual({ kind: "rateLimited", retryAfter: null });
  });

  it("übrige Codes", () => {
    expect(toError({ code: "RV001" })).toEqual({ kind: "legal" });
    expect(toError({ code: "23514", hint: '{"fields":["species"]}' })).toEqual({ kind: "fields", fields: ["species"] });
    expect(toError({ code: "23514", hint: null })).toEqual({ kind: "fields", fields: ["form"] });
    expect(toError({ code: "42501" })).toEqual({ kind: "notFound" });
    expect(toError(null)).toEqual({ kind: "notFound" });
    expect(toError({ code: "XX000" })).toEqual({ kind: "failed" });
  });
});
