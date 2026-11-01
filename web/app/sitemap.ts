import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { routing, type AppLocale } from "@/i18n/routing";
import { sitemapFor } from "@/lib/services/sitemap";

// Eine Sitemap je Sprache unter /sitemap/{locale}.xml (ADR 015). Erzeugt zur Anfrage, nicht beim Build
// (connection), die Daten kommen aus dem Cache (Profil hours).
export async function generateSitemaps() {
  return routing.locales.map((id) => ({ id }));
}

export default async function sitemap(props: { id: Promise<string> }): Promise<MetadataRoute.Sitemap> {
  await connection();
  const id = await props.id;
  if (!routing.locales.includes(id as AppLocale)) return [];
  return sitemapFor(id as AppLocale);
}
