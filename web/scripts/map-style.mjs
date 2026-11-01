// Kartenstil je Sprache vorab erzeugen (ADR 016, Review A2, A9): @protomaps/basemaps ist nur devDependency, ins
// Bundle kommt nur das JSON. Ohne Sprites (keine POI-Symbole) und ohne fremde URLs: Schriften unter /static/map/fonts,
// die Kacheln unter pmtiles:///tiles/… setzt die Karte zur Laufzeit ein (Platzhalter TILES_URL). Die Attribution
// (OSM, Protomaps) gibt die Karte lokalisiert aus.
//   npm run map:style
import { writeFileSync } from "node:fs";
import path from "node:path";
import { layers, namedFlavor } from "@protomaps/basemaps";

const VERSION = "5.7.2";
const LOCALES = ["de", "en", "cs", "pl"];
const out = path.resolve(import.meta.dirname, "..", "public", "static", "map");

for (const lang of LOCALES) {
  const style = {
    version: 8,
    glyphs: "/static/map/fonts/{fontstack}/{range}.pbf",
    sources: {
      protomaps: {
        type: "vector",
        url: "TILES_URL",
      },
    },
    // Ohne Sprites: Layer mit Symbolen (icon-image) fallen weg, Beschriftungen bleiben.
    layers: layers("protomaps", namedFlavor("light"), { lang }).filter((layer) => !layer.layout || !("icon-image" in layer.layout)),
  };
  const file = path.join(out, `style-${lang}.v${VERSION}.json`);
  writeFileSync(file, JSON.stringify(style) + "\n");
  console.log(`${file}: ${style.layers.length} Layer`);
}
