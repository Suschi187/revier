import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { publicEnv } from "@/lib/env";
import { robotsFor, siteIndexable } from "@/lib/public/robots";

// robots.txt (ADR 015): Kein Disallow für /admin, noindex per Meta und Header reicht und verrät den Pfad nicht.
// Zur Anfrage ausgewertet (QA M5 F10): SITE_INDEXABLE ist eine Laufzeit-Variable, ein Artefakt gilt für Stage und Prod.
export default async function robots(): Promise<MetadataRoute.Robots> {
  await connection();
  return robotsFor(siteIndexable(), publicEnv.NEXT_PUBLIC_SITE_URL);
}
