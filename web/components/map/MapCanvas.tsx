"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { Map as MapLibreMap, MapOptions, StyleSpecification } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { MAP_STYLE_VERSION, MAP_WORKER_URL } from "@/lib/map/assets";

export type Bounds = [number, number, number, number];
export type MapApi = { map: MapLibreMap; maplibre: typeof import("maplibre-gl") };

/**
 * Kartengrund (ADR 016). Nur im Browser geladen (dynamic, ssr: false, Review A9). Worker als eigene Datei
 * (worker-src 'self'), Kacheln von der eigenen Origin, Attribution immer sichtbar (A10). Ohne Kartendatei zeigt
 * die Karte einen neutralen Grund, die Punkte bleiben nutzbar (A11). Ohne WebGL eine Meldung statt einer leeren Fläche.
 */
export default function MapCanvas({
  tilesUrl,
  locale,
  bounds,
  label,
  attribution,
  failedText,
  maxZoom = 13,
  onReady,
  className = "h-[28rem] w-full",
}: {
  tilesUrl: string | null;
  locale: string;
  bounds: Bounds;
  label: string;
  attribution: string;
  failedText: string;
  maxZoom?: number;
  onReady?: (api: MapApi) => void;
  className?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const ready = useRef(onReady);
  useEffect(() => {
    ready.current = onReady;
  }, [onReady]);

  useEffect(() => {
    let map: MapLibreMap | undefined;
    let cancelled = false;
    (async () => {
      try {
        const [maplibre, { Protocol }] = await Promise.all([import("maplibre-gl"), import("pmtiles")]);
        if (cancelled || !container.current) return;
        maplibre.setWorkerUrl(MAP_WORKER_URL);
        const response = await fetch(`/static/map/style-${locale}.v${MAP_STYLE_VERSION}.json`);
        const style = (await response.json()) as StyleSpecification;
        if (tilesUrl) {
          const protocol = new Protocol();
          maplibre.addProtocol("pmtiles", protocol.tile);
          (style.sources.protomaps as { url: string }).url = `pmtiles://${window.location.origin}${tilesUrl}`;
        } else {
          style.sources = {};
          style.layers = [{ id: "background", type: "background", paint: { "background-color": "#eceee6" } }];
        }
        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const options: MapOptions = {
          container: container.current,
          style,
          bounds,
          fitBoundsOptions: { padding: 24 },
          maxZoom,
          attributionControl: false,
          dragRotate: false,
          pitchWithRotate: false,
          fadeDuration: reducedMotion ? 0 : 300,
        };
        map = new maplibre.Map(options);
        map.touchZoomRotate.disableRotation();
        map.addControl(new maplibre.AttributionControl({ compact: false, customAttribution: attribution }), "bottom-right");
        map.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
        map.getCanvas().setAttribute("aria-label", label);
        map.on("error", (event) => {
          // Fehlende Kacheln oder Schriften nicht als Absturz werten; nur WebGL-Fehler ohne Karte.
          if (!map?.loaded() && /webgl/i.test(String(event.error?.message))) setFailed(true);
        });
        map.once("load", () => {
          if (!cancelled && map) ready.current?.({ map, maplibre });
        });
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      map?.remove();
    };
    // Grenzen und Texte nur beim ersten Rendern; Änderungen steuert der Aufrufer über die Map selbst.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tilesUrl, locale]);

  if (failed) return <p role="alert" className="rounded border border-stone-300 p-4">{failedText}</p>;
  return <div ref={container} className={`${className} rounded border border-stone-300`} role="region" aria-label={label} />;
}
