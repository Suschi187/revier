// Pixeloperationen auf RGBA (4 Byte je Pixel): Umwandlung aus dem Decoder, Verkleinern, Orientierung.
// Eigene Umsetzung statt imagescript, dessen resize standardmäßig Nearest Neighbor nutzt (ADR 011).

export type Bitmap = { width: number; height: number; rgba: Uint8Array };

/** Pixel mit 1 (Graustufen), 3 (RGB) oder 4 (RGBA) Byte je Pixel, z. B. direkt aus dem Decoder. */
export type Pixels = { width: number; height: number; channels: 1 | 3 | 4; data: Uint8Array };

export function rgbaOf(image: Bitmap): Pixels {
  return { width: image.width, height: image.height, channels: 4, data: image.rgba };
}

function sample(src: Pixels, offset: number): [number, number, number] {
  const d = src.data;
  return src.channels === 1 ? [d[offset], d[offset], d[offset]] : [d[offset], d[offset + 1], d[offset + 2]];
}

type Taps = { first: Int32Array; count: Int32Array; weights: Float32Array; stride: number };

/** Flächenmittel: Jeder Zielpixel mittelt die Quellpixel, die er überdeckt, anteilig gewichtet. */
function taps(source: number, target: number): Taps {
  const scale = source / target;
  const stride = Math.ceil(scale) + 1;
  const first = new Int32Array(target);
  const count = new Int32Array(target);
  const weights = new Float32Array(target * stride);
  for (let i = 0; i < target; i++) {
    const from = i * scale;
    const to = Math.min(source, (i + 1) * scale);
    const start = Math.floor(from);
    let n = 0;
    for (let s = start; s < to && n < stride; s++, n++) {
      weights[i * stride + n] = (Math.min(s + 1, to) - Math.max(s, from)) / scale;
    }
    first[i] = start;
    count[i] = n;
  }
  return { first, count, weights, stride };
}

/**
 * Verkleinert so, dass die lange Seite höchstens `maxLong` ist, und liefert RGBA. Kleinere Bilder werden nur
 * umgewandelt. Liest die Quelle direkt (auch Graustufen/RGB aus dem Decoder), ohne Kopie in voller Größe.
 */
export function downscale(src: Pixels, maxLong: number): Bitmap {
  const ch = src.channels;
  if (src.data.length < src.width * src.height * ch) throw new Error("pixels: buffer too short");
  const long = Math.max(src.width, src.height);
  if (long <= maxLong) {
    const rgba = new Uint8Array(src.width * src.height * 4);
    for (let i = 0, s = 0; i < rgba.length; i += 4, s += ch) {
      const [r, g, b] = sample(src, s);
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = 255;
    }
    return { width: src.width, height: src.height, rgba };
  }
  const factor = maxLong / long;
  const width = Math.max(1, Math.round(src.width * factor));
  const height = Math.max(1, Math.round(src.height * factor));
  const tx = taps(src.width, width);
  const ty = taps(src.height, height);
  const data = src.data;
  const grey = ch === 1;

  // Erst horizontal (je Zeile), dann vertikal; das Zwischenbild hat die Zielbreite und die Quellhöhe.
  const mid = new Uint8Array(width * src.height * 3);
  for (let y = 0; y < src.height; y++) {
    const row = y * src.width * ch;
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0;
      const base = x * tx.stride;
      for (let k = 0; k < tx.count[x]; k++) {
        const w = tx.weights[base + k];
        const p = row + (tx.first[x] + k) * ch;
        r += data[p] * w;
        g += data[grey ? p : p + 1] * w;
        b += data[grey ? p : p + 2] * w;
      }
      const d = (y * width + x) * 3;
      mid[d] = r + 0.5;
      mid[d + 1] = g + 0.5;
      mid[d + 2] = b + 0.5;
    }
  }
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const base = y * ty.stride;
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0;
      for (let k = 0; k < ty.count[y]; k++) {
        const w = ty.weights[base + k];
        const p = ((ty.first[y] + k) * width + x) * 3;
        r += mid[p] * w;
        g += mid[p + 1] * w;
        b += mid[p + 2] * w;
      }
      const d = (y * width + x) * 4;
      out[d] = r + 0.5;
      out[d + 1] = g + 0.5;
      out[d + 2] = b + 0.5;
      out[d + 3] = 255;
    }
  }
  return { width, height, rgba: out };
}

/**
 * Wendet die EXIF-Orientierung an, sodass das Ergebnis aufrecht steht (1 = unverändert).
 * Zielposition (dx, dy) eines gespeicherten Pixels (x, y) im Bild w × h:
 * 2 spiegeln, 3 180°, 4 vertikal spiegeln, 5 transponieren, 6 90° im Uhrzeigersinn,
 * 7 quer transponieren, 8 90° gegen den Uhrzeigersinn.
 */
export function orient(image: Bitmap, orientation: number): Bitmap {
  if (orientation < 2 || orientation > 8) return image;
  const { width: w, height: h, rgba: src } = image;
  const swap = orientation >= 5;
  const width = swap ? h : w;
  const height = swap ? w : h;
  const dst32 = new Uint32Array(width * height);
  const src32 = new Uint32Array(src.buffer, src.byteOffset, w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let dx: number, dy: number;
      switch (orientation) {
        case 2: dx = w - 1 - x; dy = y; break;
        case 3: dx = w - 1 - x; dy = h - 1 - y; break;
        case 4: dx = x; dy = h - 1 - y; break;
        case 5: dx = y; dy = x; break;
        case 6: dx = h - 1 - y; dy = x; break;
        case 7: dx = h - 1 - y; dy = w - 1 - x; break;
        default: dx = y; dy = w - 1 - x; break;
      }
      dst32[dy * width + dx] = src32[y * w + x];
    }
  }
  return { width, height, rgba: new Uint8Array(dst32.buffer) };
}
