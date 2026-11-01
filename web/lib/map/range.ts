// Byte-Bereich für die Kartendatei (ADR 016, Review A1). Rein, damit Vitest es prüft. Genau ein Bereich; Mehrfach-
// bereiche, unlesbare Angaben und Bereiche über 16 MB ergeben 416. Ohne Range-Header die ganze Datei.

export const MAX_RANGE_BYTES = 16 * 1024 * 1024;

export type RangeResult = { kind: "full" } | { kind: "partial"; start: number; end: number } | { kind: "unsatisfiable" };

export function parseRange(header: string | null, size: number): RangeResult {
  if (header === null) return { kind: "full" };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === "" && match[2] === "") || size === 0) return { kind: "unsatisfiable" };
  let start: number;
  let end: number;
  if (match[1] === "") {
    // Suffix: die letzten n Bytes
    const length = Number(match[2]);
    if (length === 0) return { kind: "unsatisfiable" };
    start = Math.max(0, size - length);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return { kind: "unsatisfiable" };
  if (end - start + 1 > MAX_RANGE_BYTES) return { kind: "unsatisfiable" };
  return { kind: "partial", start, end };
}
