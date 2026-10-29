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
  partialPrefetching: true,
  poweredByHeader: false,
  experimental: {
    // Eine 404 für die ganze App, nötig weil das Root-Layout unter [locale] liegt.
    globalNotFound: true,
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
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
