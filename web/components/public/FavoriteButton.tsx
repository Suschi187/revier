import { getTranslations } from "next-intl/server";
import { toggleFavorite } from "@/app/[locale]/account/favorites/actions";
import type { AppLocale } from "@/i18n/routing";

/**
 * Merken (ADR 015, Review A10): mit Login ein POST-Formular mit `aria-pressed`, ohne Login ein Link zum Login mit
 * Rücksprung (gemerkt wird erst danach per Klick). Feste Breite gegen Layoutsprünge.
 */
export async function FavoriteButton({
  listingId,
  active,
  signedIn,
  back,
  locale,
  title,
}: {
  listingId: string;
  active: boolean;
  signedIn: boolean;
  back: string;
  locale: AppLocale;
  title: string;
}) {
  const t = await getTranslations("Favorites");
  const className = "inline-flex min-w-28 justify-center rounded border border-stone-500 px-3 py-1 text-sm";
  if (!signedIn) {
    return (
      <a href={`/${locale}/login?next=${encodeURIComponent(back)}`} className={className} aria-label={t("saveLabel", { title })}>
        {t("save")}
      </a>
    );
  }
  return (
    <form action={toggleFavorite}>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="id" value={listingId} />
      <input type="hidden" name="back" value={back} />
      <input type="hidden" name="op" value={active ? "remove" : "add"} />
      <button type="submit" aria-pressed={active} aria-label={t("saveLabel", { title })} className={className}>
        {active ? t("saved") : t("save")}
      </button>
    </form>
  );
}
