import { describe, expect, it, vi } from "vitest";
import { canonicalPath, safeNextPath } from "@/lib/auth/paths";
import { priceText } from "@/lib/public/format";
import { parsePath, publicPath, publicPaths } from "@/lib/public/paths";
import { filtersError, filtersFromParams, paramsFromFilters } from "@/lib/search/filters";

// QA M5 (docs/QA-REPORT.md, Abschnitt „M5 – Abnahme“): ergänzende Proben zu Rücksprung, Parser, Filtern und
// JSON-LD. Keine Änderung am Feature-Code; bekannte Fehler stünden hier als it.fails.

// json-ld liest lib/env beim Import (wie json-ld.test.ts): feste Testwerte.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SITE_URL ??= "https://example.test";
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "sb_publishable_test-placeholder";
});
const { jsonLdString } = await import("@/lib/public/json-ld");

const ID = "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

describe("QA M5: safeNextPath mit öffentlichen Pfaden (Open Redirect, A9)", () => {
  it.each([
    "//evil.example/de/anzeige/" + ID,
    "/\\evil.example",
    "/de/anzeige/" + ID + "/..//evil.example",
    "/de/anzeige/%2e%2e/%2e%2e//evil.example",
    "/de/suche?next=//evil.example",
    "/de/anzeige/" + ID + "@evil.example",
    "/de/anzeige/" + ID + "\t",
    "/de/anzeige/" + ID.toUpperCase(),
    "/en/anzeige/" + ID,
    "/de/jagdpacht/atlantis",
    "/de/jagdpacht/bayern/dresden",
    "/de/anzeige/%33f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
    "/de/login?next=/de/anzeige/" + ID,
    "https://evil.example/de/suche",
    "/de/%2F%2Fevil.example",
  ])("weist %s ab (Konto oder bereinigtes Ziel)", (input) => {
    const result = safeNextPath(input, "de");
    expect(result.startsWith("/de/")).toBe(true);
    expect(result).not.toContain("evil");
    expect(result).not.toContain("//");
    expect(["/de/account", "/de/suche"]).toContain(result);
  });

  it("nimmt öffentliche Ziele nur kanonisch und baut die Query neu auf (ohne q, ohne Fremdes)", () => {
    expect(safeNextPath(`/de/anzeige/${ID}`, "de")).toBe(`/de/anzeige/${ID}`);
    expect(safeNextPath(`/de/anzeige/${ID}?x=1#frag`, "de")).toBe(`/de/anzeige/${ID}`);
    expect(safeNextPath("/de/suche?q=Max+Mustermann&country=DE&evil=1&cur=EUR&pmax=100", "de")).toBe("/de/suche?country=DE&cur=EUR&pmax=100");
    expect(safeNextPath("/pl/dzierzawa-obwodu/bayern?region=AT-7", "pl")).toBe("/pl/dzierzawa-obwodu/bayern?region=AT-7");
  });

  it("Ergebnis ist immer ein Pfad derselben Origin", () => {
    for (const input of [`/de/anzeige/${ID}`, "/de/suche?country=DE", "/cs/hledani", "/de"]) {
      const result = safeNextPath(input, "de");
      expect(new URL(result, "https://revier.example").origin).toBe("https://revier.example");
    }
  });
});

describe("QA M5: Parser (B2)", () => {
  it("jede öffentliche Form ist in allen Sprachen kanonisch und Fixpunkt von canonicalPath", () => {
    const pages = [
      { route: "home" as const },
      { route: "kind" as const, kind: "driven_hunt" as const },
      { route: "state" as const, kind: "permit" as const, state: "bayern" },
      { route: "district" as const, kind: "lease" as const, state: "bayern", district: "rosenheim" },
      { route: "search" as const },
      { route: "listing" as const, id: ID },
      { route: "provider" as const, id: ID },
    ];
    for (const page of pages) {
      for (const [locale, path] of Object.entries(publicPaths(page))) {
        expect(canonicalPath(path), path).toBe(path);
        const parsed = parsePath(path);
        expect(parsed.type, path).toBe("public");
        if (parsed.type === "public") expect(publicPath(parsed.page, parsed.locale)).toBe(path);
        expect(parsed.type === "public" && parsed.locale).toBe(locale);
      }
    }
  });

  it.each(["/de/anzeige/" + ID + "/", "/de//jagdpacht", "/de/jagdpacht/bayern/rosenheim/x", "/de/anzeige/" + ID + ".json", "/de/suche/x"])(
    "%s ist keine öffentliche Form",
    (path) => {
      expect(parsePath(path).type).not.toBe("public");
    },
  );
});

describe("QA M5: Filter aus dem Query-String", () => {
  it("ungültige und gefährliche Werte fallen weg, das Ergebnis ist immer gültig (DB-Vertrag)", () => {
    const params = new URLSearchParams({
      q: "  x'); drop table listings; --  ",
      country: "FR",
      region: "../../etc",
      kind: "weapons",
      species: "roe_deer,unicorn",
      cur: "USD",
      pmin: "-5",
      pmax: "1e9",
      amin: "NaN",
      from: "2026-02-30",
      to: "2026-13-01",
      sort: "price_asc",
      verified: "true",
      cursor: "x".repeat(500),
    });
    const filters = filtersFromParams(params);
    expect(filtersError(filters)).toBeNull();
    expect(filters).toEqual({ v: 1, q: "x'); drop table listings; --" });
  });

  it("Preis in Haupteinheiten wird exakt in Minor-Einheiten übersetzt (keine Gleitkomma-Fehler)", () => {
    const filters = filtersFromParams(new URLSearchParams({ cur: "CZK", pmin: "19", pmax: "9999999999" }));
    expect(filters.price_min).toBe(1900);
    expect(filters.price_max).toBe(999_999_999_900);
    expect(paramsFromFilters(filters).toString()).toBe("cur=CZK&pmin=19&pmax=9999999999");
  });

  it("Preis über der Obergrenze fällt weg statt die DB zu überlasten", () => {
    const filters = filtersFromParams(new URLSearchParams({ cur: "EUR", pmax: "99999999999999" }));
    expect(filters.price_max).toBeUndefined();
    expect(filtersError(filters)).toBeNull();
  });

  it("Pfadwerte gehen vor: Region aus dem Pfad, widersprechendes Land fällt weg", () => {
    const filters = filtersFromParams(new URLSearchParams({ country: "AT", kind: "helper" }), { kind: "lease", region: "DE-BY" });
    expect(filters).toEqual({ v: 1, kind: "lease", region: "DE-BY" });
  });
});

describe("QA M5: JSON-LD mit UGC", () => {
  it.each([
    "</script><script>alert(1)</script>",
    "<!--<script>",
    "]]>&amp;",
    "a\u2028b\u2029c",
    "</SCRIPT>",
  ])("%s kann den Datenblock nicht beenden und bleibt als Text erhalten", (title) => {
    const out = jsonLdString({ name: title });
    expect(out).not.toMatch(new RegExp("[<>&\\u2028\\u2029]"));
    expect(JSON.parse(out).name).toBe(title);
  });
});

describe("QA M5: Preis je Locale × Währung (A13, Akzeptanz b)", () => {
  const norm = (text: string) => text.replace(/[\u00a0\u202f]/g, " ");
  const t = (key: string) => `[${key}]`;
  for (const locale of ["de", "en", "cs", "pl"]) {
    for (const currency of ["EUR", "CHF", "CZK", "PLN"] as const) {
      it(`${locale} × ${currency}: Originalwährung, exakte Minor-Einheiten, Einheit im selben Text`, () => {
        const whole = priceText({ priceMinor: 500_000, currency, priceUnit: "per_year" }, locale, t)!;
        const cents = priceText({ priceMinor: 123_456, currency, priceUnit: "total" }, locale, t)!;
        const expectWhole = new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: 0 }).format(5000);
        const expectCents = new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: 2 }).format(1234.56);
        expect(norm(whole)).toBe(`${norm(expectWhole)} [priceUnits.per_year]`);
        expect(norm(cents)).toBe(`${norm(expectCents)} [priceUnits.total]`);
      });
    }
  }
  it("auf Anfrage und ohne Preis", () => {
    expect(priceText({ priceMinor: null, currency: null, priceUnit: "on_request" }, "de", t)).toBe("[preview.onRequest]");
    expect(priceText({ priceMinor: null, currency: null, priceUnit: null }, "de", t)).toBeNull();
  });
});
