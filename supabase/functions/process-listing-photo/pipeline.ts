// Ablauf für ein Foto (ADR 011): Header prüfen, dekodieren, verkleinern, Orientierung anwenden, neu kodieren.
// Das Neukodieren verwirft alle Metadaten (EXIF/GPS, XMP, Kommentare, ICC) und angehängte Daten.
import { JpegCodec } from "./codec.ts";
import { type HeaderError, isCleanJpeg, type Limits, parseJpeg } from "./jpeg_header.ts";
import { downscale, orient, rgbaOf } from "./pixels.ts";

// Speicher lokal gemessen (ADR 011): Baseline 8 MP ≈ 180 MB, progressiv 4:4:4 erst bis 5 MP unter 200 MB.
export const LIMITS: Limits = { maxSide: 4096, maxPixels: 8_000_000, maxProgressivePixels: 5_000_000, maxScans: 16 };
export const FULL_LONG_SIDE = 2048;
export const THUMB_LONG_SIDE = 480;
const FULL_QUALITY = 82;
const THUMB_QUALITY = 80;

export type Processed = { ok: true; full: Uint8Array; thumb: Uint8Array; width: number; height: number };
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

  const thumbImage = downscale(rgbaOf(image), THUMB_LONG_SIDE);
  const full = codec.encode(image.rgba, image.width, image.height, FULL_QUALITY);
  const thumb = codec.encode(thumbImage.rgba, thumbImage.width, thumbImage.height, THUMB_QUALITY);
  if (!isCleanJpeg(full) || !isCleanJpeg(thumb)) throw new Error("encoder output failed the marker allowlist");
  return { ok: true, full, thumb, width: image.width, height: image.height };
}
