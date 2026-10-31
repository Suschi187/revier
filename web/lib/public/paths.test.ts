import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { routing } from "@/i18n/routing";
import { PROTECTED_SECTIONS } from "@/lib/auth/paths";
import { LISTING_KINDS } from "@/lib/validation/listing";
import { parsePath, publicPath, publicPaths, type PublicRoute } from "./paths";
import { allRegionRefs, regionByCode, regionFromSlugs } from "./regions";
import { KIND_WORDS, PAGE_WORDS, STATIC_SECTIONS } from "./sections";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const ROUTES: PublicRoute[] = [
  { route: "home" },
  ...LISTING_KINDS.flatMap((kind): PublicRoute[] => [
    { route: "kind", kind },
    { route: "state", kind, state: "bayern" },
    { route: "district", kind, state: "bayern", district: "muenchen-stadt" },
  ]),
  { route: "search" },
  { route: "listing", id: ID },
  { route: "provider", id: ID },
];
const WORDS = [...Object.values(KIND_WORDS), ...Object.values(PAGE_WORDS)].flatMap((byLocale) => Object.values(byLocale));

describe("Pfad-Parser (ADR 015)", () => {
  it.each(routing.locales.flatMap((locale) => ROUTES.map((page) => [locale, page] as const)))("%s %j: Roundtrip", (locale, page) => {
    expect(parsePath(publicPath(page, locale))).toEqual({ type: "public", locale, page });
  });

  it("übersetzt die Wörter je Sprache", () => {
    expect(publicPaths({ route: "state", kind: "lease", state: "bayern" })).toEqual({
      de: "/de/jagdpacht/bayern",
      en: "/en/hunting-lease/bayern",
      cs: "/cs/pronajem-honitby/bayern",
      pl: "/pl/dzierzawa-obwodu/bayern",
    });
  });

  it.each([
    "/en/jagdpacht",
    "/de/hunting-lease/bayern",
    "/de/suche/x",
    "/de/anzeige",
    "/de/anzeige/kein-uuid",
    `/de/anzeige/${ID.toUpperCase()}`,
    `/de/anzeige/${ID}/mehr`,
    "/de/jagdpacht/bayern/muenchen/zu-viel",
    "/de/jagdpacht/Bayern",
    "/de/irgendwas",
    "/de/",
  ])("%s ist unbekannt (404)", (path) => {
    expect(parsePath(path).type).toBe("unknown");
  });

  it("lässt statische Seiten und Pfade ohne Sprache in Ruhe", () => {
    expect(parsePath("/de/account/listings")).toEqual({ type: "static", locale: "de" });
    expect(parsePath("/pl/admin")).toEqual({ type: "static", locale: "pl" });
    expect(parsePath("/fr/jagdpacht").type).toBe("other");
    expect(parsePath("/").type).toBe("other");
  });

  it("STATIC_SECTIONS entspricht den Ordnern unter app/[locale]", () => {
    const dirs = readdirSync(join(__dirname, "..", "..", "app", "[locale]"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("[") && !entry.name.startsWith("("))
      .map((entry) => entry.name)
      .sort();
    expect([...STATIC_SECTIONS].sort()).toEqual(dirs);
  });

  it("URL-Wörter kollidieren nicht mit Seiten, Sprachen, geschützten Bereichen oder einander", () => {
    const reserved = new Set<string>([...STATIC_SECTIONS, ...routing.locales, ...PROTECTED_SECTIONS]);
    for (const word of WORDS) {
      expect(word).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(reserved.has(word), word).toBe(false);
    }
    for (const locale of routing.locales) {
      const inLocale = [...Object.values(KIND_WORDS), ...Object.values(PAGE_WORDS)].map((w) => w[locale]);
      expect(new Set(inLocale).size).toBe(inLocale.length);
    }
  });
});

describe("Regions-Slugs aus den Referenzdaten", () => {
  it("findet Bundesland und Kreis", () => {
    expect(regionFromSlugs("bayern")?.code).toBe("DE-BY");
    expect(regionFromSlugs("bayern", "muenchen-stadt")).toMatchObject({ code: "DE-09162", country: "DE", level: "district" });
    expect(regionFromSlugs("tirol", "kitzbuehel")?.code).toBe("AT-704");
  });

  it("lehnt unbekannte und falsch zugeordnete Slugs ab", () => {
    expect(regionFromSlugs("atlantis")).toBeNull();
    expect(regionFromSlugs("bayern", "kitzbuehel")).toBeNull();
    expect(regionFromSlugs("constructor")).toBeNull();
    expect(regionFromSlugs("bayern", "constructor")).toBeNull();
  });

  it("jeder Code ist eindeutig und rückwärts auffindbar", () => {
    for (const ref of allRegionRefs()) expect(regionByCode(ref.code)).toEqual(ref);
  });
});
