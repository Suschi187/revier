import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { localeAlternates } from "@/i18n/metadata";
import type { AppLocale } from "@/i18n/routing";

// Datenquellen (ADR 007, 012, 016; Review H5): Pflichtvermerke der Referenz- und Kartendaten. Kein Rechtstext,
// deshalb indexierbar. Neue Quellen kommen hier und in die SOURCES.md des Datensatzes.

const SOURCES = [
  { id: "osm", url: "https://www.openstreetmap.org/copyright", license: "https://opendatacommons.org/licenses/odbl/1-0/" },
  { id: "protomaps", url: "https://protomaps.com", license: "https://github.com/protomaps/basemaps/blob/main/LICENSE.md" },
  { id: "bkg", url: "https://gdz.bkg.bund.de", license: "https://www.govdata.de/dl-de/by-2-0" },
  { id: "statistikAustria", url: "https://www.statistik.at", license: "https://creativecommons.org/licenses/by/4.0/" },
  { id: "fonts", url: "https://github.com/protomaps/basemaps-assets", license: "https://openfontlicense.org" },
] as const;

export async function generateMetadata(): Promise<Metadata> {
  const locale = (await getLocale()) as AppLocale;
  const t = await getTranslations("Sources");
  return { title: t("title"), description: t("intro"), alternates: localeAlternates(locale, "/sources") };
}

export default async function SourcesPage() {
  const t = await getTranslations("Sources");
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
      <h1 className="text-3xl font-semibold">{t("title")}</h1>
      <p className="mt-4">{t("intro")}</p>
      {SOURCES.map((source) => (
        <section key={source.id} className="mt-8">
          <h2 className="text-xl font-semibold">{t(`items.${source.id}.title`)}</h2>
          <p className="mt-2">{t(`items.${source.id}.usage`)}</p>
          <p className="mt-2 font-medium">{t(`items.${source.id}.notice`)}</p>
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <a href={source.url} className="underline" rel="noopener noreferrer">
              {t("website")}
            </a>
            <a href={source.license} className="underline" rel="license noopener noreferrer">
              {t("licenseLink", { license: t(`items.${source.id}.license`) })}
            </a>
          </p>
        </section>
      ))}
      <section className="mt-10">
        <h2 className="text-xl font-semibold">{t("postal.title")}</h2>
        <p className="mt-2">{t("postal.text")}</p>
        <p className="mt-2">
          <a href="/api/sources/postal-codes" className="underline" download>
            {t("postal.download")}
          </a>
        </p>
      </section>
    </main>
  );
}
