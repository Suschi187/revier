import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { localeAlternates } from "@/i18n/metadata";
import type { AppLocale } from "@/i18n/routing";

export async function generateMetadata(): Promise<Metadata> {
  const locale = (await getLocale()) as AppLocale;
  const t = await getTranslations("HomePage");
  return {
    title: t("metaTitle"),
    alternates: localeAlternates(locale),
  };
}

export default async function HomePage() {
  const t = await getTranslations("HomePage");
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
      <h1 className="text-3xl font-semibold">{t("title")}</h1>
      <p className="mt-4 text-lg">{t("intro")}</p>
    </main>
  );
}
