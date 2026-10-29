// Testbilder, deterministisch im Test erzeugt (Spike-Review Auflage 10): keine Binärdateien im Repo.
// Echte JPEGs kodiert der vendored Encoder; Metadaten (EXIF mit GPS, XMP, Kommentar, ZIP-Anhang) werden
// eingefügt. Für den Header-Parser gibt es synthetische JPEG-Strukturen ohne gültige Bilddaten.
import { JpegCodec } from "../codec.ts";
import type { Bitmap } from "../pixels.ts";

export const GPS = { lat: 48.0512, lon: 11.3127 };
export const COMMENT = "Revier-Testkommentar Hochsitz";
export const XMP_MARKER = "http://ns.adobe.com/xap/1.0/";

export type Rgb = [number, number, number];

export function bitmap(width: number, height: number, color: (x: number, y: number) => Rgb): Bitmap {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = color(x, y);
      rgba.set([r, g, b, 255], (y * width + x) * 4);
    }
  }
  return { width, height, rgba };
}

/** Vier Quadranten in klar unterscheidbaren Farben: oben links rot, oben rechts grün, unten links blau, unten rechts gelb. */
export const QUADRANTS: Record<"tl" | "tr" | "bl" | "br", Rgb> = {
  tl: [220, 30, 30],
  tr: [30, 200, 30],
  bl: [30, 30, 220],
  br: [230, 220, 30],
};

export function quadrants(width: number, height: number): Bitmap {
  return bitmap(width, height, (x, y) => {
    const right = x >= width / 2;
    const bottom = y >= height / 2;
    return QUADRANTS[bottom ? (right ? "br" : "bl") : right ? "tr" : "tl"];
  });
}

export function encode(image: Bitmap, quality = 90): Uint8Array {
  return new JpegCodec().encode(image.rgba, image.width, image.height, quality);
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export function segment(marker: number, payload: Uint8Array): Uint8Array {
  const length = payload.length + 2;
  return concat(new Uint8Array([0xff, marker, length >> 8, length & 0xff]), payload);
}

const ascii = (text: string) => new TextEncoder().encode(text);

/** APP1 Exif (TIFF little endian): IFD0 mit Orientation und GPS-Zeiger, GPS-IFD mit Breite und Länge. */
export function exifSegment(options: { orientation?: number; gps?: { lat: number; lon: number }; bigEndian?: boolean } = {}): Uint8Array {
  const le = !options.bigEndian;
  const buf = new DataView(new ArrayBuffer(256));
  const bytes = new Uint8Array(buf.buffer);
  bytes.set(le ? [0x49, 0x49, 0x2a, 0x00] : [0x4d, 0x4d, 0x00, 0x2a], 0);
  buf.setUint32(4, 8, le);
  const entries: [number, number, number, number][] = [];
  if (options.orientation) entries.push([0x0112, 3, 1, options.orientation]);
  const gpsIfd = 8 + 2 + 2 * 12 + 4;
  if (options.gps) entries.push([0x8825, 4, 1, gpsIfd]);
  let o = 8;
  buf.setUint16(o, entries.length, le);
  o += 2;
  for (const [tag, type, count, value] of entries) {
    buf.setUint16(o, tag, le);
    buf.setUint16(o + 2, type, le);
    buf.setUint32(o + 4, count, le);
    if (type === 3) buf.setUint16(o + 8, value, le);
    else buf.setUint32(o + 8, value, le);
    o += 12;
  }
  buf.setUint32(o, 0, le);
  let end = o + 4;
  if (options.gps) {
    o = gpsIfd;
    let data = gpsIfd + 2 + 4 * 12 + 4;
    buf.setUint16(o, 4, le);
    o += 2;
    const rational = (v: number): [number, number][] => {
      const deg = Math.floor(v);
      const minutes = (v - deg) * 60;
      const min = Math.floor(minutes);
      return [[deg, 1], [min, 1], [Math.round((minutes - min) * 6000), 100]];
    };
    const gpsEntries: [number, number, string | [number, number][]][] = [
      [1, 2, "N"], [2, 5, rational(options.gps.lat)], [3, 2, "E"], [4, 5, rational(options.gps.lon)],
    ];
    for (const [tag, type, value] of gpsEntries) {
      buf.setUint16(o, tag, le);
      buf.setUint16(o + 2, type, le);
      if (typeof value === "string") {
        buf.setUint32(o + 4, 2, le);
        bytes.set(ascii(value + "\0"), o + 8);
      } else {
        buf.setUint32(o + 4, 3, le);
        buf.setUint32(o + 8, data, le);
        for (const [n, d] of value) {
          buf.setUint32(data, n, le);
          buf.setUint32(data + 4, d, le);
          data += 8;
        }
      }
      o += 12;
    }
    buf.setUint32(o, 0, le);
    end = data;
  }
  return segment(0xe1, concat(ascii("Exif\0\0"), bytes.subarray(0, end)));
}

/** Die GPS-Breite als RATIONAL-Bytes, wie sie in der EXIF-Fixture stehen (für die Bytesuche in der Ausgabe). */
export function gpsRationalBytes(): Uint8Array {
  const deg = Math.floor(GPS.lat);
  const minutes = (GPS.lat - deg) * 60;
  const view = new DataView(new ArrayBuffer(16));
  view.setUint32(0, deg, true);
  view.setUint32(4, 1, true);
  view.setUint32(8, Math.floor(minutes), true);
  view.setUint32(12, 1, true);
  return new Uint8Array(view.buffer);
}

export const ZIP_SIGNATURE = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

/** Fügt nach SOI EXIF (GPS, Orientierung), XMP und einen Kommentar ein und hängt ein ZIP-Fragment an. */
export function withMetadata(jpeg: Uint8Array, orientation = 1): Uint8Array {
  const xmp = segment(0xe1, ascii(`${XMP_MARKER}\0<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:Description exif:GPSLatitude="48,3.07N"/></x:xmpmeta>`));
  const com = segment(0xfe, ascii(COMMENT));
  const zip = concat(ZIP_SIGNATURE, new Uint8Array(16));
  return concat(jpeg.subarray(0, 2), exifSegment({ orientation, gps: GPS }), xmp, com, jpeg.subarray(2), zip);
}

export function contains(haystack: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Synthetische Strukturen für den Header-Parser
// ---------------------------------------------------------------------------
export const SOI = new Uint8Array([0xff, 0xd8]);
export const EOI = new Uint8Array([0xff, 0xd9]);

export function sof(options: { marker?: number; precision?: number; width?: number; height?: number; components?: number; sampling?: number } = {}): Uint8Array {
  const { marker = 0xc0, precision = 8, width = 16, height = 16, components = 3, sampling = 0x11 } = options;
  const payload = [precision, height >> 8, height & 0xff, width >> 8, width & 0xff, components];
  for (let i = 0; i < components; i++) payload.push(i + 1, sampling, 0);
  return segment(marker, new Uint8Array(payload));
}

export function sos(components = 3): Uint8Array {
  const payload = [components];
  for (let i = 0; i < components; i++) payload.push(i + 1, 0);
  payload.push(0, 63, 0);
  return segment(0xda, new Uint8Array(payload));
}

/** Entropiedaten mit Stuffing (FF00) und Restart-Marker (FFD0), wie sie in echten Scans vorkommen. */
export const ENTROPY = new Uint8Array([0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd0, 0x78]);

export function structure(...parts: Uint8Array[]): Uint8Array {
  return concat(SOI, ...parts, EOI);
}

export function minimal(sofOptions: Parameters<typeof sof>[0] = {}): Uint8Array {
  return structure(sof(sofOptions), sos(sofOptions.components ?? 3), ENTROPY);
}
