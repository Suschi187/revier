import { describe, expect, it } from "vitest";
import { boundsAround } from "./bounds";

describe("Startausschnitt (ADR 016)", () => {
  it("Quadrat mit Rand um den Mittelpunkt", () => {
    const [w, s, e, n] = boundsAround(11.5, 48.1, 311.4);
    expect(w).toBeLessThan(11.5);
    expect(e).toBeGreaterThan(11.5);
    expect(n - s).toBeCloseTo((Math.sqrt(311.4) * 1.3) / 111.32, 3);
    expect(e - w).toBeGreaterThan(n - s);
  });
});
