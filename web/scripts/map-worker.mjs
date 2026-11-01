// MapLibre-Worker als eigene Datei unter /static/map/ (ADR 016, Review A2: worker-src 'self', kein blob:). Läuft vor
// dev und build und kopiert die Datei der installierten Version; der Pfad trägt die Version, so passt sie immer.
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const pkg = JSON.parse(readFileSync(path.join(root, "node_modules", "maplibre-gl", "package.json"), "utf8"));
const target = path.join(root, "public", "static", "map", `maplibre-${pkg.version}`);
mkdirSync(target, { recursive: true });
copyFileSync(path.join(root, "node_modules", "maplibre-gl", "dist", "maplibre-gl-worker.mjs"), path.join(target, "maplibre-gl-worker.mjs"));
copyFileSync(path.join(root, "node_modules", "maplibre-gl", "LICENSE.txt"), path.join(target, "LICENSE.txt"));
