import { describe, expect, it } from "vitest";
import type { FilterTexts } from "@/lib/saved-searches/rules";
import { formatPrice } from "@/lib/validation/price";
import { filterChips } from "./chips";
import { filtersFromParams } from "./filters";

const texts: FilterTexts = {
  kind: (k) => `kind:${k}`,
  direction: (d) => `dir:${d}`,
  country: (c) => `country:${c}`,
  unit: (u) => `unit:${u}`,
  regionName: (code) => (code === "DE-BY" ? "Bayern" : undefined),
  speciesName: (code) => ({ red_deer: "Rotwild", roe_deer: "Rehwild" })[code],
  quoted: (text) => `„${text}“`,
  labels: { q: "Suchbegriff", species: "Wildarten", price: "Preis", area: "Fläche", period: "Zeitraum", from: "von", to: "bis" },
  verifiedOnly: "nur verifiziert",
  mapArea: "Kartenausschnitt",
  allListings: "Alle Anzeigen",
};

const PATH = "/de/suche";
const chipsFor = (query: string, fixed: Parameters<typeof filtersFromParams>[1] = {}, keep: Record<string, string> = {}) =>
  filterChips(filtersFromParams(new URLSearchParams(query), fixed), Object.keys(fixed) as never, "de", texts, PATH, keep);
const query = (href: string) => Object.fromEntries(new URL(href, "http://x").searchParams);

describe("Filterleiste", () => {
  it("ohne Filter keine Chips, Angebot/Gesuch und Sortierung zählen nicht", () => {
    const { chips, clearAll } = chipsFor("dir=offer&sort=newest");
    expect(chips).toEqual([]);
    expect(clearAll).toBe(`${PATH}?dir=offer&sort=newest`);
  });

  it("Chips in der Reihenfolge des Formulars, jeder Link ohne genau diesen Filter", () => {
    const { chips } = chipsFor("q=Bock&kind=lease&region=DE-BY&species=red_deer,roe_deer&verified=1&dir=offer");
    expect(chips.map((c) => c.label)).toEqual(["kind:lease", "Bayern", "Suchbegriff: „Bock“", "Rotwild", "Rehwild", "nur verifiziert"]);
    const byKey = Object.fromEntries(chips.map((c) => [c.key, query(c.href)]));
    expect(byKey.kind).toEqual({ q: "Bock", region: "DE-BY", dir: "offer", species: "red_deer,roe_deer", verified: "1" });
    expect(byKey["species:red_deer"].species).toBe("roe_deer");
    expect(byKey.verified.verified).toBeUndefined();
  });

  it("letzte Wildart entfernt den Parameter ganz", () => {
    const { chips } = chipsFor("species=red_deer");
    expect(chips[0].href).toBe(PATH);
  });

  it("Land nur ohne Region; Region entfernen lässt das Land stehen", () => {
    expect(chipsFor("country=AT").chips.map((c) => c.label)).toEqual(["country:AT"]);
    const { chips } = chipsFor("country=DE&region=DE-BY");
    expect(chips.map((c) => c.key)).toEqual(["region"]);
    expect(query(chips[0].href)).toEqual({ country: "DE" });
  });

  it("Preis als Gruppe; die Preis-Sortierung fällt mit weg", () => {
    const { chips } = chipsFor("cur=EUR&pmin=100&pmax=500&unit=per_year&sort=price_asc&q=Bock");
    const price = chips.find((c) => c.key === "price")!;
    expect(price.label).toBe(`Preis: von ${formatPrice(10_000, "EUR", "de")} bis ${formatPrice(50_000, "EUR", "de")} unit:per_year`);
    expect(query(price.href)).toEqual({ q: "Bock" });
  });

  it("Suchbegriff entfernen nimmt die Sortierung nach Relevanz mit", () => {
    const { chips } = chipsFor("q=Bock&sort=relevance");
    expect(query(chips[0].href)).toEqual({});
  });

  it("Fläche und Zeitraum als Gruppe", () => {
    const { chips } = chipsFor("amin=100&from=2026-10-01&to=2026-12-31");
    expect(chips.map((c) => c.label)).toEqual(["Fläche: von 100", "Zeitraum: von 01.10.2026 bis 31.12.2026"]);
    expect(chips.map((c) => c.href)).toEqual([`${PATH}?from=2026-10-01&to=2026-12-31`, `${PATH}?amin=100`]);
  });

  it("Werte aus dem Pfad bekommen keinen Chip und stehen nicht im Link", () => {
    const { chips, clearAll } = chipsFor("kind=permit&q=Bock", { kind: "lease", region: "DE-BY", country: "DE" });
    expect(chips.map((c) => c.key)).toEqual(["q"]);
    expect(chips[0].href).toBe(PATH);
    expect(clearAll).toBe(PATH);
  });

  it("Kartenausschnitt als Chip, Ansicht bleibt erhalten", () => {
    const { chips, clearAll } = chipsFor("bbox=10,47,11,48&verified=1", {}, { view: "map" });
    expect(chips.map((c) => c.label)).toEqual(["nur verifiziert", "Kartenausschnitt"]);
    expect(query(chips[1].href)).toEqual({ verified: "1", view: "map" });
    expect(clearAll).toBe(`${PATH}?view=map`);
  });
});
