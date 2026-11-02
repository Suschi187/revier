import { getTranslations } from "next-intl/server";
import { routing, type AppLocale } from "@/i18n/routing";
import { priceText } from "@/lib/public/format";
import { publicPath } from "@/lib/public/paths";
import { filtersFromParams } from "@/lib/search/filters";
import { mapPoints } from "@/lib/services/public-listings";

// Kartenpunkte als GeoJSON (ADR 016, Review A5, A6): dieselben Filter wie die Seiten, bbox Pflicht. Ohne Cache
// (freie Bereiche verdrängen jeden Cache, entfernte Anzeigen sollen sofort fehlen) und ohne CORS. Preis und Art
// formatiert der Server in der Sprache der Seite, die Kurzkarte zeigt sie nur an.

const HEADERS = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const lang = url.searchParams.get("lang");
  const locale: AppLocale = routing.locales.includes(lang as AppLocale) ? (lang as AppLocale) : routing.defaultLocale;
  const filters = filtersFromParams(url.searchParams);
  if (!filters.bbox) return Response.json({ error: "invalid", key: "bbox" }, { status: 400, headers: HEADERS });

  const result = await mapPoints(filters);
  if (!result.ok) {
    return result.error === "invalid"
      ? Response.json({ error: "invalid", key: result.key ?? null }, { status: 400, headers: HEADERS })
      : Response.json({ error: "failed" }, { status: 502, headers: HEADERS });
  }
  const t = await getTranslations({ locale, namespace: "Listings" });
  const tm = await getTranslations({ locale, namespace: "Map" });
  return new Response(
    JSON.stringify({
      type: "FeatureCollection",
      truncated: result.truncated,
      features: result.points.map((p) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [p.lng, p.lat] },
        properties: {
          id: p.id,
          title: p.title,
          kind: t(`kinds.${p.kind}`),
          direction: t(`directions.${p.direction}`),
          price:
            priceText({ priceMinor: p.price_minor, currency: p.currency, priceUnit: p.price_unit }, locale, (key) => t(key as never)) ?? "",
          approx: tm(p.approx === "point" ? "approxPoint" : "approxDistrict"),
          href: publicPath({ route: "listing", id: p.id }, locale),
        },
      })),
    }),
    { status: 200, headers: { ...HEADERS, "Content-Type": "application/geo+json" } },
  );
}
