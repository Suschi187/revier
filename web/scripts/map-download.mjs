// Kartendatei für DE und AT erzeugen (ADR 016): ein Ausschnitt aus dem öffentlichen Protomaps-Build (OpenStreetMap,
// ODbL) als PMTiles unter web/.cache/map/. Nichts davon kommt ins Repo.
//   npm run map:download              Zoom 0–12, für die Entwicklung (Größe siehe scripts/MAP-SOURCES.md)
//   npm run map:download -- --fixture Zoom 0–7, klein, für E2E-Tests
// Das pmtiles-CLI kommt als Release-Binary mit fester Version und SHA-256 (kein Homebrew).
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const BUILD = "20261101";
const BBOX = "5.8,45.8,17.2,55.1";
const PMTILES_VERSION = "1.31.2";
// Prüfsummen der Release-Archive, beim ersten Laden berechnet (das Release veröffentlicht keine), siehe MAP-SOURCES.md.
const ARCHIVES = {
  "darwin-arm64": ["go-pmtiles-1.31.2_Darwin_arm64.zip", "40528f7f616fcbf91207cd48c8fc023d213f6d86c0cbf1f748732803d1880f3d"],
  "darwin-x64": ["go-pmtiles-1.31.2_Darwin_x86_64.zip", "1f0dc02eee6c58312dd6c509faee1b5c32f0596568af1bf51f1b034e7a88a65b"],
  "linux-arm64": ["go-pmtiles_1.31.2_Linux_arm64.tar.gz", "f8bd47e7ea866863489cad588fbaf2f31f42e5821f7a03f009b3769f05801cb1"],
  "linux-x64": ["go-pmtiles_1.31.2_Linux_x86_64.tar.gz", "3ed7dbf4ec2e6dfe5e25b6f70d1ffc932729f93c86db353bf514dd71010a312f"],
};

const fixture = process.argv.includes("--fixture");
const maxzoom = fixture ? 7 : 12;
const name = fixture ? "basemap-fixture" : `basemap-${BUILD}`;
const cache = path.resolve(import.meta.dirname, "..", ".cache");
const toolDir = path.join(cache, "tools", `pmtiles-${PMTILES_VERSION}`);
const mapDir = path.join(cache, "map");
mkdirSync(toolDir, { recursive: true });
mkdirSync(mapDir, { recursive: true });

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function pmtilesBinary() {
  const binary = path.join(toolDir, "pmtiles");
  if (existsSync(binary)) return binary;
  const entry = ARCHIVES[`${process.platform}-${process.arch}`];
  if (!entry) throw new Error(`Keine pmtiles-Version für ${process.platform}-${process.arch} hinterlegt.`);
  const [archive, expected] = entry;
  const file = path.join(toolDir, archive);
  const response = await fetch(`https://github.com/protomaps/go-pmtiles/releases/download/v${PMTILES_VERSION}/${archive}`);
  if (!response.ok) throw new Error(`Download ${archive}: ${response.status}`);
  writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  const actual = await sha256(file);
  if (actual !== expected) throw new Error(`Prüfsumme von ${archive} stimmt nicht (${actual}).`);
  if (archive.endsWith(".zip")) execFileSync("unzip", ["-o", "-q", file, "pmtiles", "-d", toolDir]);
  else execFileSync("tar", ["-xzf", file, "-C", toolDir, "pmtiles"]);
  return binary;
}

const binary = await pmtilesBinary();
const out = path.join(mapDir, `${name}.pmtiles`);
console.log(`Schneide ${BBOX} bis Zoom ${maxzoom} aus Build ${BUILD} …`);
execFileSync(binary, ["extract", `https://build.protomaps.com/${BUILD}.pmtiles`, out, `--bbox=${BBOX}`, `--maxzoom=${maxzoom}`], {
  stdio: "inherit",
});
const size = statSync(out).size;
const digest = await sha256(out);
console.log(`${out}\n  ${(size / 1024 / 1024).toFixed(1)} MB, SHA-256 ${digest}`);
console.log(`In web/.env.local eintragen: MAP_TILES_DIR=${mapDir} und MAP_TILES_FILE=${name}.pmtiles`);
