"use client";

import type { GeoJSONSource, Marker, Popup } from "maplibre-gl";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { canonicalBbox } from "@/lib/search/filters";
import type { Bounds, MapApi } from "./MapCanvas";

// Kartenansicht der Listen (ADR 016). MapLibre nur hier und nur bei Bedarf (Review A9). Cluster als Layer,
// Einzelpunkte als HTML-Marker-Buttons (A8, fokussierbar); gleiche Koordinaten öffnen eine Kurzkarte mit allen
// Anzeigen dort. „In diesem Bereich suchen“ setzt bbox in der URL, Liste und Karte filtern dann gleich.

const MapCanvas = dynamic(() => import("./MapCanvas"), { ssr: false, loading: () => <div className="h-[28rem] w-full rounded bg-stone-100" /> });

export type MapTexts = {
  label: string;
  attribution: string;
  failed: string;
  loading: string;
  loadFailed: string;
  retry: string;
  truncated: string;
  searchArea: string;
  searchAreaHint: string;
  stack: string;
  cluster: string;
  close: string;
  count: string;
};

type Item = { id: string; title: string; kind: string; direction: string; price: string; approx: string; href: string };
type Feature = { geometry: { coordinates: [number, number] }; properties: Item };
/** Ein Punkt der Karte: alle Anzeigen mit derselben Koordinate (Kreismittelpunkt, eine Zelle eines Besitzers). */
type Stack = { geometry: { type?: "Point"; coordinates: [number, number] }; properties: { count: number; items: string; label: string } };

/** Gleiche Koordinaten vor dem Clustern bündeln (Review A8): Sonst bleibt ein Stapel ein Cluster, der nie aufgeht. */
function stacks(features: Feature[]): { type: "FeatureCollection"; features: (Stack & { type: "Feature" })[] } {
  const groups = new Map<string, Feature[]>();
  for (const feature of features) {
    const key = feature.geometry.coordinates.join(",");
    groups.set(key, [...(groups.get(key) ?? []), feature]);
  }
  return {
    type: "FeatureCollection",
    features: [...groups.values()].map((group) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: group[0].geometry.coordinates },
      properties: { count: group.length, items: JSON.stringify(group.map((f) => f.properties)), label: group[0].properties.title },
    })),
  };
}

const MAX_MARKERS = 300;

export function ListingsMap({
  tilesUrl,
  locale,
  bounds,
  query,
  path,
  texts,
}: {
  tilesUrl: string | null;
  locale: string;
  bounds: Bounds;
  /** Filter der Seite als Query-String (inklusive Pfadwerte Art und Region), ohne bbox. */
  query: string;
  path: string;
  texts: MapTexts;
}) {
  const router = useRouter();
  const api = useRef<MapApi | null>(null);
  const markers = useRef<Marker[]>([]);
  const popup = useRef<Popup | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed" | "truncated">("loading");
  const [shown, setShown] = useState(0);
  const reducedMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const currentBbox = useCallback((): number[] | undefined => {
    const map = api.current?.map;
    if (!map) return undefined;
    const b = map.getBounds();
    const box = [Math.max(b.getWest(), -180), Math.max(b.getSouth(), -90), Math.min(b.getEast(), 180), Math.min(b.getNorth(), 90)];
    // Höchstens 30° je Achse (Filterformat v1): größere Ausschnitte auf die Mitte begrenzen.
    const clamp = (lo: number, hi: number) => (hi - lo <= 30 ? [lo, hi] : [(lo + hi) / 2 - 15, (lo + hi) / 2 + 15]);
    const [w, e] = clamp(box[0], box[2]);
    const [s, n] = clamp(box[1], box[3]);
    return canonicalBbox([w, s, e, n]);
  }, []);

  const openPopup = useCallback((group: Item[], coordinates: [number, number], trigger: HTMLButtonElement) => {
    const current = api.current;
    if (!current) return;
    popup.current?.remove();
    const box = document.createElement("div");
    box.className = "map-popup";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", group.length > 1 ? texts.stack.replace("{count}", String(group.length)) : group[0].title);
    const list = document.createElement("ul");
    for (const entry of group.slice(0, 20)) {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = entry.href;
      link.textContent = entry.title;
      const meta = document.createElement("p");
      meta.textContent = [entry.kind, entry.direction, entry.price].filter(Boolean).join(" · ");
      const approx = document.createElement("p");
      approx.textContent = entry.approx;
      item.append(link, meta, approx);
      list.append(item);
    }
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = texts.close;
    box.append(list, close);
    const instance = new current.maplibre.Popup({ closeButton: false, closeOnClick: false, maxWidth: "18rem", focusAfterOpen: false })
      .setLngLat(coordinates)
      .setDOMContent(box)
      .addTo(current.map);
    const done = () => {
      instance.remove();
      trigger.focus();
    };
    close.addEventListener("click", done);
    box.addEventListener("keydown", (event) => {
      if (event.key === "Escape") done();
    });
    (box.querySelector("a") as HTMLAnchorElement | null)?.focus();
    popup.current = instance;
  }, [texts.close, texts.stack]);

  const renderMarkers = useCallback(() => {
    const current = api.current;
    if (!current) return;
    const { map, maplibre } = current;
    for (const marker of markers.current) marker.remove();
    markers.current = [];
    // Cluster und Stapel als HTML-Buttons (Review A8): fokussierbar, per Tastatur und im Test bedienbar.
    type Rendered = Stack & { properties: { cluster?: boolean; cluster_id?: number; total?: number } };
    const seen = new Map<string, Rendered>();
    for (const feature of map.queryRenderedFeatures({ layers: ["listings-hidden"] }) as unknown as Rendered[]) {
      const key = feature.properties.cluster ? `c${feature.properties.cluster_id}` : feature.geometry.coordinates.join(",");
      if (!seen.has(key)) seen.set(key, feature);
    }
    if (seen.size > MAX_MARKERS) return;
    for (const feature of seen.values()) {
      const coordinates = feature.geometry.coordinates;
      const button = document.createElement("button");
      button.type = "button";
      if (feature.properties.cluster) {
        const total = feature.properties.total ?? 0;
        button.className = "map-marker map-cluster";
        button.textContent = String(total);
        button.setAttribute("aria-label", texts.cluster.replace("{count}", String(total)));
        button.addEventListener("click", async () => {
          const source = map.getSource("listings") as GeoJSONSource;
          const zoom = await source.getClusterExpansionZoom(feature.properties.cluster_id as number);
          if (reducedMotion) map.jumpTo({ center: coordinates, zoom });
          else map.easeTo({ center: coordinates, zoom });
        });
      } else {
        const items = JSON.parse(feature.properties.items) as Item[];
        const first = items[0];
        button.className = "map-marker";
        button.textContent = items.length > 1 ? String(items.length) : "";
        button.setAttribute(
          "aria-label",
          items.length > 1 ? texts.stack.replace("{count}", String(items.length)) : [first.title, first.kind, first.price].filter(Boolean).join(", "),
        );
        button.addEventListener("click", (event) => {
          // Sonst schließt der Kartenklick die eben geöffnete Kurzkarte.
          event.stopPropagation();
          openPopup(items, coordinates, button);
        });
      }
      markers.current.push(new maplibre.Marker({ element: button }).setLngLat(coordinates).addTo(map));
    }
  }, [openPopup, reducedMotion, texts.cluster, texts.stack]);

  const load = useCallback(async () => {
    const current = api.current;
    const bbox = currentBbox();
    if (!current || !bbox) return;
    setStatus("loading");
    try {
      const params = new URLSearchParams(query);
      params.set("bbox", bbox.join(","));
      params.set("lang", locale);
      const response = await fetch(`/api/map?${params}`, { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      const data = (await response.json()) as { features: Feature[]; truncated: boolean };
      (current.map.getSource("listings") as GeoJSONSource | undefined)?.setData(stacks(data.features) as never);
      setShown(data.features.length);
      setStatus(data.truncated ? "truncated" : "ready");
    } catch {
      setStatus("failed");
    }
  }, [currentBbox, locale, query]);

  const onReady = useCallback(
    ({ map, maplibre }: MapApi) => {
      api.current = { map, maplibre };
      map.addSource("listings", { type: "geojson", data: { type: "FeatureCollection", features: [] }, cluster: true, clusterRadius: 48, clusterMaxZoom: 12,
        clusterProperties: { total: ["+", ["get", "count"]] } });
      // Unsichtbarer Layer, damit die Quelle geladen wird; gezeichnet wird mit HTML-Markern.
      map.addLayer({ id: "listings-hidden", type: "circle", source: "listings", paint: { "circle-opacity": 0, "circle-stroke-opacity": 0, "circle-radius": 6 } });
      // Marker neu zeichnen, wenn die Quelle neue Daten hat oder die Karte sich bewegt hat (ein Frame Verzögerung).
      let frame = 0;
      const schedule = () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(renderMarkers);
      };
      map.on("sourcedata", (event) => {
        if (event.sourceId === "listings" && map.isSourceLoaded("listings")) schedule();
      });
      map.on("moveend", schedule);
      map.on("idle", schedule);
      void load();
    },
    [load, renderMarkers],
  );

  useEffect(
    () => () => {
      popup.current?.remove();
    },
    [],
  );

  function searchArea() {
    const bbox = currentBbox();
    if (!bbox) return;
    const params = new URLSearchParams(query);
    params.set("bbox", bbox.join(","));
    params.set("view", "map");
    router.push(`${path}?${params}`);
  }

  return (
    <section aria-label={texts.label} className="mt-6">
      <MapCanvas tilesUrl={tilesUrl} locale={locale} bounds={bounds} label={texts.label} attribution={texts.attribution} failedText={texts.failed} onReady={onReady} />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button type="button" onClick={searchArea} className="rounded bg-stone-900 px-3 py-1.5 text-white">
          {texts.searchArea}
        </button>
        <p className="text-sm text-stone-700">{texts.searchAreaHint}</p>
      </div>
      <p className="mt-2 text-sm" aria-live="polite">
        {status === "loading" && texts.loading}
        {status === "ready" && texts.count.replace("{count}", String(shown))}
        {status === "truncated" && texts.truncated}
      </p>
      {status === "failed" && (
        <p role="alert" className="mt-2">
          {texts.loadFailed}{" "}
          <button type="button" className="underline" onClick={() => void load()}>
            {texts.retry}
          </button>
        </p>
      )}
    </section>
  );
}
