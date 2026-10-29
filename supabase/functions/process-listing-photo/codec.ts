// JPEG dekodieren und kodieren mit dem vendored WASM-Codec aus imagescript 1.3.0 (MIT, siehe
// ../_shared/imagescript-jpeg/README.md). Nachgebaut nach utils/wasm/jpeg.js, aber ohne Laden zur Laufzeit
// und mit einer eigenen Instanz je Aufruf, damit der lineare Speicher nach der Anfrage freigegeben werden kann.
import { JPEG_WASM_BASE64 } from "../_shared/imagescript-jpeg/jpeg_wasm.ts";

type Exports = {
  memory: WebAssembly.Memory;
  wlen(): number;
  walloc(size: number): number;
  wfree(ptr: number, size: number): void;
  encode(ptr: number, width: number, height: number, quality: number): number;
  decode(ptr: number, length: number, width: number, height: number): number;
  decode_width(ptr: number): number;
  decode_height(ptr: number): number;
  decode_format(ptr: number): number;
  decode_buffer(ptr: number): number;
  decode_free(ptr: number): void;
};

/** Pixel nach dem Dekodieren: 1 = Graustufen, 3 = RGB, 4 = CMYK (Format 0, 1, 2 des Codecs). Nur in `use` gültig. */
export type Decoded = { width: number; height: number; channels: 1 | 3 | 4; pixels: Uint8Array };

let compiled: WebAssembly.Module | null = null;

export function wasmBytes(): Uint8Array {
  return Uint8Array.from(atob(JPEG_WASM_BASE64), (c) => c.charCodeAt(0));
}

function instance(): Exports {
  // Eigener, genau passender Puffer aus Uint8Array.from; `.buffer` hält die Typen in Deno und im Web gleich.
  compiled ??= new WebAssembly.Module(wasmBytes().buffer as ArrayBuffer);
  return new WebAssembly.Instance(compiled).exports as unknown as Exports;
}

export class JpegCodec {
  readonly #wasm = instance();

  #copyIn(bytes: Uint8Array): number {
    const ptr = this.#wasm.walloc(bytes.length);
    new Uint8Array(this.#wasm.memory.buffer, ptr, bytes.length).set(bytes);
    return ptr;
  }

  /**
   * Dekodiert und reicht die Pixel als Sicht in den WASM-Speicher an `use` weiter; danach wird der Puffer
   * freigegeben. So entsteht keine Kopie des Bildes in voller Größe. Wirft bei jedem Fehler des Codecs;
   * der Aufrufer bildet das auf `corrupt` ab.
   */
  decode<T>(bytes: Uint8Array, use: (decoded: Decoded) => T): T {
    const ptr = this.#wasm.decode(this.#copyIn(bytes), bytes.length, 0, 0);
    if (ptr === 0) throw new Error("jpeg: decode failed");
    if (ptr === 1) throw new Error("jpeg: scale failed");
    try {
      const format = this.#wasm.decode_format(ptr);
      if (format < 0 || format > 2) throw new Error("jpeg: unknown pixel format");
      return use({
        width: this.#wasm.decode_width(ptr),
        height: this.#wasm.decode_height(ptr),
        channels: format === 0 ? 1 : format === 1 ? 3 : 4,
        pixels: new Uint8Array(this.#wasm.memory.buffer, this.#wasm.decode_buffer(ptr), this.#wasm.wlen()),
      });
    } finally {
      this.#wasm.decode_free(ptr);
    }
  }

  /** `rgba` hat 4 Byte je Pixel (Alpha wird ignoriert); Ausgabe ist Baseline-JPEG ohne Metadaten. */
  encode(rgba: Uint8Array, width: number, height: number, quality: number): Uint8Array {
    const ptr = this.#wasm.encode(this.#copyIn(rgba), width, height, quality);
    const length = this.#wasm.wlen();
    const out = new Uint8Array(this.#wasm.memory.buffer, ptr, length).slice();
    this.#wasm.wfree(ptr, length);
    return out;
  }
}
