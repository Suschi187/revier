import { describe, expect, it } from "vitest";
import { acceptedType, errorFromFunction, isHeic, targetSize } from "./photo-upload";

describe("Fotos im Browser vorbereiten", () => {
  it("erkennt HEIC am Typ, an der Endung und an der ftyp-Box", async () => {
    expect(await isHeic(new File([new Uint8Array(12)], "IMG_1.HEIC"))).toBe(true);
    expect(await isHeic(new File([new Uint8Array(12)], "x", { type: "image/heif" }))).toBe(true);
    const box = new Uint8Array([0, 0, 0, 24, ...new TextEncoder().encode("ftypheic")]);
    expect(await isHeic(new File([box], "foto.jpg", { type: "image/jpeg" }))).toBe(true);
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
    expect(await isHeic(new File([jpeg], "foto.jpg", { type: "image/jpeg" }))).toBe(false);
  });

  it("nimmt nur JPEG, PNG und WebP an", () => {
    expect(acceptedType("image/jpeg")).toBe(true);
    expect(acceptedType("image/PNG")).toBe(true);
    expect(acceptedType("image/webp")).toBe(true);
    expect(acceptedType("image/gif")).toBe(false);
    expect(acceptedType("image/svg+xml")).toBe(false);
    expect(acceptedType("")).toBe(false);
  });

  it("verkleinert auf höchstens 2560 px an der langen Seite", () => {
    expect(targetSize(4032, 3024)).toEqual({ width: 2560, height: 1920 });
    expect(targetSize(3024, 4032)).toEqual({ width: 1920, height: 2560 });
    expect(targetSize(1200, 800)).toEqual({ width: 1200, height: 800 });
    expect(targetSize(10000, 10)).toEqual({ width: 2560, height: 3 });
  });

  it("übersetzt Antworten der Function (Auflage 1: Plattformabbruch = neu hochladen)", () => {
    expect(errorFromFunction(422, "corrupt")).toBe("corrupt");
    expect(errorFromFunction(422, "unsupported")).toBe("unsupported");
    expect(errorFromFunction(413, undefined)).toBe("tooLarge");
    expect(errorFromFunction(429, "attempts_exhausted")).toBe("attempts");
    for (const status of [500, 502, 504, 546]) expect(errorFromFunction(status, undefined)).toBe("failed");
  });
});
