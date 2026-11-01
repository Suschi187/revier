import { describe, expect, it } from "vitest";
import { MAX_RANGE_BYTES, parseRange } from "./range";

describe("Byte-Bereiche der Kartendatei (ADR 016, A1)", () => {
  it("ein Bereich, offen am Ende, Suffix", () => {
    expect(parseRange("bytes=0-99", 1000)).toEqual({ kind: "partial", start: 0, end: 99 });
    expect(parseRange("bytes=900-", 1000)).toEqual({ kind: "partial", start: 900, end: 999 });
    expect(parseRange("bytes=-100", 1000)).toEqual({ kind: "partial", start: 900, end: 999 });
    expect(parseRange("bytes=990-2000", 1000)).toEqual({ kind: "partial", start: 990, end: 999 });
  });

  it("ohne Header die ganze Datei", () => {
    expect(parseRange(null, 1000)).toEqual({ kind: "full" });
  });

  it.each(["bytes=0-1,5-9", "bytes=-", "bytes=1000-", "bytes=50-10", "items=0-1", "bytes=-0", "bytes=a-b", `bytes=0-${MAX_RANGE_BYTES}`])(
    "%s ergibt 416",
    (header) => {
      expect(parseRange(header, MAX_RANGE_BYTES * 2)).toEqual({ kind: "unsatisfiable" });
    },
  );
});
