import { describe, expect, it } from "vitest";
import { fieldErrors, legalFromForm, profileFromForm } from "./profile";

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const base = { displayName: "  Anna  ", accountType: "private", country: "AT", preferredLanguage: "en" };

describe("profileFromForm", () => {
  it("trimmt und leert den Firmennamen bei privatem Konto (DB-Constraint)", () => {
    const result = profileFromForm(form({ ...base, businessName: "Forst GmbH" }));
    expect(result.success && result.data).toEqual({
      displayName: "Anna",
      accountType: "private",
      businessName: null,
      country: "AT",
      preferredLanguage: "en",
    });
  });

  it("verlangt bei gewerblichem Konto einen Firmennamen", () => {
    const result = profileFromForm(form({ ...base, accountType: "business", businessName: "  " }));
    expect(result.success).toBe(false);
    if (!result.success) expect(fieldErrors(result.error)).toEqual({ businessName: "required" });
  });

  it("übernimmt den Firmennamen bei gewerblichem Konto", () => {
    const result = profileFromForm(form({ ...base, accountType: "business", businessName: " Forst GmbH " }));
    expect(result.success && result.data.businessName).toBe("Forst GmbH");
  });

  it.each([
    [{ displayName: "   " }, { displayName: "required" }],
    [{ displayName: "x".repeat(61) }, { displayName: "tooLong" }],
    [{ country: "FR" }, { country: "invalid" }],
    [{ preferredLanguage: "fr" }, { preferredLanguage: "invalid" }],
    [{ accountType: "admin" }, { accountType: "invalid" }],
  ])("meldet %j", (override, expected) => {
    const result = profileFromForm(form({ ...base, ...override }));
    expect(result.success).toBe(false);
    if (!result.success) expect(fieldErrors(result.error)).toEqual(expected);
  });

  it("meldet fehlende Felder als required bzw. invalid", () => {
    const result = profileFromForm(new FormData());
    expect(result.success).toBe(false);
    if (!result.success)
      expect(fieldErrors(result.error)).toEqual({
        displayName: "required",
        accountType: "invalid",
        country: "invalid",
        preferredLanguage: "invalid",
      });
  });
});

describe("legalFromForm", () => {
  it("verlangt das Häkchen", () => {
    expect(legalFromForm(form({ termsVersion: "v1", privacyVersion: "v1" })).success).toBe(false);
    expect(legalFromForm(form({ accept: "on", termsVersion: "v1", privacyVersion: "v1" })).success).toBe(true);
  });
});
