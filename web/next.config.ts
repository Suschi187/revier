import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// Basis-Header (docs/adr/002). Eine CSP mit Nonce folgt, sobald Auth und
// Drittanbieter feststehen (M2/M10); HSTS nur in Produktion.
const securityHeaders = [
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
