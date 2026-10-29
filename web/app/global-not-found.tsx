import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
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
      <body className="min-h-full flex flex-col">
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
          <p className="text-5xl font-semibold" aria-hidden="true">
            404
          </p>
          {sections.map(({ locale, title, backHome }, index) => (
            <section key={locale} lang={locale} className="mt-8">
              {index === 0 ? (
                <h1 className="text-2xl font-semibold">{title}</h1>
              ) : (
                <h2 className="text-xl font-semibold">{title}</h2>
              )}
              <a href={`/${locale}`} hrefLang={locale} className="mt-2 inline-block underline">
                {backHome}
              </a>
            </section>
          ))}
        </main>
        <footer className="mt-auto border-t border-neutral-300 p-4">
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
