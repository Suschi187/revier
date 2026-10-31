import type { Metadata } from "next";
import { publicPaths, type PublicRoute } from "@/lib/public/paths";
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

/**
 * Öffentliche Seiten mit übersetzten URL-Wörtern (ADR 015): Canonical auf sich selbst, hreflang auf die
 * Pfade aus dem Parser. Nur für indexierbare Seiten ohne Query; Seiten mit Query bekommen keine Alternativen.
 */
export function publicAlternates(locale: AppLocale, page: PublicRoute): Metadata["alternates"] {
  const paths = publicPaths(page);
  return {
    canonical: paths[locale],
    languages: { ...paths, "x-default": paths[routing.defaultLocale] },
  };
}
