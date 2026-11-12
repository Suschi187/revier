import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { requireAdmin } from "@/lib/services/admin";
import { findAccountAction } from "./actions";

// Konto suchen (ADR 020): exakte E-Mail oder Konto-ID, per POST mit Limit und Audit (Review A9).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Admin.users");
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

const ERRORS = ["empty", "notFound", "limit", "failed"] as const;

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AdminUsersPage({ searchParams }: Props) {
  const locale = (await getLocale()) as AppLocale;
  await requireAdmin(locale, `/${locale}/admin/users`);
  const [t, query] = await Promise.all([getTranslations("Admin.users"), searchParams]);
  const error = ERRORS.find((e) => e === query.error);
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
      <Link href="/admin" className="underline">{t("back")}</Link>
      <h1 className="mt-4 text-3xl font-semibold">{t("title")}</h1>
      <p className="mt-2 text-sm text-stone-700">{t("intro")}</p>
      {error && <p role="alert" id="u-error" className="mt-4 text-red-800">{t(`errors.${error}`)}</p>}
      <form action={findAccountAction} className="mt-6 flex flex-col gap-2">
        <input type="hidden" name="locale" value={locale} />
        <label htmlFor="u-query" className="font-medium">{t("query")}</label>
        <input id="u-query" name="query" type="text" required autoComplete="off" maxLength={320} aria-describedby={error ? "u-error" : undefined}
          className="rounded border border-stone-400 px-3 py-2" />
        <button type="submit" className="self-start rounded bg-stone-900 px-4 py-2 text-white">{t("search")}</button>
      </form>
    </main>
  );
}
