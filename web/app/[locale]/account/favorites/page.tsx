import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { ListingList } from "@/components/public/ListingCard";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { favoritesOverview } from "@/lib/services/favorites";
import { requireOnboardedUser } from "@/lib/services/gate";
import { regionNames } from "@/lib/services/regions";
import { removeUnavailableFavorites } from "./actions";

// Gemerkte Anzeigen (ADR 015, Review A10). Ohne Suspense, damit die Liste ohne JavaScript sichtbar ist.
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Favorites");
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function FavoritesPage(props: Props) {
  const locale = (await getLocale()) as AppLocale;
  const path = `/${locale}/account/favorites`;
  const user = await requireOnboardedUser(locale, path);
  const [t, overview, regions, query] = await Promise.all([
    getTranslations("Favorites"),
    favoritesOverview(),
    regionNames(locale),
    props.searchParams,
  ]);
  const unavailable = overview?.unavailable ?? 0;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
      <Link href="/account" className="underline">{t("back")}</Link>
      <h1 className="mt-4 text-3xl font-semibold">{t("title")}</h1>
      {query.notice === "removed" && <p className="mt-4" role="status">{t("removedNotice")}</p>}
      {(query.error === "failed" || query.error === "limit") && <p className="mt-4" role="alert">{t(query.error)}</p>}
      {overview ? (
        <ListingList
          items={overview.items}
          locale={locale}
          regions={regions}
          empty={t("empty")}
          favorites={{ ids: new Set(overview.items.map((card) => card.id)), signedIn: true, userId: user.id, back: path }}
        />
      ) : (
        <p className="mt-4" role="alert">{t("loadFailed")}</p>
      )}
      {unavailable > 0 && (
        <form action={removeUnavailableFavorites} className="mt-6 flex flex-wrap items-center gap-3 rounded border border-stone-300 p-3">
          <input type="hidden" name="locale" value={locale} />
          <p>{t("unavailable", { count: unavailable })}</p>
          <button type="submit" className="rounded border border-stone-500 px-3 py-1">{t("removeUnavailable")}</button>
        </form>
      )}
    </main>
  );
}
