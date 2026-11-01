import { describe, expect, it, vi } from "vitest";
import { robotsFor } from "./robots";

// json-ld liest NEXT_PUBLIC_SITE_URL über lib/env (beim Import geprüft); hier feste Testwerte.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SITE_URL ??= "https://example.test";
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "sb_publishable_test-placeholder";
});
const { breadcrumbList, jsonLdString } = await import("./json-ld");

describe("JSON-LD (ADR 015)", () => {
  it("maskiert alles, was einen Datenblock beenden könnte", () => {
    const title = `</script><script>alert(1)</script> & ${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}`;
    const out = jsonLdString({ name: title });
    for (const char of ["<", ">", "&", String.fromCharCode(0x2028), String.fromCharCode(0x2029)]) expect(out).not.toContain(char);
    expect(JSON.parse(out)).toEqual({ name: title });
  });

  it("BreadcrumbList mit absoluten URLs und Positionen", () => {
    const list = breadcrumbList([{ name: "Start", href: "/de" }, { name: "Jagdpacht", href: "/de/jagdpacht" }]);
    expect(list.itemListElement[1]).toMatchObject({ position: 2, name: "Jagdpacht" });
    expect(list.itemListElement[1].item).toMatch(/^https?:\/\/.+\/de\/jagdpacht$/);
  });
});

describe("robots.txt je Umgebung", () => {
  it("außer Prod: alles gesperrt, keine Sitemaps", () => {
    expect(robotsFor(false, "https://example.test")).toEqual({ rules: { userAgent: "*", disallow: "/" } });
  });

  it("Prod: erlaubt, nennt die Sitemaps aller Sprachen, sperrt /admin nicht ausdrücklich", () => {
    const robots = robotsFor(true, "https://example.test");
    expect(robots.sitemap).toEqual(["de", "en", "cs", "pl"].map((l) => `https://example.test/sitemap/${l}.xml`));
    expect(JSON.stringify(robots.rules)).not.toContain("admin");
  });
});
