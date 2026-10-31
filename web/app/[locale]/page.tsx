import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { ListingList } from "@/components/public/ListingCard";
import { publicAlternates } from "@/i18n/metadata";
import type { AppLocale } from "@/i18n/routing";
import { publicPath } from "@/lib/public/paths";
import { cachedListings, cacheEpoch } from "@/lib/services/public-listings";
import { regionNames } from "@/lib/services/regions";
import { LISTING_KINDS } from "@/lib/validation/listing";

const NEWEST = 8;
// Länder mit Regionsdaten (ADR 007); die übrigen Märkte folgen mit ihren Kreisen.
const COUNTRIES = [
  { code: "DE", live: true },
  { code: "AT", live: true },
  { code: "CH", live: false },
  { code: "CZ", live: false },
  { code: "PL", live: false },
] as const;

export async function generateMetadata(): Promise<Metadata> {
  const locale = (await getLocale()) as AppLocale;
  const t = await getTranslations();
  return {
    // Das Titel-Template des Layouts greift im selben Segment nicht (QA M0 F5).
    title: { absolute: `${t("HomePage.metaTitle")} | ${t("Metadata.siteName")}` },
    description: t("Metadata.siteDescription"),
    alternates: publicAlternates(locale, { route: "home" }),
  };
}

async function Newest({ locale }: { locale: AppLocale }) {
  const t = await getTranslations("Public.home");
  const epoch = await cacheEpoch();
  const [result, regions] = await Promise.all([cachedListings({ v: 1 }, NEWEST, epoch), regionNames(locale)]);
  if (!result.ok) return <p className="mt-4" role="alert">{t("newestError")}</p>;
  return <ListingList items={result.page.items} locale={locale} regions={regions} empty={t("newestEmpty")} />;
}

export default async function HomePage() {
  const locale = (await getLocale()) as AppLocale;
  const [t, th, tl, tc] = await Promise.all([
    getTranslations("Public.home"),
    getTranslations("HomePage"),
    getTranslations("Listings"),
    getTranslations("Profile.countries"),
  ]);
  const searchPath = publicPath({ route: "search" }, locale);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
      <h1 className="text-3xl font-semibold">{th("title")}</h1>
      <p className="mt-4 text-lg">{th("intro")}</p>

      <form action={searchPath} method="get" role="search" className="mt-6 flex flex-wrap gap-2">
        <label htmlFor="home-q" className="sr-only">
          {t("searchLabel")}
        </label>
        <input id="home-q" name="q" type="search" maxLength={200} placeholder={t("searchPlaceholder")}
          className="min-w-0 flex-1 rounded border border-stone-400 px-3 py-2" />
        <button type="submit" className="rounded bg-stone-900 px-4 py-2 text-white">
          {t("searchButton")}
        </button>
      </form>

      <section aria-labelledby="home-kinds" className="mt-10">
        <h2 id="home-kinds" className="text-xl font-semibold">{t("kindsHeading")}</h2>
        <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {LISTING_KINDS.map((kind) => (
            <li key={kind}>
              <a href={publicPath({ route: "kind", kind }, locale)} className="block rounded border border-stone-300 px-4 py-3 underline-offset-2 hover:underline focus-visible:underline">
                {tl(`kinds.${kind}`)}
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="home-countries" className="mt-10">
        <h2 id="home-countries" className="text-xl font-semibold">{t("countriesHeading")}</h2>
        <ul className="mt-3 flex flex-wrap gap-3">
          {COUNTRIES.map(({ code, live }) => (
            <li key={code}>
              {live ? (
                <a href={`${searchPath}?country=${code}`} className="underline">{tc(code)}</a>
              ) : (
                <span className="text-stone-700">{t("countrySoon", { country: tc(code) })}</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="home-newest" className="mt-10">
        <h2 id="home-newest" className="text-xl font-semibold">{t("newestHeading")}</h2>
        <Suspense fallback={<p className="mt-4" aria-busy="true">{t("loading")}</p>}>
          <Newest locale={locale} />
        </Suspense>
        <p className="mt-4">
          <a href={searchPath} className="underline">{t("allListings")}</a>
        </p>
      </section>
    </main>
  );
}
