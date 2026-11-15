import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { requireAdmin } from "@/lib/services/admin";
import { findAccountAction } from "./actions";
import { ui } from "@/components/ui/styles";

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
    <main id="main" className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6">
      <Link href="/admin" className="text-sm underline underline-offset-2">← {t("back")}</Link>
      <h1 className="mt-4 font-display text-2xl font-extrabold uppercase leading-tight [overflow-wrap:anywhere] hyphens-auto sm:text-3xl">{t("title")}</h1>
      <p className="mt-2 text-sm text-muted">{t("intro")}</p>
      {error && <p role="alert" id="u-error" className="mt-4 text-error">{t(`errors.${error}`)}</p>}
      <form action={findAccountAction} className="mt-6 flex flex-col gap-2">
        <input type="hidden" name="locale" value={locale} />
        <label htmlFor="u-query" className="font-semibold">{t("query")}</label>
        <input id="u-query" name="query" type="text" required autoComplete="off" maxLength={320} aria-describedby={error ? "u-error" : undefined}
          className={ui.input} />
        <button type="submit" className={`self-start ${ui.btnDark}`}>{t("search")}</button>
      </form>
    </main>
  );
}
