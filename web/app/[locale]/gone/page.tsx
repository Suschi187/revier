import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { publicPath } from "@/lib/public/paths";

// Ziel des Proxy-Rewrites für einmal veröffentlichte, jetzt nicht öffentliche Anzeigen und Anbieter (ADR 015):
// Status 410 setzt der Rewrite. Ein Text für jeden Grund, ohne Inhalte.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Public.gone");
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

export default async function GonePage() {
  const [t, locale] = await Promise.all([getTranslations("Public.gone"), getLocale()]);
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="mt-3">{t("text")}</p>
      <a href={publicPath({ route: "search" }, locale as AppLocale)} className="mt-4 inline-block underline">
        {t("toSearch")}
      </a>
    </main>
  );
}
