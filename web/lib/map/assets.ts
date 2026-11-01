import maplibrePackage from "maplibre-gl/package.json";

// Versionierte Pfade der Kartendateien unter /static/map/ (ADR 016, Review A9): lange Cache-Header, neue Version =
// neuer Pfad. Der Worker kommt aus scripts/map-worker.mjs, der Stil aus scripts/map-style.mjs.
export const MAP_WORKER_URL = `/static/map/maplibre-${maplibrePackage.version}/maplibre-gl-worker.mjs`;
export const MAP_STYLE_VERSION = "5.7.2";
