import type { MetadataRoute } from "next";
import { publicEnv } from "@/lib/env";
import { robotsFor, siteIndexable } from "@/lib/public/robots";

// robots.txt (ADR 015): Kein Disallow für /admin, noindex per Meta und Header reicht und verrät den Pfad nicht.
export default function robots(): MetadataRoute.Robots {
  return robotsFor(siteIndexable(), publicEnv.NEXT_PUBLIC_SITE_URL);
}
