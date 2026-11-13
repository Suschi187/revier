import type { Metadata } from "next";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import { locale as rootLocale } from "next/root-params";
import { notFound } from "next/navigation";
import { preload } from "react-dom";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { OfflineNotice } from "@/components/ui/OfflineNotice";
import { ui } from "@/components/ui/styles";
import { routing } from "@/i18n/routing";
import { publicEnv } from "@/lib/env";
import "../globals.css";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Metadata");
  return {
    metadataBase: new URL(publicEnv.NEXT_PUBLIC_SITE_URL),
    title: { default: t("siteName"), template: `%s | ${t("siteName")}` },
    description: t("siteDescription"),
  };
}

export default async function LocaleLayout({
  children,
}: LayoutProps<"/[locale]">) {
  const locale = await rootLocale();
  if (!hasLocale(routing.locales, locale)) notFound();
  // Schriften vorladen (M10a Schritt 7): Überschriften (Montserrat) und Text (Inter) sind das LCP der Startseite.
  // cs/pl brauchen dazu die Latin-Extended-Dateien; die übrigen lädt der Browser nach unicode-range.
  // Die Teilmenge inter-czech (2 KB) steht wegen „Čeština“ in der Sprachwahl auf jeder Seite (ADR 022, K1).
  // Dateinamen sind versioniert (.v1), weil /static/fonts ein Jahr unveränderlich gecacht wird (ADR 022, S1).
  const fonts = ["montserrat-latin", "inter-latin", "inter-czech", ...(locale === "cs" || locale === "pl" ? ["montserrat-latin-ext", "inter-latin-ext"] : [])];
  const tOffline = await getTranslations("Offline");
  for (const font of fonts) preload(`/static/fonts/${font}-wght-normal.v1.woff2`, { as: "font", type: "font/woff2", crossOrigin: "anonymous" });

  return (
    <html lang={locale} className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider>
          {/* Sprachwahl und Konto stehen im Kopf hinter Suspense: Bei dynamischen Routen ist der Pfad erst zur Anfrage bekannt. */}
          <SiteHeader />
          <OfflineNotice title={tOffline("title")} text={tOffline("text")} className={`${ui.container} mt-3`} />
          {children}
          <SiteFooter />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
