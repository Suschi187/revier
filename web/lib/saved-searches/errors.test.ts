import { describe, expect, it } from "vitest";
import cs from "../../messages/cs.json";
import de from "../../messages/de.json";
import en from "../../messages/en.json";
import pl from "../../messages/pl.json";
import { ERROR_PARAMS, errorParam, filterKeyError, isErrorParam, toError } from "./errors";

// Fehler-Mapping der DB (ADR 018, Migration saved_searches_m8): Codes und hints wie in den Triggern und RPCs.

describe("toError", () => {
  it.each([
    [{ code: "22023", hint: "q" }, { code: "queryTooLong" }],
    [{ code: "22023", hint: "kind" }, { code: "invalid" }],
    [{ code: "22023", hint: null }, { code: "invalid" }],
    [{ code: "23514", hint: '{"reason":"saved_searches_limit"}' }, { code: "limit" }],
    [{ code: "23514", hint: null }, { code: "failed" }],
    [{ code: "23514", hint: "saved_searches_limit" }, { code: "failed" }],
    [{ code: "RV001", hint: "Zustimmung …" }, { code: "legal" }],
    [{ code: "42501" }, { code: "unavailable" }],
    [{ code: "PGRST116" }, { code: "failed" }],
    [null, { code: "failed" }],
  ])("%j", (input, expected) => {
    expect(toError(input)).toEqual(expected);
  });

  it("RV006 liest extend_from aus dem hint, nur als ISO-Zeitpunkt", () => {
    expect(toError({ code: "RV006", hint: '{"extend_from": "2026-12-04T10:00:00Z"}' })).toEqual({ code: "extendNotYet", extendFrom: "2026-12-04T10:00:00Z" });
    expect(toError({ code: "RV006", hint: '{"extend_from": "<script>"}' })).toEqual({ code: "extendNotYet", extendFrom: null });
    expect(toError({ code: "RV006", hint: "kein json" })).toEqual({ code: "extendNotYet", extendFrom: null });
  });

  it("Filter-Schlüssel: q ist der Suchbegriff", () => {
    expect(filterKeyError("q")).toEqual({ code: "queryTooLong" });
    expect(filterKeyError("bbox")).toEqual({ code: "invalid" });
  });

  it("URL-Codes sind genau die bekannten", () => {
    expect(errorParam({ code: "extendNotYet", extendFrom: null })).toBe("extendNotYet");
    expect(isErrorParam("limit")).toBe(true);
    expect(isErrorParam("constructor")).toBe(false);
    expect(isErrorParam(["limit"])).toBe(false);
  });

  it.each([["en", en], ["de", de], ["cs", cs], ["pl", pl]])("Texte für alle Codes in %s", (_lang, messages) => {
    for (const code of ERROR_PARAMS) expect(messages.SavedSearches.errors[code], code).toBeTruthy();
  });
});
