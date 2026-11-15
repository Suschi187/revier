"use client";

import { LogoMark } from "@/components/brand/Logo";
import { ui } from "@/components/ui/styles";
import { routing } from "@/i18n/routing";
import { GLOBAL_ERROR_TEXTS } from "@/lib/i18n/global-error-texts";
import "./globals.css";

// 500 im Root-Layout (M10). Ersetzt das Layout ganz: eigenes html/body, eigene Styles, kein next-intl. Die Sprache
// ist hier unbekannt, deshalb wie global-not-found ein Abschnitt je Sprache, die Default-Locale zuerst.
// Keine Fehlerdetails, nur die Fehlernummer (`digest`) für den Abgleich mit den Server-Logs.
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const first = GLOBAL_ERROR_TEXTS[routing.defaultLocale];
  return (
    <html lang={routing.defaultLocale} className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-offwhite text-forest">
        <title>{`500 | Huntery`}</title>
        <main id="main" className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
          <div className={`${ui.card} flex flex-col items-center px-5 py-10 text-center sm:px-10`}>
            <LogoMark size={48} />
            <p aria-hidden="true" className="mt-3 font-display text-6xl font-extrabold leading-none text-brand-ink">500</p>
            {routing.locales.map((locale, index) => {
              const t = GLOBAL_ERROR_TEXTS[locale];
              return (
                <section key={locale} lang={locale} className={index === 0 ? "mt-4" : "mt-6 w-full border-t border-sand pt-5"}>
                  {index === 0 ? (
                    <h1 className={`${ui.headingCaps} text-2xl leading-tight [overflow-wrap:anywhere] hyphens-auto sm:text-3xl`}>{t.title}</h1>
                  ) : (
                    <h2 className="font-display text-lg font-bold">{t.title}</h2>
                  )}
                  <p className="mt-2">{t.text}</p>
                  {index === 0 ? (
                    <div className="mt-4 flex flex-wrap justify-center gap-3">
                      <button type="button" onClick={() => retry()} className={ui.btnPrimary}>{t.retry}</button>
                      <a href={`/${locale}`} hrefLang={locale} className={ui.btnSecondary}>{t.backHome}</a>
                    </div>
                  ) : (
                    <a href={`/${locale}`} hrefLang={locale} className={`mt-2 inline-block ${ui.link}`}>{t.backHome}</a>
                  )}
                </section>
              );
            })}
            {error.digest && <p className="mt-6 text-meta text-muted">{first.digest.replace("{digest}", error.digest)}</p>}
          </div>
        </main>
      </body>
    </html>
  );
}
