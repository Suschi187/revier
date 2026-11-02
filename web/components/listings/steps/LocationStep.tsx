import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import type { PostalCodeOption, Region } from "@/lib/services/regions";
import type { ListingDirection } from "@/lib/validation/listing";
import { buttonClass, describedBy, FieldError, inputClass, labelClass } from "../WizardChrome";
import { DistrictSelect } from "./BasicsStep";
import { PointPicker } from "@/components/map/PointPicker";
import type { Bounds } from "@/lib/map/bounds";

/**
 * Kreis, PLZ und Ort (ADR 012). Vorschläge kommen aus allen PLZ des gewählten Kreises, auf einmal geladen
 * (keine Abfrage einzelner PLZ). Bei Angeboten Pflicht, bei Gesuchen das gesuchte Gebiet und optional.
 */
export async function LocationStep({
  locale,
  action,
  listingId,
  direction,
  regions,
  regionId,
  postalCodes,
  place,
  point,
  errors,
}: {
  locale: AppLocale;
  action: (form: FormData) => Promise<void>;
  listingId: string;
  direction: ListingDirection;
  regions: { states: Region[]; districts: Region[] };
  regionId: string | null;
  postalCodes: PostalCodeOption[];
  place: { postalCode: string | null; placeName: string | null } | null;
  /** Punktwahl (ADR 016); null ohne Kreis bzw. in einem anderen Land. */
  point: { tilesUrl: string | null; bounds: Bounds; small: boolean; publicPoint: { lng: number; lat: number } | null; otherPoints: number } | null;
  errors: string[];
}) {
  const [t, tm] = await Promise.all([getTranslations("Listings"), getTranslations("Map.picker")]);
  const offer = direction === "offer";
  const placeNames = [...new Set(postalCodes.flatMap((p) => p.places))].sort((a, b) => a.localeCompare(b, locale));
  const mismatch = errors.some((c) => c === "place.postal_code.region_mismatch" || c === "place.postal_code.unknown");

  return (
    <form action={action} className="mt-6 flex flex-col gap-6">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="id" value={listingId} />
      <input type="hidden" name="step" value="location" />

      <DistrictSelect states={regions.states} districts={regions.districts} selected={regionId} errors={errors} />

      <p id="f-place-private" className="rounded bg-stone-100 p-3 text-sm">
        {t("fields.placePrivate")}
      </p>

      <div>
        <label htmlFor="f-postal" className={labelClass}>
          {offer ? t("fields.postalCode") : t("fields.postalCodeWanted")}
        </label>
        <input
          id="f-postal"
          name="postalCode"
          defaultValue={place?.postalCode ?? ""}
          required={offer}
          inputMode="numeric"
          autoComplete="off"
          list="postal-codes"
          maxLength={6}
          className={inputClass}
          {...describedBy(errors, "f-postal", "f-place-private f-postal-source")}
        />
        <datalist id="postal-codes">
          {postalCodes.map((p) => (
            <option key={p.code} value={p.code}>
              {p.places.join(", ")}
            </option>
          ))}
        </datalist>
        <FieldError codes={errors} fieldId="f-postal" />
        {mismatch && (
          <p className="text-sm">
            {t("fields.postalCodeReport")}{" "}
            <Link href="/imprint" className="underline">
              {t("fields.postalCodeReportLink")}
            </Link>
          </p>
        )}
        <p id="f-postal-source" className="mt-1 text-xs text-stone-700">
          {t("fields.postalCodeSource")}{" "}
          <a href="https://www.openstreetmap.org/copyright" className="underline" rel="noopener noreferrer" target="_blank">
            openstreetmap.org/copyright
          </a>
        </p>
      </div>

      <div>
        <label htmlFor="f-place" className={labelClass}>
          {offer ? t("fields.placeName") : t("fields.placeNameWanted")}
        </label>
        <input
          id="f-place"
          name="placeName"
          defaultValue={place?.placeName ?? ""}
          required={offer}
          maxLength={100}
          autoComplete="off"
          list="place-names"
          className={inputClass}
          {...describedBy(errors, "f-place", "f-place-private")}
        />
        <datalist id="place-names">
          {placeNames.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <FieldError codes={errors} fieldId="f-place" />
      </div>

      {point && (
        <fieldset className="flex flex-col gap-2" aria-describedby="f-point-hint">
          <legend className={labelClass}>{tm("legend")}</legend>
          <p id="f-point-hint" className="rounded bg-stone-100 p-3 text-sm">{tm("hint")}</p>
          {point.small ? (
            <p className="text-sm">{t("fieldErrors.place_point_small_district")}</p>
          ) : (
            <>
              {point.otherPoints > 0 && <p className="rounded border border-amber-600 bg-amber-50 p-3 text-sm">{tm("otherPoints")}</p>}
              <p className="text-sm text-stone-700">{tm("districtChange")}</p>
              <noscript>
                <p className="text-sm">{tm("noscript")}</p>
              </noscript>
              <PointPicker
                tilesUrl={point.tilesUrl}
                locale={locale}
                bounds={point.bounds}
                publicPoint={point.publicPoint}
                texts={{
                  label: tm("label"),
                  attribution: (await getTranslations("Map")).raw("attribution") as string,
                  failed: (await getTranslations("Map"))("failed"),
                  setCentre: tm("setCentre"),
                  remove: tm("remove"),
                  discard: tm("discard"),
                  chosen: tm("chosen"),
                  removed: tm("removed"),
                  publicMarker: tm("publicMarker"),
                  chosenMarker: tm("chosenMarker"),
                }}
              />
              <FieldError codes={errors} fieldId="f-point" />
            </>
          )}
        </fieldset>
      )}

      <button type="submit" className={buttonClass}>
        {t("wizard.save")}
      </button>
    </form>
  );
}
