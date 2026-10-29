"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { routing } from "@/i18n/routing";
import { isAppLocale } from "@/lib/auth/paths";
import { attributesFromForm, isWizardStep, nextStep, parseHectares, PRICE_UNITS, type WizardStep } from "@/lib/listing-wizard";
import { requireOnboardedUser } from "@/lib/services/gate";
import {
  getOwnListing,
  setLocation,
  setSpecies,
  submitListing,
  updateListing,
  type ListingError,
  type Result,
} from "@/lib/services/listings";
import { removePhoto, reorderPhotos, setAltText } from "@/lib/services/photos";
import { getRegionCountry, listPostalCodes } from "@/lib/services/regions";
import { ALT_TEXT_MAX, DESCRIPTION_MAX, LISTING_DIRECTIONS, LISTING_KINDS, POSTAL_CODE_FORMAT, titleSchema } from "@/lib/validation/listing";
import { parsePrice } from "@/lib/validation/price";
import { Constants } from "@/lib/supabase/database.types";

// Speichern je Schritt des Assistenten (Plan M3 7). Die DB entscheidet über Rechte und Regeln; hier werden
// Eingaben umgewandelt und Fehler als Feldcodes in die URL zurückgegeben (keine Eingabewerte in der URL).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const text = (form: FormData, name: string) => String(form.get(name) ?? "");
const optionalDate = z.union([z.literal(""), z.iso.date()]);

export async function saveListingStep(form: FormData): Promise<void> {
  const rawLocale = text(form, "locale");
  const locale = isAppLocale(rawLocale) ? rawLocale : "de";
  const id = text(form, "id");
  const step = text(form, "step");
  const path = `/${locale}/account/listings/${UUID.test(id) ? id : ""}/edit`;
  const user = await requireOnboardedUser(locale, path);
  if (!UUID.test(id) || !isWizardStep(step)) redirect(`/${locale}/account/listings?error=failed`);

  // Explizit `never`, damit TypeScript nach einem Rücksprung den Typ einengt.
  const back: (codes: string[]) => never = (codes) => redirect(`${path}?step=${step}&errors=${codes.join(",")}#error-summary`);
  const handle: (result: Result<unknown>, target?: WizardStep) => never = (result, target = nextStep(step)) => {
    if (result.ok) redirect(`${path}?step=${target}&saved=1`);
    const error: ListingError = result.error;
    if (error.kind === "legal") redirect(`/${locale}/welcome?next=${encodeURIComponent(path)}`);
    if (error.kind === "fields") back(error.fields);
    if (error.kind === "notFound") redirect(`/${locale}/account/listings?error=failed`);
    back(["form"]);
  };

  const listing = await getOwnListing(user.id, id);
  if (!listing) redirect(`/${locale}/account/listings?error=failed`);

  switch (step) {
    case "basics": {
      const parsed = z
        .object({
          kind: z.enum(LISTING_KINDS),
          direction: z.enum(LISTING_DIRECTIONS),
          title: titleSchema,
          contentLanguage: z.enum(routing.locales),
        })
        .safeParse({ kind: form.get("kind"), direction: form.get("direction"), title: text(form, "title"), contentLanguage: form.get("contentLanguage") });
      if (!parsed.success) back(parsed.error.issues.some((i) => i.path[0] === "title") ? ["title"] : ["form"]);
      const changedKind = parsed.data.kind !== listing.kind;
      // Bei einer anderen Art passen die bisherigen Angaben nicht mehr (Attribute je Art, ADR 013).
      return handle(await updateListing(id, { ...parsed.data, ...(changedKind ? { attributes: {}, areaHectares: null } : {}) }));
    }
    case "location": {
      const regionId = text(form, "regionId");
      if (!UUID.test(regionId)) back(["district"]);
      const postalCode = text(form, "postalCode").trim() || null;
      const placeName = text(form, "placeName").trim() || null;
      const country = await getRegionCountry(regionId);
      if (!country) back(["district"]);
      if (postalCode) {
        if (!POSTAL_CODE_FORMAT[country].test(postalCode)) back(["postal_format"]);
        const codes = await listPostalCodes(regionId);
        if (!codes.some((c) => c.code === postalCode)) back(["place.postal_code.region_mismatch"]);
      }
      return handle(await setLocation(id, regionId, postalCode, placeName));
    }
    case "details": {
      const description = text(form, "description");
      if (description.length > DESCRIPTION_MAX) back(["description.length"]);
      const { attributes, error } = attributesFromForm(listing.kind, form);
      if (error) back([error]);
      let areaHectares: number | null = listing.areaHectares;
      if (listing.kind === "lease") {
        const area = parseHectares(text(form, "areaHectares"));
        if (!area.ok) back(["area_invalid"]);
        areaHectares = area.value;
      }
      const species = form.getAll("species").map(String).filter((code) => /^[a-z_]{1,40}$/.test(code));
      // Wildarten zuerst: So bleibt eine eingereichte Anzeige zwischen den Requests bereit.
      const speciesResult = await setSpecies(id, species);
      if (!speciesResult.ok) return handle(speciesResult);
      return handle(await updateListing(id, { description, attributes, areaHectares }));
    }
    case "price": {
      const mode = text(form, "priceMode");
      const dates = z.object({ start: optionalDate, end: optionalDate }).safeParse({ start: text(form, "startDate"), end: text(form, "endDate") });
      if (!dates.success) back(["dates"]);
      const startDate = dates.data.start || null;
      const endDate = dates.data.end || null;
      if (startDate && endDate && endDate < startDate) back(["dates"]);
      if (mode === "amount") {
        const currency = z.enum(Constants.public.Enums.currency_code).safeParse(form.get("currency"));
        const unit = z.enum(PRICE_UNITS).safeParse(form.get("priceUnit"));
        if (!currency.success || !unit.success) back(["form"]);
        const price = parsePrice(text(form, "amount"), currency.data);
        if (!price.ok) back([`price_${price.error}`]);
        return handle(await updateListing(id, { priceMinor: price.minor, currency: currency.data, priceUnit: unit.data, startDate, endDate }));
      }
      const onRequest = mode === "on_request";
      return handle(await updateListing(id, { priceMinor: null, currency: null, priceUnit: onRequest ? "on_request" : null, startDate, endDate }));
    }
    case "preview": {
      const result = await submitListing(id);
      if (result.ok) redirect(`/${locale}/account/listings?notice=submitted`);
      return handle(result, "preview");
    }
  }
}

/** Foto-Aktionen im Schritt „Fotos“: Alt-Text, nach vorn/hinten, entfernen (ADR 011). */
export async function changePhoto(form: FormData): Promise<void> {
  const rawLocale = text(form, "locale");
  const locale = isAppLocale(rawLocale) ? rawLocale : "de";
  const id = text(form, "id");
  const path = `/${locale}/account/listings/${UUID.test(id) ? id : ""}/edit`;
  const user = await requireOnboardedUser(locale, path);
  const photoId = text(form, "photoId");
  if (!UUID.test(id) || !UUID.test(photoId)) redirect(`/${locale}/account/listings?error=failed`);

  const listing = await getOwnListing(user.id, id);
  const photo = listing?.photos.find((p) => p.id === photoId);
  if (!listing || !photo) redirect(`${path}?step=photos&photoError=failed`);

  let result: "ok" | "failed" = "failed";
  const op = text(form, "op");
  if (op === "alt") {
    const altText = text(form, "altText").trim();
    result = altText.length > ALT_TEXT_MAX ? "failed" : await setAltText(photo.id, altText || null);
  } else if (op === "up" || op === "down") {
    const order = listing.photos.map((p) => p.id);
    const from = order.indexOf(photo.id);
    const to = op === "up" ? from - 1 : from + 1;
    if (to >= 0 && to < order.length) {
      [order[from], order[to]] = [order[to], order[from]];
      result = await reorderPhotos(listing.id, order);
    }
  } else if (op === "remove") {
    result = await removePhoto(listing.id, photo);
  }
  redirect(`${path}?step=photos&${result === "ok" ? `photoNotice=${op}` : "photoError=failed"}`);
}
