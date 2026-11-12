import type { Metadata } from "next";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { requireSessionUser } from "@/lib/services/auth";
import { listOwnReports } from "@/lib/services/reports";

// „Meine Meldungen“ (DSA Art. 16 Abs. 4/5, ADR 020): Stand und Ergebnis, auch Meldungen aus dem Chat. Ohne Legal-Gate
// und für gesperrte Konten (Review A4). Nie der bearbeitende Admin, nie Angaben über das Gegenüber außer dem Ergebnis.
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Report");
  return { title: t("listMetaTitle"), robots: { index: false, follow: false } };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function MyReportsPage(props: Props) {
  const locale = (await getLocale()) as AppLocale;
  const user = await requireSessionUser(locale, `/${locale}/account/reports`);
  const [t, tc, format, query, reports] = await Promise.all([
    getTranslations("Report"),
    getTranslations("Chat"),
    getFormatter(),
    props.searchParams,
    listOwnReports(user.id),
  ]);
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium" });

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
      <Link href="/account" className="underline">{tc("back")}</Link>
      <h1 className="mt-4 text-3xl font-semibold">{t("listTitle")}</h1>
      {query.notice === "sent" && <p role="status" className="mt-4 text-emerald-800">{t("sent")}</p>}
      {reports.length === 0 ? (
        <p className="mt-6">{t("empty")}</p>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {reports.map((r) => (
            <li key={r.id} className="rounded border border-stone-300 p-3">
              <p className="font-medium">{t(`targets.${r.targetType}`)} · {t(`reasons.${r.reason}`)}</p>
              <p className="text-sm text-stone-700">{t("reportedOn", { date: date(r.createdAt) })}</p>
              <p className="mt-1">
                {r.status === "open"
                  ? t("statusOpen")
                  : t("statusHandled", { date: date(r.handledAt ?? r.createdAt), outcome: r.outcome ? t(`outcomes.${r.outcome}`) : t("outcomeUnknown") })}
              </p>
            </li>
          ))}
        </ul>
      )}
      <Link href="/account/decisions" className="mt-6 inline-block underline">{t("decisionsLink")}</Link>
    </main>
  );
}
