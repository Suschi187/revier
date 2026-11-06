import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { parseToken } from "@/lib/unsubscribe/token";

// Bestätigungsseite zum Abbestellen (ADR 018, Review A6): öffentlich, ohne Login. Ein GET ändert nichts und ruft die
// DB nicht auf (Linkscanner, kein Orakel). Der Button sendet das Formular an POST /api/unsubscribe (auch ohne
// JavaScript); die Route antwortet mit einer lokalisierten Bestätigung. Der Token steht nur im versteckten Feld.
// noindex, no-referrer und no-store setzt zusätzlich der Proxy als Header. Ohne Suspense, damit es ohne JS geht.
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Unsubscribe");
  return { title: t("metaTitle"), robots: { index: false, follow: false }, referrer: "no-referrer" };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function UnsubscribePage(props: Props) {
  const locale = (await getLocale()) as AppLocale;
  const [t, query] = await Promise.all([getTranslations("Unsubscribe"), props.searchParams]);
  const token = parseToken(query.t);

  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 py-12">
      <h1 className="text-3xl font-semibold">{t("title")}</h1>
      {token ? (
        <form action="/api/unsubscribe" method="post" className="mt-4 grid gap-4">
          <input type="hidden" name="lang" value={locale} />
          <input type="hidden" name="t" value={token} />
          <p>{t("intro")}</p>
          <button type="submit" className="justify-self-start rounded bg-stone-900 px-4 py-2 text-white">{t("submit")}</button>
        </form>
      ) : (
        <p role="alert" className="mt-4">{t("missing")}</p>
      )}
      <div className="mt-6">
        <p>{t("settings")}</p>
        <ul className="mt-2 list-disc ps-5">
          <li><a href={`/${locale}/account/searches`} className="underline">{t("searches")}</a></li>
          <li><a href={`/${locale}/account/profile`} className="underline">{t("profile")}</a></li>
        </ul>
      </div>
    </main>
  );
}
