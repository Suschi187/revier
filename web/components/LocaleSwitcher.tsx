"use client";

import NextLink from "next/link";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { routing, type AppLocale } from "@/i18n/routing";
import { switchLocaleHref } from "@/lib/public/locale-switch";
import { parsePath } from "@/lib/public/paths";

function linkProps(locale: AppLocale, current: AppLocale) {
  return {
    lang: locale,
    hrefLang: locale,
    "aria-current": locale === current ? ("page" as const) : undefined,
    // py-1.5 wie der Shop-Link: Tippfläche 32 px statt 20 px (WCAG 2.5.8, mindestens 24 px).
    className: `inline-block py-1.5 ${locale === current ? "font-semibold" : "underline"}`,
  };
}

/**
 * Öffentliche Seiten haben übersetzte URL-Wörter (ADR 015): Das Ziel kommt aus dem Pfad-Parser, Filter im
 * Query-String bleiben erhalten. Alle anderen Seiten tauschen nur das Sprachpräfix.
 */
export function LocaleSwitcher() {
  const t = useTranslations("LocaleSwitcher");
  const current = useLocale() as AppLocale;
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const full = `/${current}${pathname === "/" ? "" : pathname}`;
  const parsed = parsePath(full);

  return (
    <nav aria-label={t("label")}>
      <ul className="flex gap-3 text-sm">
        {routing.locales.map((locale) => (
          <li key={locale}>
            {parsed.type === "public" ? (
              <NextLink href={switchLocaleHref(full, searchParams.toString(), locale)} {...linkProps(locale, current)}>
                {t(`names.${locale}`)}
              </NextLink>
            ) : (
              <Link href={pathname} locale={locale} {...linkProps(locale, current)}>
                {t(`names.${locale}`)}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * Platzhalter der Suspense-Grenze, ohne Pfad und Query: Er steht immer im ersten HTML. Kommt die Sprachwahl nur
 * gestreamt (ohne JavaScript verborgen), wechseln diese Links über `/api/locale` und den Referer trotzdem auf
 * die passende Seite. Mit JavaScript ersetzt die Sprachwahl oben den Platzhalter.
 */
export function LocaleSwitcherFallback() {
  const t = useTranslations("LocaleSwitcher");
  const current = useLocale() as AppLocale;

  return (
    <nav aria-label={t("label")}>
      <ul className="flex gap-3 text-sm">
        {routing.locales.map((locale) => (
          <li key={locale}>
            <a href={`/api/locale?to=${locale}`} rel="nofollow" {...linkProps(locale, current)}>
              {t(`names.${locale}`)}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
