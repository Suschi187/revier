// Ablauf für ein Foto (ADR 011): Header prüfen, dekodieren, verkleinern, Orientierung anwenden, neu kodieren.
// Das Neukodieren verwirft alle Metadaten (EXIF/GPS, XMP, Kommentare, ICC) und angehängte Daten.
import { JpegCodec } from "./codec.ts";
import { type HeaderError, isCleanJpeg, type Limits, parseJpeg } from "./jpeg_header.ts";
import { downscale, orient, rgbaOf } from "./pixels.ts";

// Speicher lokal gemessen (ADR 011): Baseline 8 MP ≈ 180 MB, progressiv 4:4:4 erst bis 5 MP unter 200 MB.
export const LIMITS: Limits = { maxSide: 4096, maxPixels: 8_000_000, maxProgressivePixels: 5_000_000, maxScans: 16 };
export const FULL_LONG_SIDE = 2048;
export const THUMB_LONG_SIDE = 480;
// Detailseite auf dem Handy (M10a Nacharbeit): halbiert die Bytes des Hauptbilds gegenüber 2048 px.
export const MEDIUM_LONG_SIDE = 1024;
const FULL_QUALITY = 82;
const THUMB_QUALITY = 80;
const MEDIUM_QUALITY = 80;

export type Processed = { ok: true; full: Uint8Array; medium: Uint8Array; thumb: Uint8Array; width: number; height: number };
export type ProcessResult = Processed | { ok: false; error: HeaderError };

export function processJpeg(input: Uint8Array, limits: Limits = LIMITS): ProcessResult {
  const parsed = parseJpeg(input, limits);
  if (!parsed.ok) return parsed;
  const { header } = parsed;

  const codec = new JpegCodec();
  let image;
  try {
    image = codec.decode(input, (decoded) => {
      // Der Decoder muss liefern, was der Header verspricht; sonst ist die Datei nicht das, was geprüft wurde.
      if (decoded.width !== header.width || decoded.height !== header.height || decoded.channels !== header.components) {
        return null;
      }
      // Erst verkleinern, dann drehen: Drehen kostet proportional zur Pixelzahl.
      return orient(downscale({ ...decoded, data: decoded.pixels }, FULL_LONG_SIDE), header.orientation);
    });
  } catch {
    return { ok: false, error: "corrupt" };
  }
  if (!image) return { ok: false, error: "corrupt" };

  const mediumImage = downscale(rgbaOf(image), MEDIUM_LONG_SIDE);
  const thumbImage = downscale(rgbaOf(mediumImage), THUMB_LONG_SIDE);
  const full = codec.encode(image.rgba, image.width, image.height, FULL_QUALITY);
  const medium = codec.encode(mediumImage.rgba, mediumImage.width, mediumImage.height, MEDIUM_QUALITY);
  const thumb = codec.encode(thumbImage.rgba, thumbImage.width, thumbImage.height, THUMB_QUALITY);
  if (!isCleanJpeg(full) || !isCleanJpeg(medium) || !isCleanJpeg(thumb)) throw new Error("encoder output failed the marker allowlist");
  return { ok: true, full, medium, thumb, width: image.width, height: image.height };
}

/**
 * Mittlere Größe aus einem schon verarbeiteten Bild (Nachberechnen für Fotos von vor der mittleren Größe). Das
 * Bild ist bereits gedreht und ohne Metadaten; kleine Bilder werden unverändert übernommen.
 */
export function mediumFromProcessed(full: Uint8Array): Uint8Array {
  const parsed = parseJpeg(full, LIMITS);
  if (!parsed.ok) throw new Error(`processed image rejected: ${parsed.error}`);
  if (Math.max(parsed.header.width, parsed.header.height) <= MEDIUM_LONG_SIDE) {
    if (!isCleanJpeg(full)) throw new Error("processed image failed the marker allowlist");
    return full;
  }
  const codec = new JpegCodec();
  const image = codec.decode(full, (decoded) => downscale({ ...decoded, data: decoded.pixels }, MEDIUM_LONG_SIDE));
  const medium = codec.encode(image.rgba, image.width, image.height, MEDIUM_QUALITY);
  if (!isCleanJpeg(medium)) throw new Error("encoder output failed the marker allowlist");
  return medium;
}
