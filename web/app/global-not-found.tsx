import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LogoMark } from "@/components/brand/Logo";
import { ui } from "@/components/ui/styles";
import { routing } from "@/i18n/routing";
import "./globals.css";

// Einzige 404 der App (QA M0 F2, F6). Läuft ohne Root-Layout und ohne Anfragedaten, damit sie
// statisch und vollständig serverseitig ausgeliefert wird. Deshalb mehrsprachig: ein Abschnitt
// je Sprache mit eigenem lang-Attribut, die Default-Locale zuerst.

export const metadata: Metadata = {
  title: "404 | Revier",
};

export default async function GlobalNotFound() {
  const sections = await Promise.all(
    routing.locales.map(async (locale) => {
      const t = await getTranslations({ locale, namespace: "NotFound" });
      return { locale, title: t("title"), backHome: t("backHome") };
    }),
  );
  // Ohne Root-Layout auch ohne SiteFooter: Rechtliches hier in der Default-Locale (QA M2 F3).
  const legal = await getTranslations({ locale: routing.defaultLocale, namespace: "Legal" });
  const legalLinks = (["imprint", "privacy", "terms"] as const).map((page) => ({
    href: `/${routing.defaultLocale}/${page}`,
    label: legal(`${page}.title`),
  }));

  return (
    <html lang={routing.defaultLocale} className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-offwhite text-forest">
        <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
          <div className={`${ui.card} flex flex-col items-center px-5 py-10 text-center sm:px-10`}>
          <a href={`/${routing.defaultLocale}`} aria-label="Huntroy">
            <LogoMark size={48} />
          </a>
          <p className="mt-3 font-display text-6xl font-extrabold leading-none text-brand-ink" aria-hidden="true">
            404
          </p>
          {sections.map(({ locale, title, backHome }, index) => (
            <section key={locale} lang={locale} className={index === 0 ? "mt-4" : "mt-6 w-full border-t border-sand pt-5"}>
              {index === 0 ? (
                <h1 className={`${ui.headingCaps} text-2xl leading-tight [overflow-wrap:anywhere] hyphens-auto sm:text-3xl`}>{title}</h1>
              ) : (
                <h2 className="font-display text-lg font-bold">{title}</h2>
              )}
              <a href={`/${locale}`} hrefLang={locale} className={index === 0 ? `mt-4 ${ui.btnPrimary}` : `mt-2 inline-block ${ui.link}`}>
                {backHome}
              </a>
            </section>
          ))}
          </div>
        </main>
        <footer className="on-dark mt-auto bg-forest p-4 text-offwhite">
          <nav aria-label={legal("footerLabel")}>
            <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              {legalLinks.map(({ href, label }) => (
                <li key={href}>
                  <a href={href} className="underline">
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </footer>
      </body>
    </html>
  );
}
