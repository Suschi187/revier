import { describe, expect, it } from "vitest";
import { formatPrice, minorToInput, parsePrice } from "./price";

describe("parsePrice", () => {
  it.each([
    ["1500", 150000],
    ["1.500", 150000],
    ["1,500", 150000],
    ["1 500", 150000],
    ["1'500", 150000],
    ["1 500,50", 150050],
    ["1.234,5", 123450],
    ["1,234.56", 123456],
    ["12,5", 1250],
    ["12.50", 1250],
    ["0,99", 99],
    [",5", 50],
    ["1.234.567", 123456700],
    ["  250  ", 25000],
  ])("%s → %i Minor-Einheiten", (input, minor) => {
    expect(parsePrice(input, "EUR")).toEqual({ ok: true, minor });
  });

  it.each([
    ["", "required"],
    ["   ", "required"],
    ["-5", "negative"],
    ["abc", "invalid"],
    ["1e5", "invalid"],
    ["12,345,6", "invalid"],
    ["1.23.4", "invalid"],
    ["1,2,3", "invalid"],
    ["12,345.6.7", "invalid"],
    ["1,234", "ok"],
    ["1,2345", "tooManyDecimals"],
    ["12,999", "ok"],
    ["0", "zero"],
    ["0,00", "zero"],
    ["10,123", "ok"],
  ])("%s → %s", (input, error) => {
    const result = parsePrice(input, "EUR");
    if (error === "ok") expect(result.ok).toBe(true);
    else expect(result).toEqual({ ok: false, error });
  });

  it("mehr als zwei Nachkommastellen", () => {
    expect(parsePrice("1,234.567", "EUR")).toEqual({ ok: false, error: "tooManyDecimals" });
    expect(parsePrice("1.5,678", "EUR")).toEqual({ ok: false, error: "invalid" });
  });

  it("Grenzen je Währung wie in der DB (price_bounds)", () => {
    expect(parsePrice("10.000.000", "EUR")).toEqual({ ok: true, minor: 1_000_000_000 });
    expect(parsePrice("10.000.000,01", "EUR")).toEqual({ ok: false, error: "tooLarge" });
    expect(parsePrice("10.000.001", "CHF")).toEqual({ ok: false, error: "tooLarge" });
    expect(parsePrice("250.000.000", "CZK")).toEqual({ ok: true, minor: 25_000_000_000 });
    expect(parsePrice("250.000.001", "CZK")).toEqual({ ok: false, error: "tooLarge" });
    expect(parsePrice("50.000.000", "PLN")).toEqual({ ok: true, minor: 5_000_000_000 });
    expect(parsePrice("50.000.001", "PLN")).toEqual({ ok: false, error: "tooLarge" });
    expect(parsePrice("9".repeat(30), "EUR")).toEqual({ ok: false, error: "tooLarge" });
  });

  it("ergibt immer ganze Zahlen", () => {
    for (const input of ["0,1", "0,01", "19,99", "1.234,07"]) {
      const result = parsePrice(input, "EUR");
      expect(result.ok && Number.isInteger(result.minor)).toBe(true);
    }
    expect(parsePrice("0,07", "EUR")).toEqual({ ok: true, minor: 7 });
  });
});

describe("minorToInput und formatPrice", () => {
  it("Rundweg Eingabe → Minor → Eingabe", () => {
    expect(minorToInput(150050, ",")).toBe("1500,50");
    expect(minorToInput(150000, ",")).toBe("1500");
    expect(minorToInput(7, ".")).toBe("0.07");
    for (const minor of [1, 99, 100, 123456, 1_000_000_000]) {
      expect(parsePrice(minorToInput(minor, ","), "EUR")).toEqual({ ok: true, minor });
    }
  });

  it("formatiert nach Sprache", () => {
    expect(formatPrice(150050, "EUR", "de")).toBe("1.500,50 €");
    expect(formatPrice(150000, "EUR", "en")).toBe("€1,500");
    expect(formatPrice(2_500_000, "CZK", "cs")).toMatch(/25\s000\sKč/);
  });
});
