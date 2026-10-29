import { describe, expect, it } from "vitest";
import {
  ATTRIBUTE_FIELDS, ATTRIBUTE_KEYS, attributesFromForm, fieldMessageKey, nextStep, parseHectares, stepOfField,
} from "./listing-wizard";
import { LISTING_KINDS } from "./validation/listing";
import en from "../messages/en.json";

function form(entries: [string, string][]) {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

describe("Assistent", () => {
  it("jede Art hat genau die Formularfelder ihres Attribut-Schemas", () => {
    for (const kind of LISTING_KINDS) {
      expect(ATTRIBUTE_FIELDS[kind].map((f) => f.key).sort()).toEqual([...ATTRIBUTE_KEYS[kind]].sort());
    }
  });

  it("wandelt Formularfelder in Attribute um, leere Felder fallen weg", () => {
    const result = attributesFromForm("lease", form([
      ["attr.lease_type", "genossenschaft"],
      ["attr.revier_type", "wald"],
      ["attr.revier_type", "feld"],
      ["attr.lease_duration_years", "12"],
      ["attr.hunting_hut", "on"],
      ["attr.shooting_plan", "   "],
      ["attr.co_lessee_slots", ""],
    ]));
    expect(result).toEqual({
      attributes: { lease_type: "genossenschaft", revier_type: ["wald", "feld"], lease_duration_years: 12, hunting_hut: true },
      error: null,
    });
  });

  it("ja/nein, Aufgaben je Zeile, ungültige Werte mit Feldcode", () => {
    expect(attributesFromForm("permit", form([["attr.paid", "no"], ["attr.permit_scope", "begleitet"]])).attributes)
      .toEqual({ permit_scope: "begleitet", paid: false });
    expect(attributesFromForm("helper", form([["attr.tasks", "Ansitzbau\n\n Wildacker \nAnsitzbau"]])).attributes)
      .toEqual({ tasks: ["Ansitzbau", "Wildacker"] });
    expect(attributesFromForm("driven_hunt", form([["attr.spots_available", "0"]])).error).toBe("attributes.spots_available");
    expect(attributesFromForm("driven_hunt", form([["attr.spots_available", "drei"]])).error).toBe("attributes.spots_available");
    expect(attributesFromForm("lease", form([["attr.lease_type", "kauf"]])).error).toBe("attributes.lease_type");
    expect(attributesFromForm("trophy_hunt", form([["attr.legal_ack", "on"]])).attributes).toEqual({ legal_ack: true });
    expect(attributesFromForm("trophy_hunt", form([])).attributes).toEqual({});
  });

  it("Fläche in Hektar", () => {
    expect(parseHectares("")).toEqual({ ok: true, value: null });
    expect(parseHectares("12,5")).toEqual({ ok: true, value: 12.5 });
    expect(parseHectares("420")).toEqual({ ok: true, value: 420 });
    expect(parseHectares("0")).toEqual({ ok: false });
    expect(parseHectares("1,234")).toEqual({ ok: false });
    expect(parseHectares("-3")).toEqual({ ok: false });
  });

  it("Schritte und Feldcodes", () => {
    expect(nextStep("basics")).toBe("location");
    expect(nextStep("preview")).toBe("preview");
    expect(stepOfField("place.postal_code.required")).toBe("location");
    expect(stepOfField("species")).toBe("details");
    expect(stepOfField("description.length")).toBe("details");
    expect(fieldMessageKey("attributes.event_date.past")).toBe("attributes_event_date_past");
    expect(fieldMessageKey("attributes.season")).toBe("attributes_invalid");
    expect(fieldMessageKey("x")).toBe("form");
  });

  it("jeder Feldcode und jedes Attribut hat einen Text", () => {
    const fieldErrors = (en as { Listings: { fieldErrors: Record<string, string> } }).Listings.fieldErrors;
    const codes = ["description.length", "place.postal_code.required", "place.place_name.required", "place.postal_code.unknown",
      "place.postal_code.region_mismatch", "attributes.legal_ack", "attributes.event_date.past", "attributes.lease_type",
      "attributes.revier_type", "area_hectares", "attributes.permit_scope", "attributes.paid", "attributes.event_date",
      "attributes.spots_available", "attributes.tasks", "species", "photos.unprocessed", "attributes.unknown", "attributes.season", "x"];
    for (const code of codes) expect(fieldErrors[fieldMessageKey(code)], code).toBeTruthy();
    const attributes = (en as { Listings: { attributes: Record<string, unknown> } }).Listings.attributes;
    for (const kind of LISTING_KINDS) for (const field of ATTRIBUTE_FIELDS[kind]) expect(attributes[field.key], field.key).toBeTruthy();
  });
});
