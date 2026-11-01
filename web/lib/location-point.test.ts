import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pointFromForm } from "./location-point";

const form = (entries: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(entries)) data.set(k, v);
  return data;
};

describe("Punkt aus dem Formular (ADR 016, Review B3)", () => {
  it("Vorgabe ist keep, auch wenn lat/lng mitkommen", () => {
    expect(pointFromForm(form({}))).toEqual({ mode: "keep" });
    expect(pointFromForm(form({ lat: "50.9", lng: "13.9" }))).toEqual({ mode: "keep" });
  });

  it("set nur mit gültigen Zahlen, clear ohne Werte", () => {
    expect(pointFromForm(form({ point: "set", lat: "50.95", lng: "13.95" }))).toEqual({ mode: "set", lat: 50.95, lng: 13.95 });
    expect(pointFromForm(form({ point: "clear" }))).toEqual({ mode: "clear" });
  });

  it.each<Record<string, string>>([
    { point: "set" },
    { point: "set", lat: "91", lng: "13" },
    { point: "set", lat: "50", lng: "181" },
    { point: "set", lat: "NaN", lng: "13" },
    { point: "set", lat: "Infinity", lng: "13" },
    { point: "set", lat: "50", lng: "" },
    { point: "move" },
  ])("ungültig: %j", (entries) => {
    expect(pointFromForm(form(entries))).toBeNull();
  });
});

describe("Keine Koordinaten in Logs oder URLs (ADR 016, A7)", () => {
  const action = readFileSync(join(__dirname, "..", "app", "[locale]", "account", "listings", "[id]", "edit", "actions.ts"), "utf8");
  const parser = readFileSync(join(__dirname, "location-point.ts"), "utf8");

  it("Action und Parser schreiben nichts in die Konsole", () => {
    expect(action).not.toMatch(/console\./);
    expect(parser).not.toMatch(/console\./);
  });

  it("Fehler gehen als Feldcode zurück, lat/lng nie in eine URL", () => {
    expect(action).toContain('back(["place.point.invalid"])');
    expect(action).not.toMatch(/(lat|lng)[^\n]*redirect|redirect[^\n]*(lat|lng)/);
  });
});
