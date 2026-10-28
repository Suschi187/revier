import { defineRouting } from "next-intl/routing";

// Siehe docs/adr/003-i18n-routing.md: Präfix immer in der URL, Default de.
export const routing = defineRouting({
  locales: ["de", "en", "cs", "pl"],
  defaultLocale: "de",
  localePrefix: "always",
});

export type AppLocale = (typeof routing.locales)[number];
