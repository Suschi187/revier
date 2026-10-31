"use client";

import NextLink from "next/link";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { routing, type AppLocale } from "@/i18n/routing";
import { hasFilterQuery, parsePath, publicPath } from "@/lib/public/paths";

/**
 * Öffentliche Seiten haben übersetzte URL-Wörter (ADR 015): Das Ziel kommt aus dem Pfad-Parser, Filter im
 * Query-String bleiben erhalten. Alle anderen Seiten tauschen nur das Sprachpräfix.
 */
export function LocaleSwitcher() {
  const t = useTranslations("LocaleSwitcher");
  const current = useLocale() as AppLocale;
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const parsed = parsePath(`/${current}${pathname === "/" ? "" : pathname}`);

  return (
    <nav aria-label={t("label")}>
      <ul className="flex gap-3 text-sm">
        {routing.locales.map((locale) => {
          const props = {
            lang: locale,
            hrefLang: locale,
            "aria-current": locale === current ? ("page" as const) : undefined,
            className: locale === current ? "font-semibold" : "underline",
          };
          if (parsed.type === "public") {
            const query = hasFilterQuery(parsed.page) ? searchParams.toString() : "";
            const href = publicPath(parsed.page, locale) + (query ? `?${query}` : "");
            return (
              <li key={locale}>
                <NextLink href={href} {...props}>
                  {t(`names.${locale}`)}
                </NextLink>
              </li>
            );
          }
          return (
            <li key={locale}>
              <Link href={pathname} locale={locale} {...props}>
                {t(`names.${locale}`)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
