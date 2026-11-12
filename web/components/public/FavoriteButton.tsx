import { getTranslations } from "next-intl/server";
import { toggleFavorite } from "@/app/[locale]/account/favorites/actions";
import type { AppLocale } from "@/i18n/routing";
import { Icon } from "@/components/ui/Icon";
import { safeNextPath } from "@/lib/auth/paths";

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
  variant = "button",
}: {
  listingId: string;
  active: boolean;
  signedIn: boolean;
  back: string;
  locale: AppLocale;
  title: string;
  /** `icon`: runder Knopf auf dem Anzeigenfoto, Zustand über Füllung und `aria-pressed`. */
  variant?: "button" | "icon";
}) {
  const t = await getTranslations("Favorites");
  const className =
    variant === "icon"
      ? "flex size-11 items-center justify-center rounded-full border border-sand bg-offwhite text-forest hover:bg-sand"
      : "inline-flex min-h-11 min-w-28 items-center justify-center gap-2 rounded-btn border border-forest bg-surface px-3 text-sm font-semibold text-forest hover:bg-sand";
  const content = (filled: boolean, label: string) => (
    <>
      <Icon name="bookmark" size={18} className={filled ? "fill-current" : undefined} />
      {variant === "button" && label}
    </>
  );
  if (!signedIn) {
    return (
      // Ohne Suchtext im Login-Link (H10, QA M5 F9).
      <a href={`/${locale}/login?next=${encodeURIComponent(safeNextPath(back, locale))}`} className={className} aria-label={t("saveLabel", { title })}>
        {content(false, t("save"))}
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
        {content(active, active ? t("saved") : t("save"))}
      </button>
    </form>
  );
}
