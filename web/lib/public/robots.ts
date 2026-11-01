import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";

/** Nur Prod ist indexierbar (ADR 015, Review A8); sonst Disallow für alles. */
export function robotsFor(indexable: boolean, siteUrl: string): MetadataRoute.Robots {
  if (!indexable) return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: routing.locales.map((locale) => new URL(`/sitemap/${locale}.xml`, siteUrl).toString()),
  };
}

/** Server-Variable der Umgebung, nicht der Host-Header. */
export const siteIndexable = () => process.env.SITE_INDEXABLE === "true";
