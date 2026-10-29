import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import type { OwnPhoto } from "@/lib/services/listings";
import { ALT_TEXT_MAX, MAX_PHOTOS } from "@/lib/validation/listing";
import { PhotoUploader } from "../PhotoUploader";
import { buttonClass, inputClass } from "../WizardChrome";

/**
 * Fotos (ADR 011): Hochladen im Browser, Reihenfolge per Tastatur (Nach vorn/Nach hinten), optionaler
 * Alt-Text je Foto (Fallback ist der Titel), Entfernen. Alles bis auf das Hochladen geht ohne JavaScript.
 */
export async function PhotosStep({
  locale,
  action,
  listingId,
  title,
  photos,
  thumbnails,
}: {
  locale: AppLocale;
  action: (form: FormData) => Promise<void>;
  listingId: string;
  title: string;
  photos: OwnPhoto[];
  thumbnails: Record<string, string>;
}) {
  const t = await getTranslations("Listings");
  const used = new Set(photos.map((p) => p.sortOrder));
  const freeSlots = Array.from({ length: MAX_PHOTOS }, (_, i) => i).filter((i) => !used.has(i));
  const hidden = (photo: OwnPhoto, op: string) => (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="id" value={listingId} />
      <input type="hidden" name="photoId" value={photo.id} />
      <input type="hidden" name="op" value={op} />
    </>
  );

  return (
    <div className="mt-6 flex flex-col gap-6" id="f-photos">
      <PhotoUploader listingId={listingId} freeSlots={freeSlots} />
      <noscript>
        <p className="text-sm">{t("photos.noscript")}</p>
      </noscript>

      {photos.length === 0 ? (
        <p>{t("photos.empty")}</p>
      ) : (
        <ol className="flex flex-col gap-4">
          {photos.map((photo, index) => {
            const label = t("photos.photoLabel", { n: index + 1, total: photos.length });
            return (
              <li key={photo.id} className="flex flex-col gap-3 rounded border border-stone-300 p-3 sm:flex-row">
                <div className="w-full shrink-0 sm:w-40">
                  {thumbnails[photo.id] ? (
                    // eslint-disable-next-line @next/next/no-img-element -- signierte URL aus privatem Bucket, kein Optimizer
                    <img src={thumbnails[photo.id]} alt={photo.altText ?? title} className="aspect-[4/3] w-full rounded object-cover" />
                  ) : (
                    <p className="flex aspect-[4/3] items-center justify-center rounded bg-stone-100 p-2 text-center text-sm">
                      {t("photos.unprocessed")}
                    </p>
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-2">
                  <p className="font-medium">{label}</p>
                  {photo.processed && (
                    <form action={action} className="flex flex-col gap-1">
                      {hidden(photo, "alt")}
                      <label htmlFor={`alt-${photo.id}`} className="text-sm font-medium">
                        {t("photos.altText")}
                      </label>
                      <input
                        id={`alt-${photo.id}`}
                        name="altText"
                        defaultValue={photo.altText ?? ""}
                        maxLength={ALT_TEXT_MAX}
                        aria-describedby={`alt-${photo.id}-hint`}
                        className={inputClass}
                      />
                      <p id={`alt-${photo.id}-hint`} className="text-xs text-stone-700">
                        {t("photos.altTextHint")}
                      </p>
                      <button type="submit" className="self-start rounded border border-stone-400 px-3 py-1.5 text-sm">
                        {t("photos.saveAltText")}
                      </button>
                    </form>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {index > 0 && (
                      <form action={action}>
                        {hidden(photo, "up")}
                        <button type="submit" className="rounded border border-stone-400 px-3 py-1.5 text-sm">
                          {t("photos.moveUp")}
                          <span className="sr-only">: {label}</span>
                        </button>
                      </form>
                    )}
                    {index < photos.length - 1 && (
                      <form action={action}>
                        {hidden(photo, "down")}
                        <button type="submit" className="rounded border border-stone-400 px-3 py-1.5 text-sm">
                          {t("photos.moveDown")}
                          <span className="sr-only">: {label}</span>
                        </button>
                      </form>
                    )}
                    <form action={action}>
                      {hidden(photo, "remove")}
                      <button type="submit" className="rounded border border-red-700 px-3 py-1.5 text-sm text-red-800">
                        {t("photos.remove")}
                        <span className="sr-only">: {label}</span>
                      </button>
                    </form>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <Link href={`/account/listings/${listingId}/edit?step=price`} className={buttonClass}>
        {t("wizard.continue")}
      </Link>
    </div>
  );
}
