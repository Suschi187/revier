"use client";

import dynamic from "next/dynamic";
import { useCallback, useState } from "react";
import type { MapApi } from "./MapCanvas";

// Kleine Karte am Detail (ADR 016, Review A9): MapLibre erst nach Klick, nie vor dem LCP. Der Marker unterscheidet
// verfremdeten Punkt und Kreismittelpunkt per Form und Beschriftung, nicht nur per Farbe (A8, H5).

const MapCanvas = dynamic(() => import("./MapCanvas"), { ssr: false, loading: () => <div className="h-64 w-full rounded bg-stone-100" /> });

export function DetailMap({
  tilesUrl,
  locale,
  point,
  approx,
  texts,
}: {
  tilesUrl: string | null;
  locale: string;
  point: { lng: number; lat: number };
  approx: "point" | "district";
  texts: { show: string; label: string; attribution: string; failed: string; marker: string };
}) {
  const [open, setOpen] = useState(false);
  // Ausschnitt etwa 20 km um den Punkt: genug Umgebung, keine Scheingenauigkeit.
  const dLat = 0.09;
  const dLng = 0.09 / Math.cos((point.lat * Math.PI) / 180);

  const onReady = useCallback(
    ({ map, maplibre }: MapApi) => {
      const element = document.createElement("div");
      element.className = approx === "point" ? "map-marker" : "map-marker map-district";
      element.setAttribute("role", "img");
      element.setAttribute("aria-label", texts.marker);
      new maplibre.Marker({ element }).setLngLat([point.lng, point.lat]).addTo(map);
    },
    [approx, point.lat, point.lng, texts.marker],
  );

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-2 rounded border border-stone-500 px-3 py-1.5">
        {texts.show}
      </button>
    );
  }
  return (
    <div className="mt-2">
      <MapCanvas
        tilesUrl={tilesUrl}
        locale={locale}
        bounds={[point.lng - dLng, point.lat - dLat, point.lng + dLng, point.lat + dLat]}
        label={texts.label}
        attribution={texts.attribution}
        failedText={texts.failed}
        maxZoom={12}
        onReady={onReady}
        className="h-64 w-full"
      />
    </div>
  );
}
