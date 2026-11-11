import type { Metadata } from "next";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { deletionPending } from "@/lib/services/account";
import { requireSessionUser } from "@/lib/services/auth";

// Datenexport (ADR 019): Formular an POST /api/account/export, ohne JavaScript nutzbar. requireSessionUser statt
// requireOnboardedUser (Review A4): auch ohne aktuelle Zustimmung und für gesperrte Konten.
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("DataExport");
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

const SECTIONS = ["account", "profile", "roles", "listings", "conversations", "savedSearches", "favoritesBlocks", "reports", "reviews", "devices", "legal", "verifications"] as const;

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function DataExportPage(props: Props) {
  const locale = (await getLocale()) as AppLocale;
  const user = await requireSessionUser(locale, `/${locale}/account/data`);
  const [t, tc, format, query, pending] = await Promise.all([
    getTranslations("DataExport"),
    getTranslations("Chat"),
    getFormatter(),
    props.searchParams,
    deletionPending(user.id),
  ]);
  const error = typeof query.error === "string" ? query.error : null;
  const retry = typeof query.retry === "string" && !Number.isNaN(Date.parse(query.retry)) ? new Date(query.retry) : null;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
      <Link href="/account" className="underline">{tc("back")}</Link>
      <h1 className="mt-4 text-3xl font-semibold">{t("title")}</h1>
      <p className="mt-2">{t("intro")}</p>
      <ul className="mt-4 list-disc space-y-1 pl-6">
        {SECTIONS.map((key) => <li key={key}>{t(`sections.${key}`)}</li>)}
      </ul>
      <p className="mt-4">{t("photos")}</p>
      <p className="mt-2">{t("limit")}</p>
      {error === "rate_limited" && (
        <p role="alert" className="mt-4 text-red-700">
          {retry ? t("errors.rateLimitedUntil", { time: format.dateTime(retry, { dateStyle: "medium", timeStyle: "short" }) }) : t("errors.rateLimited")}
        </p>
      )}
      {error && error !== "rate_limited" && <p role="alert" className="mt-4 text-red-700">{t(error === "not_allowed" ? "errors.notAllowed" : "errors.failed")}</p>}
      {pending ? (
        <p role="status" className="mt-6 font-medium">{t("deletionPending")}</p>
      ) : (
        <form method="post" action="/api/account/export" className="mt-6">
          <input type="hidden" name="locale" value={locale} />
          <button type="submit" className="rounded bg-emerald-800 px-4 py-2 font-medium text-white">{t("download")}</button>
        </form>
      )}
    </main>
  );
}
