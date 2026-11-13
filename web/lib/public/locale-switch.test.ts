import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/locale/route";
import { switchLocaleHref } from "./locale-switch";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("Ziel des Sprachwechsels (ADR 015)", () => {
  it("übersetzt öffentliche Pfade und behält Filter", () => {
    expect(switchLocaleHref("/de/jagdpacht/bayern", "?cur=EUR", "pl")).toBe("/pl/dzierzawa-obwodu/bayern?cur=EUR");
    expect(switchLocaleHref("/de/jagdpacht/bayern", "cur=EUR", "cs")).toBe("/cs/pronajem-honitby/bayern?cur=EUR");
  });

  it("verwirft die Query auf Seiten ohne Filter und überlange Queries", () => {
    expect(switchLocaleHref(`/de/anzeige/${ID}`, "?x=1", "en")).toBe(`/en/listing/${ID}`);
    expect(switchLocaleHref("/de/jagdpacht", `?q=${"a".repeat(1001)}`, "en")).toBe(switchLocaleHref("/de/jagdpacht", "", "en"));
  });

  it("tauscht auf anderen Seiten nur das Präfix, ohne Query", () => {
    expect(switchLocaleHref("/de/account/messages", "?a=1", "pl")).toBe("/pl/account/messages");
  });

  it("führt unbekannte, fremde oder ungültige Pfade zur Startseite", () => {
    expect(switchLocaleHref("/de/gibt-es-nicht/x/y/z", "", "en")).toBe("/en");
    expect(switchLocaleHref("/foo", "", "en")).toBe("/en");
    expect(switchLocaleHref("//evil.example/de", "", "en")).toBe("/en");
    expect(switchLocaleHref("/de/%E0%A4%A", "", "en")).toBe("/en");
  });
});

describe("GET /api/locale", () => {
  async function go(to: string, referer?: string) {
    const response = GET(new Request(`http://localhost:3000/api/locale?to=${to}`, { headers: referer ? { referer } : {} }));
    return { status: response.status, location: response.headers.get("location"), cache: response.headers.get("cache-control"), robots: response.headers.get("x-robots-tag") };
  }

  it("leitet mit 303 auf die passende Seite aus dem Referer", async () => {
    expect(await go("pl", "http://localhost:3000/de/jagdpacht/bayern?cur=EUR")).toEqual({
      status: 303,
      location: "/pl/dzierzawa-obwodu/bayern?cur=EUR",
      cache: "private, no-store",
      robots: "noindex",
    });
  });

  it("nimmt von fremden Referern nur den Pfad, nie den Host", async () => {
    expect((await go("en", "https://evil.example/de/jagdpacht")).location).toBe("/en/hunting-lease");
  });

  it("ohne oder mit ungültigem Referer zur Startseite, unbekannte Sprache wird de", async () => {
    expect((await go("cs")).location).toBe("/cs");
    expect((await go("cs", "kein url")).location).toBe("/cs");
    expect((await go("xx", "http://localhost:3000/en")).location).toBe("/de");
  });
});
