import { describe, expect, it } from "vitest";
import { pickMessages } from "./pick";

const messages = { A: { x: "1", y: { z: "2" } }, B: { w: "3" }, C: "4" };

describe("pickMessages", () => {
  it("wählt ganze Namensräume und Unterbäume", () => {
    expect(pickMessages(messages, ["B", "A.y"])).toEqual({ B: { w: "3" }, A: { y: { z: "2" } } });
  });

  it("führt Pfade mit gleichem Anfang zusammen", () => {
    expect(pickMessages(messages, ["A.x", "A.y"])).toEqual({ A: { x: "1", y: { z: "2" } } });
  });

  it("leere Liste gibt nichts weiter", () => {
    expect(pickMessages(messages, [])).toEqual({});
  });

  it("wirft bei unbekanntem Pfad", () => {
    expect(() => pickMessages(messages, ["A.q"])).toThrow("Unbekannter Namensraum: A.q");
    expect(() => pickMessages(messages, ["C.x"])).toThrow("Unbekannter Namensraum: C.x");
  });
});
