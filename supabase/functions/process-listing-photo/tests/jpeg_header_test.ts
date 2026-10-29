import { deepStrictEqual, strictEqual } from "./assert.ts";
import { exifOrientation, isCleanJpeg, type Limits, parseJpeg } from "../jpeg_header.ts";
import {
  concat, encode, ENTROPY, EOI, exifSegment, minimal, quadrants, segment, SOI, sof, sos, structure, withMetadata,
} from "./fixtures.ts";

const LIMITS: Limits = { maxSide: 4096, maxPixels: 8_000_000, maxProgressivePixels: 5_000_000, maxScans: 16 };
const errorOf = (bytes: Uint8Array) => {
  const result = parseJpeg(bytes, LIMITS);
  return result.ok ? "ok" : result.error;
};

Deno.test("gültige Strukturen: Baseline, erweitert, progressiv, Graustufen", () => {
  deepStrictEqual(parseJpeg(minimal(), LIMITS), {
    ok: true, header: { width: 16, height: 16, components: 3, progressive: false, orientation: 1 },
  });
  strictEqual(errorOf(minimal({ marker: 0xc1 })), "ok");
  const progressive = parseJpeg(structure(sof({ marker: 0xc2 }), sos(), ENTROPY, sos(1), ENTROPY, sos(1), ENTROPY), LIMITS);
  strictEqual(progressive.ok && progressive.header.progressive, true);
  strictEqual(errorOf(minimal({ components: 1 })), "ok");
});

Deno.test("echtes JPEG des Encoders mit Metadaten und Anhang wird gelesen", () => {
  const result = parseJpeg(withMetadata(encode(quadrants(40, 30)), 6), LIMITS);
  deepStrictEqual(result, { ok: true, header: { width: 40, height: 30, components: 3, progressive: false, orientation: 6 } });
});

Deno.test("fremde Formate und leere Datei: unsupported", () => {
  const heic = concat(new Uint8Array([0, 0, 0, 0x18]), new TextEncoder().encode("ftypheic"), new Uint8Array(16));
  const webp = concat(new TextEncoder().encode("RIFF"), new Uint8Array(4), new TextEncoder().encode("WEBPVP8 "));
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  const gif = new TextEncoder().encode("GIF89a\x01\x00\x01\x00");
  for (const bytes of [heic, webp, png, gif, new Uint8Array(0), new Uint8Array([0xff, 0xd8])]) {
    strictEqual(errorOf(bytes), "unsupported");
  }
});

Deno.test("nicht unterstützte Frames: SOF3, SOF9, 12 Bit, 4 Komponenten, zwei SOF, DNL", () => {
  strictEqual(errorOf(minimal({ marker: 0xc3 })), "unsupported");
  strictEqual(errorOf(minimal({ marker: 0xc9 })), "unsupported");
  strictEqual(errorOf(minimal({ precision: 12 })), "unsupported");
  strictEqual(errorOf(minimal({ components: 4 })), "unsupported");
  strictEqual(errorOf(structure(sof(), sof(), sos(), ENTROPY)), "unsupported");
  strictEqual(errorOf(minimal({ height: 0 })), "unsupported");
  strictEqual(errorOf(structure(sof(), sos(), ENTROPY, segment(0xdc, new Uint8Array([0, 16])))), "unsupported");
});

Deno.test("zu viele Scans: unsupported (Schutz vor teuren progressiven Dateien)", () => {
  const scans = Array.from({ length: 17 }, () => concat(sos(1), ENTROPY));
  strictEqual(errorOf(structure(sof({ marker: 0xc2 }), ...scans)), "unsupported");
  strictEqual(errorOf(structure(sof({ marker: 0xc2 }), ...scans.slice(0, 16))), "ok");
  const hundred = Array.from({ length: 100 }, () => concat(sos(1), ENTROPY));
  strictEqual(errorOf(structure(sof({ marker: 0xc2 }), ...hundred)), "unsupported");
});

Deno.test("Größengrenzen: Seite 4096, Pixel 8 MP, progressiv 5 MP", () => {
  strictEqual(errorOf(minimal({ marker: 0xc2, width: 2560, height: 1953 })), "ok");
  strictEqual(errorOf(minimal({ marker: 0xc2, width: 2560, height: 1954 })), "too_large");
  strictEqual(errorOf(minimal({ marker: 0xc0, width: 2560, height: 1954 })), "ok");
  strictEqual(errorOf(minimal({ width: 4096, height: 1953 })), "ok");
  strictEqual(errorOf(minimal({ width: 4097, height: 10 })), "too_large");
  strictEqual(errorOf(minimal({ width: 10, height: 4097 })), "too_large");
  strictEqual(errorOf(minimal({ width: 4000, height: 2025 })), "too_large"); // 8,1 MP
  strictEqual(errorOf(minimal({ marker: 0xc2, width: 50000, height: 50000 })), "too_large");
});

Deno.test("kaputte Dateien: corrupt, nie eine Ausnahme", () => {
  const good = minimal();
  strictEqual(errorOf(good.subarray(0, good.length - 2)), "corrupt"); // ohne EOI
  strictEqual(errorOf(good.subarray(0, 10)), "corrupt"); // mitten im SOF abgeschnitten
  strictEqual(errorOf(concat(SOI, new Uint8Array([0xff, 0xe0, 0x00, 0x00]), EOI)), "corrupt"); // Länge 0
  strictEqual(errorOf(concat(SOI, new Uint8Array([0xff, 0xe0, 0x00, 0x01]), EOI)), "corrupt"); // Länge 1
  strictEqual(errorOf(concat(SOI, new Uint8Array([0xff, 0xe0, 0x40, 0x00, 1, 2]), EOI)), "corrupt"); // über das Ende
  strictEqual(errorOf(structure(sos(), ENTROPY)), "corrupt"); // Scan ohne Frame
  strictEqual(errorOf(structure(sof())), "corrupt"); // Frame ohne Scan
  strictEqual(errorOf(concat(SOI, new Uint8Array([0xff, 0xff]), sof(), sos(), ENTROPY, EOI)), "corrupt"); // Füllbyte
  strictEqual(errorOf(concat(SOI, sof(), new Uint8Array([0x00]), sos(), ENTROPY, EOI)), "corrupt"); // kein Marker
  strictEqual(errorOf(concat(SOI, new Uint8Array([0x00]), sof(), sos(), ENTROPY, EOI)), "unsupported"); // ohne FFD8FF kein JPEG
  strictEqual(errorOf(concat(SOI, sof(), sos(), ENTROPY)), "corrupt"); // Scan läuft ins Dateiende
  strictEqual(errorOf(minimal({ width: 0 })), "corrupt");
  strictEqual(errorOf(minimal({ sampling: 0x51 })), "corrupt");
  const badSof = concat(SOI, segment(0xc0, new Uint8Array([8, 0, 16, 0, 16, 3, 1, 0x11, 0])), sos(), ENTROPY, EOI);
  strictEqual(errorOf(badSof), "corrupt"); // Länge passt nicht zur Komponentenzahl
});

Deno.test("Zufallsdaten hinter SOI ergeben nie eine Ausnahme", () => {
  let seed = 42;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) % 256;
  for (let n = 0; n < 500; n++) {
    const bytes = concat(new Uint8Array([0xff, 0xd8, 0xff]), Uint8Array.from({ length: 1 + (n % 64) }, random));
    const result = parseJpeg(bytes, LIMITS);
    strictEqual(typeof result.ok, "boolean");
  }
});

Deno.test("EXIF-Orientierung mit Grenzprüfung", () => {
  const payload = (s: Uint8Array) => s.subarray(4);
  for (let o = 1; o <= 8; o++) strictEqual(exifOrientation(payload(exifSegment({ orientation: o }))), o);
  strictEqual(exifOrientation(payload(exifSegment({ orientation: 6, bigEndian: true }))), 6);
  strictEqual(exifOrientation(payload(exifSegment({ orientation: 9 }))), 0);
  strictEqual(exifOrientation(payload(exifSegment({ orientation: 0 }))), 0);
  strictEqual(exifOrientation(payload(exifSegment({}))), 0);
  // IFD-Offset außerhalb, abgeschnittene Einträge, falscher Kopf, XMP statt Exif
  const broken = payload(exifSegment({ orientation: 6 })).slice();
  broken[10] = 0xff; // IFD-Offset (Byte 4 des TIFF-Kopfs) weit hinter das Ende
  strictEqual(exifOrientation(broken), 0);
  strictEqual(exifOrientation(payload(exifSegment({ orientation: 6 })).subarray(0, 20)), 0);
  strictEqual(exifOrientation(new TextEncoder().encode("Exif\0\0XX*\0\x08\0\0\0")), 0);
  strictEqual(exifOrientation(new TextEncoder().encode("http://ns.adobe.com/xap/1.0/\0<x/>")), 0);
  // Nur das erste Exif-Segment zählt.
  const two = structure(exifSegment({ orientation: 3 }), exifSegment({ orientation: 6 }), sof(), sos(), ENTROPY);
  const result = parseJpeg(two, LIMITS);
  strictEqual(result.ok && result.header.orientation, 3);
});

Deno.test("Ausgabeprüfung: nur Baseline-Marker, nichts nach EOI", () => {
  const clean = encode(quadrants(32, 32));
  strictEqual(isCleanJpeg(clean), true);
  strictEqual(isCleanJpeg(withMetadata(clean)), false);
  strictEqual(isCleanJpeg(concat(clean, new Uint8Array([0x50, 0x4b]))), false);
  strictEqual(isCleanJpeg(minimal({ marker: 0xc2 })), false);
});
