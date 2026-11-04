import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { filtersError } from "./search/filters";
import { MAX_BBOX_SPAN, viewBbox } from "./map/bounds";

// QA M6 Nachprüfung (docs/QA-REPORT.md „M6 – Nachprüfung“): viewBbox an Welträndern und mit Weltkopien, Zod/DB-
// Gleichstand nach der Toleranz 1e-9, Texte der MapLibre-Steuerelemente, Audit-Aktion listing.point_removed im Admin.
// Bekannte Abweichungen als it.fails (N-Nummern).

const messages = (locale: string) => JSON.parse(readFileSync(join(__dirname, "..", "messages", `${locale}.json`), "utf8"));
const valid = (box: number[] | undefined) => box !== undefined && filtersError({ v: 1, bbox: box }) === null;

describe("viewBbox nach F2", () => {
  it("Weltränder: ganze Welt, Pole, Datumsgrenze innen bleiben gültige Filter ≤ 30°", () => {
    for (const view of [
      [-540, -85.0511, 540, 85.0511],
      [-180, -85.0511, 180, 85.0511],
      [150, 60, 179.99999, 85.0511],
      [-179.99999, -85.0511, -150, -60],
      [170, 40, 200, 60],
      [-200, 40, -170, 60],
      [5.866, 45.818, 17.16, 55.059],
    ] as const) {
      const box = viewBbox([...view]);
      expect(valid(box), view.join(",")).toBe(true);
      expect(box![2] - box![0]).toBeLessThanOrEqual(MAX_BBOX_SPAN + 1e-9);
      expect(box![3] - box![1]).toBeLessThanOrEqual(MAX_BBOX_SPAN + 1e-9);
    }
  });

  it("Zufällige Ausschnitte bis 400° Breite: immer gültig, enthält die Mitte des gekappten Bereichs", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 5000; i++) {
      const w = -180 + rnd() * 300;
      const width = 0.001 + rnd() * 120;
      const s = -85 + rnd() * 120;
      const n = Math.min(85.0511, s + 0.001 + rnd() * 80);
      const box = viewBbox([w, s, Math.min(w + width, 180), n]);
      expect(valid(box), [w, s, w + width, n].join(",")).toBe(true);
    }
  });

  // Ein Ausschnitt ganz in einer Weltkopie (w > 180°) ergäbe w > e und 400. MapLibre hält die Mitte in ±180°
  // (E2E „Datumsgrenze“), deshalb nicht erreichbar; hier nur dokumentiert.
  it("Ausschnitt ganz in der Weltkopie: dokumentiert, w > e", () => {
    const box = viewBbox([190, 40, 220, 60])!;
    expect(box[0]).toBeGreaterThan(box[2]);
  });
});

describe("Zod/DB-Gleichstand der 30°-Grenze", () => {
  it("Fixture-Fall 59.403…89.403 bleibt gültig, 30,0001° ungültig", () => {
    expect(filtersError({ v: 1, bbox: [59.403, -20.2805, 89.403, 9.7195] })).toBeNull();
    expect(filtersError({ v: 1, bbox: [0, 0, 30.0001, 10] })).toBe("bbox");
  });

  // N1: Die DB (numeric, exakt) lehnt 30,0000000005° ab (pgTAP 35), Zod lässt es wegen der Toleranz 1e-9 durch.
  it.fails("N1: Breite knapp über 30° (unter 30 + 1e-9) wie die DB abgelehnt", () => {
    expect(filtersError({ v: 1, bbox: [0, 0, 30.0000000005, 10] })).toBe("bbox");
  });
});

describe("F3: Texte der MapLibre-Steuerelemente", () => {
  const keys = ["zoomIn", "zoomOut", "resetBearing", "toggleAttribution", "mapFeedback", "mapTitle", "marker", "popupClose"];
  it("in vier Sprachen vorhanden, nicht leer, de/cs/pl nicht aus en übernommen", () => {
    const en = messages("en").Map.controls;
    for (const locale of ["en", "de", "cs", "pl"]) {
      const controls = messages(locale).Map.controls;
      expect(Object.keys(controls).sort()).toEqual([...keys].sort());
      for (const key of keys) {
        expect(controls[key].trim().length, `${locale}.${key}`).toBeGreaterThan(0);
        if (locale !== "en") expect(controls[key], `${locale}.${key}`).not.toBe(en[key]);
      }
    }
  });

  it("MapCanvas übergibt alle Schlüssel der verwendeten Steuerelemente", () => {
    const source = readFileSync(join(__dirname, "..", "components", "map", "MapCanvas.tsx"), "utf8");
    for (const key of ["NavigationControl.ZoomIn", "NavigationControl.ZoomOut", "NavigationControl.ResetBearing",
      "AttributionControl.ToggleAttribution", "AttributionControl.MapFeedback"]) {
      expect(source).toContain(`"${key}"`);
    }
  });
});

describe("F7: Audit-Aktion im Admin", () => {
  // N3: Der neue Audit-Eintrag listing.point_removed fehlt in AUDIT_ACTIONS (Filter im Admin) und hat keinen
  // übersetzten Namen; das Audit-Log zeigt den rohen Schlüssel.
  it.fails("N3: listing.point_removed ist im Admin filterbar und in vier Sprachen benannt", () => {
    const audit = readFileSync(join(__dirname, "services", "audit.ts"), "utf8");
    expect(audit).toContain('"listing.point_removed"');
    for (const locale of ["en", "de", "cs", "pl"]) {
      expect(JSON.stringify(messages(locale))).toContain('"listing_point_removed"');
    }
  });
});
