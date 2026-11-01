import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { publicEnv } from "./lib/env";
import { buildCsp } from "./lib/security/csp";

// Basis-Header (docs/adr/002) und feste CSP (docs/adr/010); HSTS nur in Produktion.
const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: buildCsp({
      supabaseUrl: publicEnv.NEXT_PUBLIC_SUPABASE_URL,
      dev: process.env.NODE_ENV !== "production",
      https: publicEnv.NEXT_PUBLIC_SITE_URL.startsWith("https://"),
    }),
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]
    : []),
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  // Öffentliche Anzeigendaten (ADR 015, Review B3): höchstens 5 Minuten alt, über alle Instanzen. `expire`
  // begrenzt auch das Ausliefern veralteter Einträge (stale-while-revalidate); das Preset `minutes` hätte 1 h.
  cacheLife: {
    publicListings: { stale: 60, revalidate: 60, expire: 300 },
  },
  partialPrefetching: true,
  poweredByHeader: false,
  // Den Schrägstrich am Ende entfernt der Proxy selbst (308), damit dort auch X-Robots-Tag greift (QA M5 N1).
  skipTrailingSlashRedirect: true,
  // Nur `next dev`: 127.0.0.1 ist wie localhost ein erlaubter Auth-Host (config.toml). Ohne den Eintrag
  // lehnt Next die HMR-Verbindung ab, und der Browser versucht sie endlos neu („Compiling“).
  allowedDevOrigins: ["127.0.0.1"],
  experimental: {
    // Eine 404 für die ganze App, nötig weil das Root-Layout unter [locale] liegt.
    globalNotFound: true,
    // forbidden() für den Admin-Bereich (403, ADR 014).
    authInterrupts: true,
  },
  async headers() {
    return [
      // /admin bekommt seine CSP mit Nonce aus dem Proxy (ADR 014); die übrigen Header gelten überall.
      { source: "/((?!(?:de|en|cs|pl)/admin(?:/|$)).*)", headers: securityHeaders },
      // `:path*` deckt auch /:locale/admin selbst ab.
      { source: "/:locale/admin/:path*", headers: securityHeaders.filter((h) => h.key !== "Content-Security-Policy") },
      // Token im Query-String nie per Referer weitergeben (ADR 010).
      { source: "/:locale/auth/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

const withNextIntl = createNextIntlPlugin();

export default withNextIntl(nextConfig);
