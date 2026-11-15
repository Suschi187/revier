import type { Metadata } from "next";
import { Suspense } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { DeletedNotice } from "@/components/account/DeletedNotice";
import { KindIcon } from "@/components/brand/KindIcon";
import { Icon } from "@/components/ui/Icon";
import { ui } from "@/components/ui/styles";
import { Link } from "@/i18n/navigation";
import { JsonLd } from "@/components/public/JsonLd";
import { ListingList } from "@/components/public/ListingCard";
import { publicAlternates } from "@/i18n/metadata";
import type { AppLocale } from "@/i18n/routing";
import { absoluteUrl } from "@/lib/public/json-ld";
import { publicPath } from "@/lib/public/paths";
import { favoriteContext } from "@/lib/services/favorites";
import { cachedListings, cacheEpoch } from "@/lib/services/public-listings";
import { regionNames } from "@/lib/services/regions";
import { LISTING_KINDS } from "@/lib/validation/listing";

// Ohne Suspense-Grenze: Gestreamte Inhalte setzt erst ein Inline-Skript ein, ohne JavaScript (und für
// einfache Crawler) fehlten die Anzeigen sonst im HTML (QA M3 F1). `instant = false` erlaubt das Lesen
// des Cache-Zählers außerhalb einer Grenze; den Status bestimmt es nicht.
export const instant = false;

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
  const [result, regions, favorites] = await Promise.all([
    cachedListings({ v: 1 }, NEWEST, epoch),
    regionNames(locale),
    favoriteContext(publicPath({ route: "home" }, locale)),
  ]);
  if (!result.ok) return <p className="mt-4" role="alert">{t("newestError")}</p>;
  return <ListingList items={result.page.items} locale={locale} regions={regions} empty={t("newestEmpty")} favorites={favorites} layout="grid" />;
}

/** Höhenlinien als dezentes Muster im Banner (eigene Zeichnung, docs/DESIGN.md 7). */
function Contours() {
  return (
    <svg aria-hidden="true" viewBox="0 0 1200 260" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 size-full opacity-20">
      <g fill="none" stroke="var(--color-sand)">
        <path d="M600 260 C 640 180, 820 150, 900 200 S 1100 260, 1200 230" />
        <path d="M560 260 C 600 150, 830 100, 920 170 S 1110 230, 1200 190" />
        <path d="M520 260 C 560 120, 840 50, 940 140 S 1120 200, 1200 150" />
        <path d="M880 120 C 900 100, 950 100, 960 120 S 930 150, 905 145 S 870 140, 880 120" />
      </g>
    </svg>
  );
}

export default async function HomePage() {
  const locale = (await getLocale()) as AppLocale;
  const [t, th, tl, tc, tb, ta] = await Promise.all([
    getTranslations("Public.home"),
    getTranslations("HomePage"),
    getTranslations("Listings"),
    getTranslations("Profile.countries"),
    getTranslations("Brand"),
    getTranslations("AccountDelete"),
  ]);
  const searchPath = publicPath({ route: "search" }, locale);
  const trust = [
    ["shield", "trustVerified"],
    ["lock", "trustLocation"],
    ["flag", "trustReview"],
  ] as const;

  return (
    <main id="main" className={`${ui.container} flex flex-1 flex-col gap-10 py-6 sm:gap-12`}>
      <Suspense fallback={null}>
        <DeletedNotice text={ta("deletedNotice")} />
      </Suspense>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: (await getTranslations("Metadata"))("siteName"),
          url: absoluteUrl(publicPath({ route: "home" }, locale)),
          inLanguage: locale,
          potentialAction: {
            "@type": "SearchAction",
            target: `${absoluteUrl(searchPath)}?q={search_term_string}`,
            "query-input": "required name=search_term_string",
          },
        }}
      />

      {/* Name per aria-label statt versteckter H2: sonst stünde für VoiceOver eine H2 vor der H1 (axe heading-order). */}
      <nav aria-label={t("kindsHeading")}>
        <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          {LISTING_KINDS.map((kind) => (
            <li key={kind}>
              <a href={publicPath({ route: "kind", kind }, locale)}
                className={`${ui.card} flex h-full flex-col items-center gap-2.5 px-2.5 py-4 text-center font-semibold text-forest no-underline hover:border-forest`}>
                <span className="flex size-14 items-center justify-center rounded-full bg-sand"><KindIcon kind={kind} /></span>
                <span className="[overflow-wrap:anywhere] hyphens-auto">{tl(`kinds.${kind}`)}</span>
              </a>
            </li>
          ))}
          <li>
            <a href={searchPath} className={`${ui.card} flex h-full flex-col items-center gap-2.5 px-2.5 py-4 text-center font-semibold text-forest no-underline hover:border-forest`}>
              <span className="flex size-14 items-center justify-center rounded-full bg-sand"><Icon name="search" size={28} /></span>
              <span>{t("allListings")}</span>
            </a>
          </li>
        </ul>
      </nav>

      <section aria-labelledby="home-title" className="on-dark relative flex min-h-64 items-center overflow-hidden rounded-card bg-forest text-offwhite">
        <Contours />
        <div className="relative max-w-2xl px-6 py-9 sm:px-10">
          <p className="mb-2.5 font-display text-meta font-bold uppercase tracking-eyebrow text-brand">{tb("tagline")}</p>
          <h1 id="home-title" className={`${ui.headingCaps} text-4xl leading-none tracking-tight sm:text-5xl`}>{th("title")}</h1>
          <p className="mb-6 mt-3 text-lg leading-relaxed">{t("heroText")}</p>
          <Link href="/account/listings/new" prefetch={false} className={ui.btnPrimary}>
            {t("heroCta")}
            <Icon name="arrow" size={16} />
          </Link>
        </div>
      </section>

      <section aria-labelledby="home-newest">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="home-newest" className={`${ui.headingCaps} text-2xl`}>{t("newestHeading")}</h2>
          <a href={searchPath} className={ui.link}>{t("allListings")} →</a>
        </div>
        <Newest locale={locale} />
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <section aria-labelledby="home-countries" className={`${ui.card} px-6 py-5`}>
          <h2 id="home-countries" className={`${ui.headingCaps} mb-3 text-lg`}>{t("countriesHeading")}</h2>
          <ul className="grid grid-cols-2 gap-x-4">
            {COUNTRIES.map(({ code, live }) => (
              <li key={code}>
                {live ? (
                  <a href={`${searchPath}?country=${code}`} className="block py-2 text-forest underline underline-offset-2">{tc(code)}</a>
                ) : (
                  <span className="block py-2 text-muted">{t("countrySoon", { country: tc(code) })}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="home-trust" className="rounded-card bg-sand px-6 py-5">
          <h2 id="home-trust" className={`${ui.headingCaps} mb-3 text-lg`}>{t("trustHeading")}</h2>
          <ul className="flex flex-col gap-3">
            {trust.map(([icon, key]) => (
              <li key={key} className="flex gap-2.5"><Icon name={icon} size={22} className="shrink-0" />{t(key)}</li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
