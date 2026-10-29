// Strenge Prüfung eines JPEG vor dem Dekodieren (ADR 011, Spike-Review Auflage 5). Der Decoder sieht nur
// Dateien, deren Struktur vollständig durchlaufen wurde und deren Größe innerhalb der Grenzen liegt.
// Jede Ausnahme ergibt `corrupt`, nie einen Absturz.

/** `maxProgressivePixels`: progressive JPEGs brauchen einen Koeffizientenpuffer für das ganze Bild (ADR 011, Messung). */
export type Limits = { maxSide: number; maxPixels: number; maxProgressivePixels: number; maxScans: number };

export type Header = {
  width: number;
  height: number;
  components: 1 | 3;
  progressive: boolean;
  /** EXIF-Orientierung 1–8, sonst 1 */
  orientation: number;
};

export type HeaderError = "unsupported" | "corrupt" | "too_large";
export type HeaderResult = { ok: true; header: Header } | { ok: false; error: HeaderError };

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
// Erlaubte Frames: Baseline, erweitert sequenziell, progressiv (jeweils Huffman, 8 Bit).
const ALLOWED_SOF = new Set([0xc0, 0xc1, 0xc2]);
// Alle übrigen SOF-Typen: verlustfrei, hierarchisch, arithmetisch.
const OTHER_SOF = new Set([0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
// Segmente, die vor und zwischen den Scans vorkommen dürfen: DHT, DQT, DRI, APP0–APP15, COM.
function isSkippable(marker: number): boolean {
  return marker === 0xc4 || marker === 0xdb || marker === 0xdd || (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe;
}

class Reject extends Error {
  constructor(readonly kind: HeaderError) {
    super(kind);
  }
}

function u16(bytes: Uint8Array, at: number): number {
  if (at + 2 > bytes.length) throw new Reject("corrupt");
  return (bytes[at] << 8) | bytes[at + 1];
}

export function parseJpeg(bytes: Uint8Array, limits: Limits): HeaderResult {
  try {
    return { ok: true, header: parse(bytes, limits) };
  } catch (error) {
    return { ok: false, error: error instanceof Reject ? error.kind : "corrupt" };
  }
}

function parse(bytes: Uint8Array, limits: Limits): Header {
  // Magic Bytes: HEIC (ftyp), WebP (RIFF), PNG, GIF und alles andere sind kein JPEG.
  if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== SOI || bytes[2] !== 0xff) throw new Reject("unsupported");

  let pos = 2;
  let frame: { width: number; height: number; components: 1 | 3; progressive: boolean } | null = null;
  let orientation = 0;
  let scans = 0;

  for (;;) {
    // Bewusst streng: keine Füllbytes und keine alleinstehenden Marker außerhalb der Scans.
    if (pos + 2 > bytes.length || bytes[pos] !== 0xff) throw new Reject("corrupt");
    const marker = bytes[pos + 1];

    if (marker === EOI) {
      if (!frame || scans === 0) throw new Reject("corrupt");
      // Daten nach EOI (z. B. angehängtes ZIP, MPO) bleiben unbeachtet und verschwinden beim Neukodieren.
      return { ...frame, orientation: orientation || 1 };
    }
    if (OTHER_SOF.has(marker) || marker === 0xc8 || marker === 0xcc || marker === 0xdc || marker === 0xde || marker === 0xdf) {
      throw new Reject("unsupported");
    }
    if (marker === SOI || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01 || marker === 0x00 || marker === 0xff) {
      throw new Reject("corrupt");
    }
    if (!ALLOWED_SOF.has(marker) && marker !== SOS && !isSkippable(marker)) throw new Reject("unsupported");

    const length = u16(bytes, pos + 2);
    const start = pos + 4;
    const end = pos + 2 + length;
    if (length < 2 || end > bytes.length) throw new Reject("corrupt");

    if (ALLOWED_SOF.has(marker)) {
      if (frame) throw new Reject("unsupported");
      frame = readFrame(bytes, start, length, marker === 0xc2, limits);
    } else if (marker === 0xe1 && !frame && !orientation) {
      orientation = exifOrientation(bytes.subarray(start, end));
    } else if (marker === SOS) {
      if (!frame) throw new Reject("corrupt");
      scans += 1;
      if (scans > limits.maxScans) throw new Reject("unsupported");
      const count = bytes[start];
      if (count < 1 || count > 4 || length !== 6 + 2 * count) throw new Reject("corrupt");
      pos = skipEntropy(bytes, end);
      continue;
    }
    pos = end;
  }
}

function readFrame(bytes: Uint8Array, start: number, length: number, progressive: boolean, limits: Limits) {
  const precision = bytes[start];
  const height = u16(bytes, start + 1);
  const width = u16(bytes, start + 3);
  const count = bytes[start + 5];
  if (length !== 8 + 3 * count) throw new Reject("corrupt");
  // 12 Bit, CMYK/YCCK (4 Komponenten) und Höhe aus DNL (0) werden nicht unterstützt.
  if (precision !== 8 || (count !== 1 && count !== 3) || height === 0) throw new Reject("unsupported");
  if (width === 0) throw new Reject("corrupt");
  for (let i = 0; i < count; i++) {
    const sampling = bytes[start + 6 + i * 3 + 1];
    const h = sampling >> 4;
    const v = sampling & 0x0f;
    if (h < 1 || h > 4 || v < 1 || v > 4) throw new Reject("corrupt");
  }
  const maxPixels = progressive ? Math.min(limits.maxPixels, limits.maxProgressivePixels) : limits.maxPixels;
  if (width > limits.maxSide || height > limits.maxSide || width * height > maxPixels) throw new Reject("too_large");
  return { width, height, components: count as 1 | 3, progressive };
}

/** Überspringt die Entropiedaten eines Scans bis zum nächsten Marker (Stuffing FF00 und RST zählen nicht). */
function skipEntropy(bytes: Uint8Array, from: number): number {
  for (let i = from; i + 1 < bytes.length; i++) {
    if (bytes[i] !== 0xff) continue;
    const next = bytes[i + 1];
    if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
      i += 1;
      continue;
    }
    return i;
  }
  throw new Reject("corrupt");
}

/** Orientierung aus einem APP1-Segment; alles Unerwartete ergibt 0 (keine Angabe). */
export function exifOrientation(payload: Uint8Array): number {
  const EXIF = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
  if (payload.length < 14 || EXIF.some((b, i) => payload[i] !== b)) return 0;
  const tiff = payload.subarray(6);
  const little = tiff[0] === 0x49 && tiff[1] === 0x49 && tiff[2] === 0x2a && tiff[3] === 0x00;
  const big = tiff[0] === 0x4d && tiff[1] === 0x4d && tiff[2] === 0x00 && tiff[3] === 0x2a;
  if (!little && !big) return 0;
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const ifd = view.getUint32(4, little);
  if (ifd < 8 || ifd + 2 > tiff.length) return 0;
  const count = view.getUint16(ifd, little);
  if (ifd + 2 + count * 12 > tiff.length) return 0;
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (view.getUint16(entry, little) !== 0x0112) continue;
    const type = view.getUint16(entry + 2, little);
    const values = view.getUint32(entry + 4, little);
    const value = view.getUint16(entry + 8, little);
    return type === 3 && values === 1 && value >= 1 && value <= 8 ? value : 0;
  }
  return 0;
}

// Ausgabe des Encoders: nur diese Marker, Baseline, nichts nach EOI (Auflage 6).
const OUTPUT_MARKERS = new Set([0xe0, 0xdb, 0xc0, 0xc4, 0xdd, SOS]);

/** Prüft eine eigene Ausgabe: keine Metadaten-Segmente, kein Anhang. */
export function isCleanJpeg(bytes: Uint8Array): boolean {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== SOI) return false;
  let pos = 2;
  while (pos + 4 <= bytes.length) {
    if (bytes[pos] !== 0xff) return false;
    const marker = bytes[pos + 1];
    if (!OUTPUT_MARKERS.has(marker)) return false;
    const end = pos + 2 + ((bytes[pos + 2] << 8) | bytes[pos + 3]);
    if (end > bytes.length) return false;
    if (marker === SOS) {
      // Baseline mit genau einem Scan: Der nächste Marker ist EOI, danach kommt nichts mehr.
      for (let i = end; i + 1 < bytes.length; i++) {
        if (bytes[i] !== 0xff) continue;
        const next = bytes[i + 1];
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) continue;
        return next === EOI && i + 2 === bytes.length;
      }
      return false;
    }
    pos = end;
  }
  return false;
}
