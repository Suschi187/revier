# Vendored: JPEG-Codec aus imagescript 1.3.0

Nur der JPEG-Codec (WASM) von [imagescript](https://deno.land/x/imagescript@1.3.0) wird genutzt (ADR 011).
`mod.ts` lädt beim Import alle WASM-Module (JPEG, PNG, zlib, GIF, Fonts, SVG, TIFF) zur Laufzeit per `fetch`
von deno.land nach. Das wäre eine Netzabhängigkeit ohne Integritätsprüfung (Spike-Review, Auflage 8) und eine
unnötig große Angriffsfläche.

- **Quelle:** `https://deno.land/x/imagescript@1.3.0/utils/wasm/jpeg.wasm`
- **SHA-256:** `019bcef4d864045e9b2df7e39ef6e7f3227d80b08a33742e1438441f2ddc2368` (Test `codec_test.ts` prüft ihn)
- **Glue-Code:** `../../process-listing-photo/codec.ts`, nachgebaut nach `utils/wasm/jpeg.js`
  (SHA-256 `75295e2fcf96b4f7bb894b3844fdaa8140d63169d28b466b5d5be89d59a7b6e6`)
- **Lizenz:** Das Paket steht unter „AGPL-3.0-or-later OR MIT“. Genutzt wird **MIT** (`LICENSE.MIT`, Copyright (c)
  2023 Mathis Mensing). `LICENSE` ist die Lizenzerklärung des Pakets.
- **Prüfung:** bei jedem Meilenstein auf eine neue Version und Sicherheitsmeldungen prüfen (ADR 011).

## Neu erzeugen
```sh
mkdir -p /tmp/is && cd /tmp/is
curl -sfLO https://deno.land/x/imagescript@<version>/utils/wasm/jpeg.wasm
shasum -a 256 jpeg.wasm
python3 -c "import base64,hashlib,sys; d=open('jpeg.wasm','rb').read(); print(hashlib.sha256(d).hexdigest()); print(base64.b64encode(d).decode())"
```
Das Ergebnis in `jpeg_wasm.ts` (`JPEG_WASM_SHA256`, `JPEG_WASM_BASE64`) und hier eintragen und den Glue-Code
mit dem neuen `utils/wasm/jpeg.js` vergleichen.
