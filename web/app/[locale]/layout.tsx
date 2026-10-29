import type { Metadata } from "next";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import { locale as rootLocale } from "next/root-params";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AuthNav } from "@/components/auth/AuthNav";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { SiteFooter } from "@/components/SiteFooter";
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

  return (
    <html lang={locale} className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider>
          <header className="flex flex-wrap items-center justify-end gap-4 p-4">
            {/* Suspense: Bei dynamischen Routen (z. B. /account/listings/[id]) ist der Pfad erst zur Anfrage bekannt. */}
            <Suspense fallback={null}>
              <LocaleSwitcher />
            </Suspense>
            <Suspense fallback={null}>
              <AuthNav />
            </Suspense>
          </header>
          {children}
          <SiteFooter />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
