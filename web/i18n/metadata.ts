import type { Metadata } from "next";
import { routing, type AppLocale } from "./routing";

/** Canonical und hreflang-Alternativen für einen Pfad ohne Sprachpräfix. */
export function localeAlternates(
  locale: AppLocale,
  path = "",
): Metadata["alternates"] {
  const languages = Object.fromEntries(
    routing.locales.map((l) => [l, `/${l}${path}`]),
  );
  return {
    canonical: `/${locale}${path}`,
    languages: { ...languages, "x-default": `/${routing.defaultLocale}${path}` },
  };
}
