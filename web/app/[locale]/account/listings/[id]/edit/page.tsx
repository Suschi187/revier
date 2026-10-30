import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { BasicsStep, CountrySwitch } from "@/components/listings/steps/BasicsStep";
import { DetailsStep } from "@/components/listings/steps/DetailsStep";
import { LocationStep } from "@/components/listings/steps/LocationStep";
import { PhotosStep } from "@/components/listings/steps/PhotosStep";
import { PreviewStep } from "@/components/listings/steps/PreviewStep";
import { PriceStep } from "@/components/listings/steps/PriceStep";
import { ModerationNote } from "@/components/listings/ModerationNote";
import { ErrorSummary, StepNav } from "@/components/listings/WizardChrome";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { DEFAULT_CURRENCY, isWizardStep, parseErrorCodes, TYPE_LOCKED, type WizardStep } from "@/lib/listing-wizard";
import { requireOnboardedUser } from "@/lib/services/gate";
import { getContentHints, getOwnListing } from "@/lib/services/listings";
import { thumbnailUrls } from "@/lib/services/photos";
import { LISTING_COUNTRIES, listPostalCodes, listRegions, listSpecies } from "@/lib/services/regions";
import { listingReadiness } from "@/lib/validation/listing";
import { changePhoto, saveListingStep } from "./actions";

// Blockierend rendern statt Hülle plus Stream: Gestreamte Inhalte setzt erst ein Inline-Skript ein, ohne
// JavaScript blieben Formulare unsichtbar (QA M3 F1). Der Assistent muss bis auf den Foto-Upload ohne JS gehen.
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Listings.wizard");
  return { title: t("editMetaTitle"), robots: { index: false, follow: false } };
}

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function EditListingPage(props: Props) {
  const t = await getTranslations("Listings.wizard");
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-12">
      <Link href="/account/listings" className="underline">
        {t("back")}
      </Link>
      <h1 className="mt-4 text-3xl font-semibold">{t("editTitle")}</h1>
      <EditListing {...props} />
    </main>
  );
}

const PHOTO_NOTICES = ["alt", "up", "down", "remove"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function EditListing({ params, searchParams }: Props) {
  const locale = (await getLocale()) as AppLocale;
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const user = await requireOnboardedUser(locale, `/${locale}/account/listings/${UUID.test(id) ? `${id}/edit` : ""}`);
  if (!UUID.test(id)) notFound();
  const listing = await getOwnListing(user.id, id);
  if (!listing) notFound();

  const t = await getTranslations("Listings");
  const step: WizardStep = isWizardStep(query.step) ? query.step : "basics";
  const errors = parseErrorCodes(query.errors);

  if (listing.status === "removed") {
    return <p className="mt-6 rounded bg-red-50 p-3 text-red-800">{t("wizard.lockedNote")}</p>;
  }

  return (
    <>
      <StepNav listingId={listing.id} current={step} />
      <ModerationNote status={listing.status} code={listing.rejectCode} note={listing.rejectReason} className="mt-4 rounded bg-red-50 p-3" />
      {(listing.status === "active" || listing.status === "paused") && (
        <p className="mt-4 rounded bg-amber-50 p-3 text-amber-950">{t("wizard.publishedNote")}</p>
      )}
      {query.saved === "1" && errors.length === 0 && (
        <p role="status" className="mt-4 text-emerald-800">
          {t("wizard.saved")}
        </p>
      )}
      <ErrorSummary codes={errors} listingId={listing.id} current={step} />
      {step === "photos" && PHOTO_NOTICES.includes(query.photoNotice as (typeof PHOTO_NOTICES)[number]) && (
        <p role="status" className="mt-4 text-emerald-800">
          {t(`photos.notices.${query.photoNotice as (typeof PHOTO_NOTICES)[number]}`)}
        </p>
      )}
      {step === "photos" && query.photoError === "failed" && (
        <p role="alert" className="mt-4 text-red-800">
          {t("errors.failed")}
        </p>
      )}
      <Step step={step} locale={locale} listing={listing} errors={errors} country={query.country} />
    </>
  );
}

async function Step({ step, locale, listing, errors, country }: {
  step: WizardStep;
  locale: AppLocale;
  listing: NonNullable<Awaited<ReturnType<typeof getOwnListing>>>;
  errors: string[];
  country: string | string[] | undefined;
}) {
  switch (step) {
    case "basics":
      return (
        <BasicsStep
          locale={locale}
          action={saveListingStep}
          listingId={listing.id}
          values={{ kind: listing.kind, direction: listing.direction, title: listing.title, contentLanguage: listing.contentLanguage }}
          errors={errors}
          typeLocked={TYPE_LOCKED.includes(listing.status)}
        />
      );
    case "location": {
      const chosen = LISTING_COUNTRIES.find((c) => c === country) ?? LISTING_COUNTRIES.find((c) => c === listing.country) ?? "DE";
      const [regions, postalCodes] = await Promise.all([listRegions(chosen, locale), chosen === listing.country ? listPostalCodes(listing.regionId) : []]);
      return (
        <>
          <CountrySwitch country={chosen} countries={LISTING_COUNTRIES} hidden={{ step: "location" }} />
          <LocationStep
            locale={locale}
            action={saveListingStep}
            listingId={listing.id}
            direction={listing.direction}
            regions={regions}
            regionId={chosen === listing.country ? listing.regionId : null}
            postalCodes={postalCodes}
            place={listing.place}
            errors={errors}
          />
        </>
      );
    }
    case "details": {
      const species = await listSpecies(locale);
      return (
        <DetailsStep
          locale={locale}
          action={saveListingStep}
          listingId={listing.id}
          kind={listing.kind}
          description={listing.description}
          areaHectares={listing.areaHectares}
          attributes={listing.attributes}
          species={species}
          selectedSpecies={listing.species}
          errors={errors}
        />
      );
    }
    case "photos": {
      const thumbnails = await thumbnailUrls(listing.photos);
      return <PhotosStep locale={locale} action={changePhoto} listingId={listing.id} title={listing.title} photos={listing.photos} thumbnails={thumbnails} />;
    }
    case "price":
      return (
        <PriceStep
          locale={locale}
          action={saveListingStep}
          listingId={listing.id}
          priceMinor={listing.priceMinor}
          currency={listing.currency}
          priceUnit={listing.priceUnit}
          defaultCurrency={DEFAULT_CURRENCY[listing.country]}
          startDate={listing.startDate}
          endDate={listing.endDate}
          errors={errors}
        />
      );
    case "preview": {
      const [regions, species, postalCodes, hints] = await Promise.all([
        listRegions(listing.country, locale),
        listSpecies(locale),
        listPostalCodes(listing.regionId),
        getContentHints(listing.id),
      ]);
      const codes = new Set(postalCodes.map((p) => p.code));
      // Vorabprüfung wie in der DB; verbindlich entscheidet das Absenden.
      const missing = listingReadiness({
        kind: listing.kind,
        direction: listing.direction,
        description: listing.description,
        areaHectares: listing.areaHectares,
        attributes: listing.attributes,
        speciesCount: listing.species.length,
        place: listing.place,
        postalStatus: (code) => (codes.has(code) ? "match" : "mismatch"),
        unprocessedPhotos: listing.photos.some((p) => !p.processed),
        today: new Date().toISOString().slice(0, 10),
      });
      return (
        <PreviewStep
          locale={locale}
          action={saveListingStep}
          listing={listing}
          district={regions.districts.find((d) => d.id === listing.regionId) ?? null}
          species={species}
          missing={missing}
          hints={hints}
        />
      );
    }
  }
}
