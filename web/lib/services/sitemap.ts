import "server-only";
import type { MetadataRoute } from "next";
import { cacheLife, cacheTag } from "next/cache";
import { routing, type AppLocale } from "@/i18n/routing";
import { absoluteUrl } from "@/lib/public/json-ld";
import { publicPaths, type PublicRoute } from "@/lib/public/paths";
import { regionByCode } from "@/lib/public/regions";
import { anonClient } from "@/lib/supabase/anon";
import { LISTING_KINDS } from "@/lib/validation/listing";
import { PUBLIC_TAGS } from "./public-listings";

// Sitemap je Sprache (ADR 015, Review A8): nur über den Anon-Client, also nie Unveröffentlichtes. Startseite,
// Kategorien und Regionen mit Anzeigen, aktive Anzeigen, Profile gewerblicher Anbieter. Ohne Suche, Konto,
// Admin, leere Seiten und Profile von Privatpersonen. Jede URL prüft beim Aufruf selbst, daher `hours`.

const MAX_URLS = 45_000;

type Entry = { page: PublicRoute; lastModified?: string };

async function entries(): Promise<Entry[]> {
  "use cache";
  cacheLife("hours");
  cacheTag(PUBLIC_TAGS.all);
  const client = anonClient();
  const [listings, providers, ...counts] = await Promise.all([
    client.from("listings").select("id, approved_at").order("approved_at", { ascending: false }).limit(MAX_URLS),
    client.from("public_profiles").select("user_id").eq("account_type", "business").limit(MAX_URLS),
    ...LISTING_KINDS.map((kind) => client.rpc("listing_region_counts", { p_kind: kind })),
  ]);
  const result: Entry[] = [{ page: { route: "home" } }];
  LISTING_KINDS.forEach((kind, i) => {
    const rows = counts[i].data ?? [];
    if (rows.length === 0) return;
    result.push({ page: { route: "kind", kind } });
    for (const row of rows) {
      const ref = regionByCode(row.region_code);
      if (!ref) continue;
      result.push({
        page: ref.level === "state" ? { route: "state", kind, state: ref.slug } : { route: "district", kind, state: ref.stateSlug, district: ref.slug },
      });
    }
  });
  for (const l of listings.data ?? []) result.push({ page: { route: "listing", id: l.id }, lastModified: l.approved_at ?? undefined });
  for (const p of providers.data ?? []) if (p.user_id) result.push({ page: { route: "provider", id: p.user_id } });
  return result.slice(0, MAX_URLS);
}

export async function sitemapFor(locale: AppLocale): Promise<MetadataRoute.Sitemap> {
  return (await entries()).map(({ page, lastModified }) => {
    const paths = publicPaths(page);
    return {
      url: absoluteUrl(paths[locale]),
      ...(lastModified ? { lastModified } : {}),
      alternates: {
        languages: Object.fromEntries([...routing.locales.map((l) => [l, absoluteUrl(paths[l])]), ["x-default", absoluteUrl(paths[routing.defaultLocale])]]),
      },
    };
  });
}
