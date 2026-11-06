import { describe, expect, it } from "vitest";
import type { Filters } from "@/lib/search/filters";
import { formatPrice } from "@/lib/validation/price";
import {
  clipName,
  describeFilters,
  extendWindow,
  filtersForSaving,
  nameSchema,
  resultsHref,
  searchStatus,
  storedFilters,
  suggestName,
  type FilterTexts,
} from "./rules";

const texts: FilterTexts = {
  kind: (k) => `kind:${k}`,
  direction: (d) => `dir:${d}`,
  country: (c) => `country:${c}`,
  unit: (u) => `unit:${u}`,
  regionName: (code) => (code === "DE-BY" ? "Bayern" : undefined),
  speciesName: (code) => (code === "red_deer" ? "Rotwild" : undefined),
  quoted: (text) => `„${text}“`,
  labels: { q: "Suchbegriff", species: "Wildarten", price: "Preis", area: "Fläche", period: "Zeitraum", from: "von", to: "bis" },
  verifiedOnly: "nur verifiziert",
  mapArea: "Kartenausschnitt",
  allListings: "Alle Anzeigen",
};

const DAY = 86_400_000;
const now = new Date("2026-11-06T12:00:00Z");
const at = (days: number) => new Date(now.getTime() + days * DAY).toISOString();

describe("Name-Vorschlag", () => {
  it("aus Art, Richtung, Region und Suchbegriff", () => {
    const f: Filters = { v: 1, kind: "lease", direction: "offer", country: "DE", region: "DE-BY", q: "Rehbock" };
    expect(suggestName(f, texts)).toBe("kind:lease · dir:offer · Bayern · „Rehbock“");
  });
  it("Land, wenn keine Region gewählt ist", () => {
    expect(suggestName({ v: 1, country: "AT" }, texts)).toBe("country:AT");
  });
  it("ohne Merkmale: Kartenausschnitt oder alle Anzeigen", () => {
    expect(suggestName({ v: 1, bbox: [10, 47, 11, 48] }, texts)).toBe("Kartenausschnitt");
    expect(suggestName({ v: 1, verified_only: true }, texts)).toBe("Alle Anzeigen");
  });
  it("höchstens 100 Zeichen, ohne Ersatzpaare zu zerteilen", () => {
    const name = suggestName({ v: 1, q: "🦌".repeat(150) }, texts);
    expect([...name].length).toBe(100);
    expect(name.endsWith("…")).toBe(true);
    expect(name).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(nameSchema.safeParse(name).success).toBe(true);
  });
  it("clipName lässt kurze Namen unverändert und trimmt", () => {
    expect(clipName("  Suche  ")).toBe("Suche");
  });
});

describe("Name prüfen wie die DB", () => {
  it.each([
    ["", false],
    ["   ", false],
    ["a", true],
    ["x".repeat(100), true],
    ["x".repeat(101), false],
    ["🦌".repeat(100), true],
  ])("%j → %s", (value, ok) => {
    expect(nameSchema.safeParse(value).success).toBe(ok);
  });
  it("speichert getrimmt", () => {
    expect(nameSchema.parse("  Rehwild  ")).toBe("Rehwild");
  });
});

describe("Kurzbeschreibung", () => {
  it("nennt alle Filter mit den Labels der Suche, Preise per Intl in Originalwährung", () => {
    const f: Filters = {
      v: 1,
      kind: "permit",
      direction: "wanted",
      country: "DE",
      region: "DE-BY",
      q: "Hirsch",
      species: ["red_deer", "unknown_code"],
      currency: "EUR",
      price_min: 100_000,
      price_max: 500_000,
      price_unit: "per_year",
      area_min: 1500,
      date_from: "2027-05-01",
      date_to: "2027-07-31",
      verified_only: true,
      bbox: [10, 47, 11, 48],
    };
    const day = (d: string) => new Intl.DateTimeFormat("de", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
    expect(describeFilters(f, "de", texts)).toEqual([
      "kind:permit",
      "dir:wanted",
      "Bayern",
      "Suchbegriff: „Hirsch“",
      "Wildarten: Rotwild, unknown_code",
      `Preis: von ${formatPrice(100_000, "EUR", "de")} bis ${formatPrice(500_000, "EUR", "de")} unit:per_year`,
      `Fläche: von ${new Intl.NumberFormat("de").format(1500)}`,
      `Zeitraum: von ${day("2027-05-01")} bis ${day("2027-07-31")}`,
      "nur verifiziert",
      "Kartenausschnitt",
    ]);
    expect(formatPrice(100_000, "EUR", "de")).toMatch(/^1\.000\s€$/);
  });
  it("Land nur ohne Region; leere Filter ergeben keine Teile", () => {
    expect(describeFilters({ v: 1, country: "CZ" }, "cs", texts)).toEqual(["country:CZ"]);
    expect(describeFilters({ v: 1 }, "de", texts)).toEqual([]);
  });
  it("Währung ohne Betrag und Einheit ohne Währung", () => {
    expect(describeFilters({ v: 1, currency: "CHF" }, "de", texts)).toEqual(["Preis: CHF"]);
    expect(describeFilters({ v: 1, price_unit: "per_day" }, "de", texts)).toEqual(["Preis: unit:per_day"]);
  });
});

describe("Filter beim Speichern", () => {
  it("entfernt sort und prüft wie filtersError", () => {
    const result = filtersForSaving(JSON.stringify({ v: 1, kind: "lease", sort: "newest" }));
    expect(result).toEqual({ ok: true, filters: { v: 1, kind: "lease" } });
  });
  it("liefert den Schlüssel des ersten Fehlers", () => {
    expect(filtersForSaving(JSON.stringify({ v: 1, kind: "weapons" }))).toEqual({ ok: false, key: "kind" });
    expect(filtersForSaving(JSON.stringify({ v: 1, q: "x".repeat(201) }))).toEqual({ ok: false, key: "q" });
    expect(filtersForSaving(JSON.stringify({ v: 1, price_min: 100 }))).toEqual({ ok: false, key: "currency" });
    expect(filtersForSaving(JSON.stringify({ v: 1, evil: true }))).toEqual({ ok: false, key: "evil" });
  });
  it("lehnt kein JSON, Arrays, fehlendes Feld und zu große Werte ab", () => {
    for (const raw of [null, "", "nope", "[]", "1", JSON.stringify({ v: 1, q: "x".repeat(5000) })]) {
      expect(filtersForSaving(raw).ok, String(raw).slice(0, 20)).toBe(false);
    }
  });
  it("storedFilters gibt nur gültige Filter zurück", () => {
    expect(storedFilters({ v: 1, kind: "lease" })).toEqual({ v: 1, kind: "lease" });
    expect(storedFilters({ v: 2 })).toBeNull();
    expect(storedFilters("x")).toBeNull();
  });
});

describe("Ergebnisse ansehen", () => {
  it("Suche mit denselben Parametern", () => {
    expect(resultsHref({ v: 1, kind: "lease", currency: "EUR", price_max: 500_000 }, "de")).toBe("/de/suche?kind=lease&cur=EUR&pmax=5000");
    expect(resultsHref({ v: 1 }, "pl")).toBe("/pl/szukaj");
  });
  it("mit Kartenausschnitt die Kartenansicht (H1)", () => {
    expect(resultsHref({ v: 1, bbox: [10, 47, 11.5, 48] }, "en")).toBe("/en/search?bbox=10%2C47%2C11.5%2C48&view=map");
  });
});

describe("Status und Verlängern (H4)", () => {
  it("aktiv außerhalb des Fensters", () => {
    expect(searchStatus({ paused_at: null, expires_at: at(30) }, now)).toEqual({ state: "active", expiresAt: new Date(at(30)) });
  });
  it("läuft ab in den letzten 14 Tagen", () => {
    expect(searchStatus({ paused_at: null, expires_at: at(14) }, now).state).toBe("expiring");
    expect(searchStatus({ paused_at: null, expires_at: at(14.001) }, now).state).toBe("active");
  });
  it("pausiert behält das Ablaufdatum", () => {
    expect(searchStatus({ paused_at: at(-1), expires_at: at(20) }, now)).toEqual({ state: "paused", expiresAt: new Date(at(20)) });
  });
  it("abgelaufen geht vor pausiert, Löschung 30 Tage danach", () => {
    expect(searchStatus({ paused_at: at(-10), expires_at: at(-2) }, now)).toEqual({
      state: "expired",
      expiresAt: new Date(at(-2)),
      deleteAt: new Date(at(28)),
    });
    expect(searchStatus({ paused_at: null, expires_at: now.toISOString() }, now).state).toBe("expired");
  });
  it("Fenster: ab 14 Tagen vor dem Ablauf und danach offen, sonst Datum", () => {
    expect(extendWindow(at(42), now)).toEqual({ open: false, from: new Date(at(28)) });
    expect(extendWindow(at(14), now)).toEqual({ open: true });
    expect(extendWindow(at(-5), now)).toEqual({ open: true });
  });
});
