import { describe, expect, it } from "vitest";
import { isAdminPath, isProtectedPath, localeFromPath, nextFromRedirectTo, safeNextPath } from "./paths";

const SITE = "http://localhost:3000";

describe("safeNextPath", () => {
  it.each([
    ["/de/account", "/de/account"],
    ["/en/account/profile", "/en/account/profile"],
    ["/cs/welcome", "/cs/welcome"],
    ["/pl", "/pl"],
    ["/de/account?tab=x#y", "/de/account"],
    // Seit M4 ein geschützter Bereich (ADR 014, Review A1); Rechte prüft die Seite selbst.
    ["/de/admin", "/de/admin"],
    ["/de/account/../admin", "/de/admin"],
  ])("erlaubt %s", (input, expected) => {
    expect(safeNextPath(input, "de")).toBe(expected);
  });

  it.each([
    undefined,
    null,
    42,
    "",
    "account",
    "https://evil.example/de/account",
    "//evil.example/de/account",
    "/\\evil.example",
    "/%2F%2Fevil.example",
    "/%5Cevil.example",
    "/%252F%252Fevil.example",
    "/de/account%2F..%2F..%2Fx",
    "/de/\taccount",
    "/de/account\r\nSet-Cookie: x=1",
    "/de/../../evil",
    "/fr/account",
    "/de/login",
    "/de/adminx",
    "javascript:alert(1)",
    "/" + "a".repeat(600),
  ])("lehnt %j ab", (input) => {
    expect(safeNextPath(input, "en")).toBe("/en/account");
  });
});

describe("nextFromRedirectTo", () => {
  it("liest next aus der eigenen Bestätigungs-URL", () => {
    expect(nextFromRedirectTo(`${SITE}/de/auth/confirm?next=/de/account/profile`, SITE, "de")).toBe(
      "/de/account/profile",
    );
  });

  it.each([
    "https://evil.example/de/auth/confirm?next=/de/account/profile",
    `${SITE}/de/auth/confirm?next=//evil.example`,
    "not a url",
    undefined,
  ])("fällt bei %j auf das Konto zurück", (input) => {
    expect(nextFromRedirectTo(input, SITE, "cs")).toBe("/cs/account");
  });
});

describe("isProtectedPath / localeFromPath", () => {
  it("erkennt geschützte Bereiche", () => {
    expect(isProtectedPath("/de/account")).toBe(true);
    expect(isProtectedPath("/en/account/profile")).toBe(true);
    expect(isProtectedPath("/pl/welcome")).toBe(true);
    expect(isProtectedPath("/de/accounts")).toBe(false);
    expect(isProtectedPath("/cs/admin/listings")).toBe(true);
    expect(isAdminPath("/de/admin")).toBe(true);
    expect(isAdminPath("/pl/admin/mfa")).toBe(true);
    expect(isAdminPath("/de/adminx")).toBe(false);
    expect(isAdminPath("/de/account/admin")).toBe(false);
    expect(isProtectedPath("/de/login")).toBe(false);
    expect(isProtectedPath("/de")).toBe(false);
  });

  it("leitet die Sprache aus dem Pfad ab", () => {
    expect(localeFromPath("/cs/account")).toBe("cs");
    expect(localeFromPath("/fr/x")).toBe("de");
    expect(localeFromPath("/")).toBe("de");
  });
});
