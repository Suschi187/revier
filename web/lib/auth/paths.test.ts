import { describe, expect, it } from "vitest";
import { canonicalPath, isAdminPath, isProtectedPath, localeFromPath, nextFromRedirectTo, safeNextPath } from "./paths";

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

describe("safeNextPath für öffentliche Seiten (ADR 015, Review A9)", () => {
  const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
  it.each([
    [`/de/anzeige/${id}`, `/de/anzeige/${id}`],
    ["/cs/pronajem-honitby/bayern/muenchen-stadt", "/cs/pronajem-honitby/bayern/muenchen-stadt"],
    [`/pl/oglaszajacy/${id}`, `/pl/oglaszajacy/${id}`],
    ["/de/suche?kind=lease&cur=EUR&pmax=5000&q=Name&evil=1", "/de/suche?kind=lease&cur=EUR&pmax=5000"],
    ["/de/jagdpacht?country=DE#x", "/de/jagdpacht?country=DE"],
    [`/de/anzeige/${id}?kind=lease`, `/de/anzeige/${id}`],
  ])("erlaubt %s", (input, expected) => {
    expect(safeNextPath(input, "de")).toBe(expected);
  });

  it("Server Actions behalten den Suchtext, sonst fällt er weg (QA M5 F9)", () => {
    expect(safeNextPath("/de/suche?q=Rehwild&kind=lease", "de")).toBe("/de/suche?kind=lease");
    expect(safeNextPath("/de/suche?q=Rehwild&kind=lease", "de", { keepSearchText: true })).toBe("/de/suche?q=Rehwild&kind=lease");
    expect(safeNextPath("//evil.example?q=x", "de", { keepSearchText: true })).toBe("/de/account");
  });

  it.each([
    "/en/anzeige/" + id,
    "/de/anzeige/" + id.toUpperCase(),
    "/de/jagdpacht/atlantis",
    "/de/jagdpacht/bayern/kitzbuehel",
    "/de//anzeige/" + id,
    "/de/%2fanzeige",
    "/de/anzeige/x/../../../evil",
    `/de/x/../anzeige/${id}`,
    "/de/suche?next=//evil.example",
  ])("lehnt %s ab oder fällt zurück", (input) => {
    const result = safeNextPath(input, "de");
    expect(result === "/de/account" || result === "/de/suche").toBe(true);
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

describe("canonicalPath", () => {
  it.each([
    ["/de/admin", "/de/admin"],
    ["/de/%61dmin", "/de/admin"],
    ["/de/admi%6E/mfa", "/de/admin/mfa"],
    ["/de/%2561dmin", "/de/admin"],
    ["/de%2Fadmin", "/de/admin"],
    ["/de/admin%2Flistings", "/de/admin/listings"],
    ["/de//admin", "/de/admin"],
    ["/de/%5Cadmin", "/de/admin"],
    ["/de/x/%2E%2E/admin", "/de/admin"],
    ["/de/%09admin", "/de/admin"],
    ["/de/j%C3%A4ger", "/de/j%C3%A4ger"],
    ["/de/j%c3%a4ger", "/de/j%C3%A4ger"],
    ["/de/a%20b", "/de/a%20b"],
  ])("%s → %s", (input, expected) => {
    expect(canonicalPath(input)).toBe(expected);
    // Fixpunkt: der Redirect auf die kanonische Form führt nie in eine Schleife.
    expect(canonicalPath(expected)).toBe(expected);
  });

  it.each(["/de/%zz", "/de/%E0%A4%A", "/de/admin%3Fx", "/de/admin%23x"])("lehnt %s ab", (input) => {
    expect(canonicalPath(input)).toBeNull();
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
