import { defineRouting } from "next-intl/routing";

// Siehe docs/adr/003-i18n-routing.md: Präfix immer in der URL, Default de.
export const routing = defineRouting({
  locales: ["de", "en", "cs", "pl"],
  defaultLocale: "de",
  localePrefix: "always",
  // hreflang kommt ausschließlich aus den Metadaten (absolut über NEXT_PUBLIC_SITE_URL).
  // Der Link-Header der Middleware würde den Host aus der Anfrage übernehmen (QA M0 F1).
  alternateLinks: false,
});

export type AppLocale = (typeof routing.locales)[number];
