import { deepStrictEqual, ok, strictEqual } from "./assert.ts";
import { JpegCodec, wasmBytes } from "../codec.ts";
import { JPEG_WASM_SHA256 } from "../../_shared/imagescript-jpeg/jpeg_wasm.ts";
import { type Bitmap, downscale, orient, rgbaOf } from "../pixels.ts";
import { processJpeg } from "../pipeline.ts";
import {
  bitmap, COMMENT, contains, encode, exifSegment, gpsRationalBytes, quadrants, QUADRANTS, type Rgb, withMetadata,
  XMP_MARKER, ZIP_SIGNATURE,
} from "./fixtures.ts";

const ascii = (text: string) => new TextEncoder().encode(text);

function decode(bytes: Uint8Array) {
  return new JpegCodec().decode(bytes, (d) => ({ ...d, pixels: d.pixels.slice() }));
}

function pixel(image: { width: number; pixels: Uint8Array; channels: number }, x: number, y: number): Rgb {
  const i = (y * image.width + x) * image.channels;
  return [image.pixels[i], image.pixels[i + 1], image.pixels[i + 2]];
}

function near(actual: Rgb, expected: Rgb, tolerance = 40): boolean {
  return actual.every((v, i) => Math.abs(v - expected[i]) <= tolerance);
}

Deno.test("vendored WASM entspricht der dokumentierten Prüfsumme", async () => {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", wasmBytes()));
  strictEqual([...digest].map((b) => b.toString(16).padStart(2, "0")).join(""), JPEG_WASM_SHA256);
});

Deno.test("Metadaten und Anhang verschwinden, Ausgabe ist sauber", () => {
  const input = withMetadata(encode(quadrants(64, 48)));
  for (const needle of [ascii("Exif"), ascii(XMP_MARKER), ascii(COMMENT), ZIP_SIGNATURE, gpsRationalBytes()]) {
    ok(contains(input, needle), "Fixture enthält die Metadaten");
  }
  const result = processJpeg(input);
  ok(result.ok);
  for (const output of [result.full, result.thumb]) {
    for (const needle of [ascii("Exif"), ascii("http://ns.adobe.com"), ascii(COMMENT), ZIP_SIGNATURE, gpsRationalBytes()]) {
      strictEqual(contains(output, needle), false);
    }
    strictEqual(output[output.length - 2], 0xff);
    strictEqual(output[output.length - 1], 0xd9);
  }
});

// Gespeicherte Pixel je Orientierung (EXIF-Tabelle), unabhängig von orient() formuliert:
// So legt eine Kamera das Bild ab, damit es nach Anwendung der Orientierung aufrecht steht.
function stored(display: Bitmap, orientation: number): Bitmap {
  const { width: w, height: h } = display;
  const at = (x: number, y: number): Rgb => {
    const i = (y * w + x) * 4;
    return [display.rgba[i], display.rgba[i + 1], display.rgba[i + 2]];
  };
  switch (orientation) {
    case 2: return bitmap(w, h, (x, y) => at(w - 1 - x, y)); // gespiegelt
    case 3: return bitmap(w, h, (x, y) => at(w - 1 - x, h - 1 - y)); // auf dem Kopf
    case 4: return bitmap(w, h, (x, y) => at(x, h - 1 - y)); // vertikal gespiegelt
    case 5: return bitmap(h, w, (x, y) => at(y, x)); // transponiert
    case 6: return bitmap(h, w, (x, y) => at(w - 1 - y, x)); // Anzeige = gespeichert 90° im Uhrzeigersinn gedreht
    case 7: return bitmap(h, w, (x, y) => at(w - 1 - y, h - 1 - x)); // quer transponiert
    case 8: return bitmap(h, w, (x, y) => at(y, h - 1 - x)); // Anzeige = gespeichert 90° gegen den Uhrzeigersinn
    default: return display;
  }
}

for (let orientation = 1; orientation <= 8; orientation++) {
  Deno.test(`Orientierung ${orientation}: Ergebnis steht aufrecht (Pixeltest)`, () => {
    const display = quadrants(96, 64);
    const input = withMetadata(encode(stored(display, orientation), 95), orientation);
    const result = processJpeg(input);
    ok(result.ok);
    deepStrictEqual([result.width, result.height], [96, 64]);
    const out = decode(result.full);
    deepStrictEqual([out.width, out.height], [96, 64]);
    ok(near(pixel(out, 12, 12), QUADRANTS.tl), "oben links");
    ok(near(pixel(out, 84, 12), QUADRANTS.tr), "oben rechts");
    ok(near(pixel(out, 12, 52), QUADRANTS.bl), "unten links");
    ok(near(pixel(out, 84, 52), QUADRANTS.br), "unten rechts");
  });
}

Deno.test("orient() ist für 1–8 eine Bijektion der Pixel", () => {
  const image = bitmap(5, 3, (x, y) => [x * 40, y * 80, 7]);
  for (let o = 1; o <= 8; o++) {
    const out = orient(image, o);
    strictEqual(out.width * out.height, 15);
    const seen = new Set<string>();
    for (let i = 0; i < out.rgba.length; i += 4) seen.add(`${out.rgba[i]},${out.rgba[i + 1]}`);
    strictEqual(seen.size, 15);
  }
});

Deno.test("Verkleinern: lange Seite 2048 bzw. 480, Flächenmittel statt Nearest Neighbor", () => {
  const stripes = bitmap(3000, 1000, (x) => (x % 2 ? [255, 255, 255] : [0, 0, 0]));
  const small = downscale(rgbaOf(stripes), 1500);
  deepStrictEqual([small.width, small.height], [1500, 500]);
  const grey = small.rgba[(250 * 1500 + 700) * 4];
  ok(grey > 110 && grey < 145, `Mittelwert der Streifen statt Schwarz oder Weiß (${grey})`);
  const result = processJpeg(encode(quadrants(2600, 1300)));
  ok(result.ok);
  deepStrictEqual([result.width, result.height], [2048, 1024]);
  const thumb = decode(result.thumb);
  deepStrictEqual([thumb.width, thumb.height], [480, 240]);
  const tiny = processJpeg(encode(quadrants(300, 200)));
  ok(tiny.ok);
  deepStrictEqual([tiny.width, tiny.height], [300, 200]);
});

Deno.test("Graustufen-JPEG wird verarbeitet", () => {
  const grey = encode(bitmap(40, 40, (x) => [x * 6, x * 6, x * 6]));
  ok(processJpeg(grey).ok);
});

Deno.test("Fehler: abgeschnittene Bilddaten ergeben corrupt, fremde Formate unsupported, Header-Grenzen too_large", () => {
  const good = encode(quadrants(64, 64));
  const cut = new Uint8Array([...good.subarray(0, good.length - 200), 0xff, 0xd9]);
  const result = processJpeg(cut);
  ok(!result.ok || result.width === 64, "abgeschnitten: corrupt oder lesbar, nie eine Ausnahme");
  deepStrictEqual(processJpeg(new TextEncoder().encode("GIF89a")), { ok: false, error: "unsupported" });
  deepStrictEqual(processJpeg(good, { maxSide: 32, maxPixels: 8_000_000, maxProgressivePixels: 5_000_000, maxScans: 16 }), { ok: false, error: "too_large" });
  // EXIF-Segment allein reicht nicht für ein Bild
  deepStrictEqual(processJpeg(new Uint8Array([0xff, 0xd8, ...exifSegment({ orientation: 6 }), 0xff, 0xd9])), { ok: false, error: "corrupt" });
});
