"use client";

import type { Marker } from "maplibre-gl";
import dynamic from "next/dynamic";
import { useCallback, useRef, useState } from "react";
import type { Bounds, MapApi } from "./MapCanvas";

// Punktwahl im Schritt „Ort“ (ADR 016, Review B3, A8). Das Formular schickt `keep`, bis der Nutzer handelt: Klick oder
// Fadenkreuz-Button setzt `set` mit lat/lng, „Punkt entfernen“ setzt `clear`. Der gespeicherte Punkt erscheint nur als
// „So erscheint die Lage öffentlich“ und nie in den Eingabefeldern, sonst verschöbe jedes Speichern ihn erneut.

const MapCanvas = dynamic(() => import("./MapCanvas"), { ssr: false, loading: () => <div className="h-80 w-full rounded bg-stone-100" /> });

export type PickerTexts = {
  label: string;
  attribution: string;
  failed: string;
  setCentre: string;
  remove: string;
  discard: string;
  chosen: string;
  removed: string;
  publicMarker: string;
  chosenMarker: string;
};

export function PointPicker({
  tilesUrl,
  locale,
  bounds,
  publicPoint,
  texts,
}: {
  tilesUrl: string | null;
  locale: string;
  bounds: Bounds;
  publicPoint: { lng: number; lat: number } | null;
  texts: PickerTexts;
}) {
  const api = useRef<MapApi | null>(null);
  const chosenMarker = useRef<Marker | null>(null);
  const [mode, setMode] = useState<"keep" | "set" | "clear">("keep");
  const [chosen, setChosen] = useState<{ lng: number; lat: number } | null>(null);
  const [status, setStatus] = useState("");
  const [ready, setReady] = useState(false);

  const choose = useCallback(
    (lng: number, lat: number) => {
      const current = api.current;
      if (!current) return;
      // 6 Nachkommastellen reichen (etwa 0,1 m); der Punkt rastet ohnehin auf 1 km ein.
      const point = { lng: Number(lng.toFixed(6)), lat: Number(lat.toFixed(6)) };
      chosenMarker.current?.remove();
      const element = document.createElement("div");
      element.className = "map-marker map-chosen";
      element.setAttribute("role", "img");
      element.setAttribute("aria-label", texts.chosenMarker);
      chosenMarker.current = new current.maplibre.Marker({ element }).setLngLat([point.lng, point.lat]).addTo(current.map);
      setChosen(point);
      setMode("set");
      setStatus(texts.chosen);
    },
    [texts.chosen, texts.chosenMarker],
  );

  const onReady = useCallback(
    (ready: MapApi) => {
      api.current = ready;
      if (publicPoint) {
        const element = document.createElement("div");
        element.className = "map-marker";
        element.setAttribute("role", "img");
        element.setAttribute("aria-label", texts.publicMarker);
        new ready.maplibre.Marker({ element }).setLngLat([publicPoint.lng, publicPoint.lat]).addTo(ready.map);
      }
      ready.map.on("click", (event) => choose(event.lngLat.lng, event.lngLat.lat));
      setReady(true);
    },
    [choose, publicPoint, texts.publicMarker],
  );

  function setCentre() {
    const centre = api.current?.map.getCenter();
    if (centre) choose(centre.lng, centre.lat);
  }

  function discard() {
    chosenMarker.current?.remove();
    chosenMarker.current = null;
    setChosen(null);
    setMode("keep");
    setStatus("");
  }

  function remove() {
    discard();
    setMode("clear");
    setStatus(texts.removed);
  }

  return (
    <div id="f-point">
      <input type="hidden" name="point" value={mode} />
      {mode === "set" && chosen && (
        <>
          <input type="hidden" name="lat" value={chosen.lat} />
          <input type="hidden" name="lng" value={chosen.lng} />
        </>
      )}
      <div className="relative">
        <MapCanvas tilesUrl={tilesUrl} locale={locale} bounds={bounds} label={texts.label} attribution={texts.attribution} failedText={texts.failed} maxZoom={13} onReady={onReady} className="h-80 w-full" />
        {/* Fadenkreuz in der Kartenmitte: Mit Pfeiltasten die Karte verschieben, dann den Button nutzen (WCAG 2.1.1). */}
        <span aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-2xl leading-none text-stone-900">
          +
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-3">
        <button type="button" onClick={setCentre} disabled={!ready} className="rounded border border-stone-500 px-3 py-1.5 disabled:opacity-50">{texts.setCentre}</button>
        {mode === "set" && <button type="button" onClick={discard} className="underline">{texts.discard}</button>}
        {(publicPoint || mode === "set") && mode !== "clear" && <button type="button" onClick={remove} className="underline">{texts.remove}</button>}
      </div>
      <p className="mt-1 text-sm" aria-live="polite">{status}</p>
    </div>
  );
}
