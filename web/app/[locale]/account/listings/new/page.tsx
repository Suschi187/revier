import type { Metadata } from "next";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { BasicsStep, CountrySwitch, DistrictSelect } from "@/components/listings/steps/BasicsStep";
import { ErrorSummary, StepNav } from "@/components/listings/WizardChrome";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { parseErrorCodes } from "@/lib/listing-wizard";
import { requireOnboardedUser } from "@/lib/services/gate";
import { getOwnProfile } from "@/lib/services/profile";
import { LISTING_COUNTRIES, listRegions } from "@/lib/services/regions";
import { createListing } from "./actions";

// Inhalt ohne Suspense-Grenze statt Hülle plus Stream: Gestreamte Inhalte setzt erst ein Inline-Skript ein,
// ohne JavaScript blieben Formulare unsichtbar (QA M3 F1). Der Assistent muss bis auf den Foto-Upload ohne JS
// gehen. `instant = false` erlaubt das Lesen der Session außerhalb einer Grenze; den Status bestimmt es nicht.
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Listings.wizard");
  return { title: t("newMetaTitle"), robots: { index: false, follow: false } };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function NewListingPage({ searchParams }: { searchParams: SearchParams }) {
  const t = await getTranslations("Listings.wizard");
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-12">
      <Link href="/account/listings" className="underline">
        {t("back")}
      </Link>
      <h1 className="mt-4 text-3xl font-semibold">{t("newTitle")}</h1>
      <NewListing searchParams={searchParams} />
    </main>
  );
}

async function NewListing({ searchParams }: { searchParams: SearchParams }) {
  const locale = (await getLocale()) as AppLocale;
  const user = await requireOnboardedUser(locale, `/${locale}/account/listings/new`);
  const [params, profile, t, format] = await Promise.all([searchParams, getOwnProfile(user.id), getTranslations("Listings"), getFormatter()]);
  const requested = LISTING_COUNTRIES.find((c) => c === params.country);
  const fromProfile = LISTING_COUNTRIES.find((c) => c === profile?.country);
  const country = requested ?? fromProfile ?? "DE";
  const regions = await listRegions(country, locale);
  const errors = parseErrorCodes(params.errors);
  const retry = typeof params.retry === "string" && !Number.isNaN(Date.parse(params.retry)) ? new Date(params.retry) : null;

  return (
    <>
      <StepNav listingId={null} current="basics" />
      <p className="mt-4 text-sm text-stone-700">{t("wizard.draftHint")}</p>
      {params.error === "rateLimited" && (
        <p role="alert" className="mt-6 rounded bg-red-50 p-3 text-red-800">
          {retry ? t("errors.rateLimited", { time: format.dateTime(retry, { dateStyle: "medium", timeStyle: "short" }) }) : t("errors.rateLimitedNoTime")}
        </p>
      )}
      <ErrorSummary codes={errors} listingId={null} current="basics" />
      <CountrySwitch country={country} countries={LISTING_COUNTRIES} hidden={{}} />
      <BasicsStep
        locale={locale}
        action={createListing}
        listingId={null}
        values={{ kind: null, direction: null, title: "", contentLanguage: locale }}
        errors={errors}
        district={<DistrictSelect states={regions.states} districts={regions.districts} selected={null} errors={errors} />}
      />
    </>
  );
}
