import type { Metadata } from "next";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { requireSessionUser } from "@/lib/services/auth";
import { myBlocks } from "@/lib/services/chat";
import { unblockUserAction } from "../messages/actions";

// Blockierte Personen (ADR 017, Review H7): Liste mit Rückfallnamen, Entsperren per Formular. Ohne Legal-Gate.
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Chat.blocked");
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function BlockedPage(props: Props) {
  const locale = (await getLocale()) as AppLocale;
  await requireSessionUser(locale, `/${locale}/account/blocked`);
  const [t, tc, format, blocks, query] = await Promise.all([
    getTranslations("Chat.blocked"),
    getTranslations("Chat"),
    getFormatter(),
    myBlocks(),
    props.searchParams,
  ]);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
      <Link href="/account" className="underline">{tc("back")}</Link>
      <h1 className="mt-4 text-3xl font-semibold">{t("title")}</h1>
      <p className="mt-2">{t("intro")}</p>
      {query.notice === "unblocked" && <p className="mt-4" role="status">{tc("notices.unblocked")}</p>}
      {query.notice === "failed" && <p className="mt-4" role="alert">{tc("notices.failed")}</p>}
      {!blocks && <p className="mt-4" role="alert">{tc("loadFailed")}</p>}
      {blocks && blocks.length === 0 && <p className="mt-4">{t("empty")}</p>}
      {blocks && blocks.length > 0 && (
        <ul className="mt-6 grid gap-3">
          {blocks.map((person) => (
            <li key={person.id} className="flex flex-wrap items-center justify-between gap-3 rounded border border-stone-300 p-3">
              <span className="min-w-0">
                <span className="block font-semibold [overflow-wrap:anywhere]">{person.name ?? t("unknown")}</span>
                <span className="block text-sm text-stone-700">{t("since", { date: format.dateTime(new Date(person.since), { dateStyle: "medium" }) })}</span>
              </span>
              <form action={unblockUserAction}>
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="blocked" value={person.id} />
                <button type="submit" className="rounded border border-stone-500 px-3 py-1">{t("unblock")}</button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
