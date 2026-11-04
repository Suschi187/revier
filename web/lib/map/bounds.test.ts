import { describe, expect, it } from "vitest";
import { boundsAround, viewBbox } from "./bounds";
import { canonicalBbox, filtersError } from "@/lib/search/filters";

describe("Startausschnitt (ADR 016)", () => {
  it("Quadrat mit Rand um den Mittelpunkt", () => {
    const [w, s, e, n] = boundsAround(11.5, 48.1, 311.4);
    expect(w).toBeLessThan(11.5);
    expect(e).toBeGreaterThan(11.5);
    expect(n - s).toBeCloseTo((Math.sqrt(311.4) * 1.3) / 111.32, 3);
    expect(e - w).toBeGreaterThan(n - s);
  });
});

describe("Filterbereich aus dem Ausschnitt (QA M6 F2)", () => {
  it("kleiner Ausschnitt: nur kanonisch nach außen gerundet", () => {
    expect(viewBbox([13.12345, 50.98761, 14.00001, 51.5])).toEqual(canonicalBbox([13.12345, 50.98761, 14.00001, 51.5]));
  });

  it("über die Welt hinaus: begrenzt", () => {
    const [w, s, e, n] = viewBbox([-200, -95, -170, -70])!;
    expect([w, s]).toEqual([-180, -90]);
    expect(e).toBe(-170);
    expect(n).toBe(-70);
  });

  it("beliebige große Ausschnitte bleiben gültig, höchstens 30° und innerhalb des Ausschnitts", () => {
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 2000; i++) {
      const w = -180 + random() * 300;
      const s = -90 + random() * 120;
      const view: [number, number, number, number] = [w, s, w + 1 + random() * 80, s + 1 + random() * 60];
      const box = viewBbox(view)!;
      expect(filtersError({ v: 1, bbox: box }), view.join(",")).toBeNull();
      expect(box[2] - box[0]).toBeLessThanOrEqual(30 + 1e-9);
      expect(box[3] - box[1]).toBeLessThanOrEqual(30 + 1e-9);
      expect(box[0]).toBeGreaterThanOrEqual(Math.max(view[0], -180) - 1e-4);
      expect(box[2]).toBeLessThanOrEqual(Math.min(view[2], 180) + 1e-4);
      expect(canonicalBbox(box)).toEqual(box);
    }
  });
});
