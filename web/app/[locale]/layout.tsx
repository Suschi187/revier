import type { Metadata } from "next";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import { locale as rootLocale } from "next/root-params";
import { notFound } from "next/navigation";
import { preload } from "react-dom";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
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
  const fonts = ["montserrat-latin", "inter-latin", ...(locale === "cs" || locale === "pl" ? ["montserrat-latin-ext", "inter-latin-ext"] : [])];
  for (const font of fonts) preload(`/static/fonts/${font}-wght-normal.woff2`, { as: "font", type: "font/woff2", crossOrigin: "anonymous" });

  return (
    <html lang={locale} className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider>
          {/* Sprachwahl und Konto stehen im Kopf hinter Suspense: Bei dynamischen Routen ist der Pfad erst zur Anfrage bekannt. */}
          <SiteHeader />
          {children}
          <SiteFooter />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
