import type { Metadata } from "next";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import { locale as rootLocale } from "next/root-params";
import { notFound } from "next/navigation";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { routing } from "@/i18n/routing";
import "../globals.css";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Metadata");
  return {
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
          <header className="flex justify-end p-4">
            <LocaleSwitcher />
          </header>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
