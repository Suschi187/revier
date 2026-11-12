import type { Metadata } from "next";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import type { ReportTarget } from "@/lib/reports";
import { requireAdmin } from "@/lib/services/admin";
import { getReportQueue, REPORT_QUEUE_PAGE } from "@/lib/services/admin-reports";

// Offene Meldungen je Ziel, älteste zuerst (ADR 020). Status und CSP setzt der Proxy (ADR 014).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Admin.reports");
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TYPES = ["listing", "profile", "message"] as const;
const NOTICES = ["resolved", "decided"] as const;

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function ReportQueuePage({ searchParams }: Props) {
  const locale = (await getLocale()) as AppLocale;
  await requireAdmin(locale, `/${locale}/admin/reports`);
  const query = await searchParams;
  const afterType = TYPES.find((type) => type === query.afterType);
  const after =
    typeof query.after === "string" && !Number.isNaN(Date.parse(query.after)) && afterType && typeof query.afterId === "string" && UUID.test(query.afterId)
      ? { oldest: query.after, type: afterType as ReportTarget, id: query.afterId }
      : null;
  const [t, tr, format, items] = await Promise.all([getTranslations("Admin.reports"), getTranslations("Report"), getFormatter(), getReportQueue(after)]);
  const notice = NOTICES.find((n) => n === query.notice);
  const last = items.at(-1);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
      <Link href="/admin" className="underline">{t("back")}</Link>
      <h1 className="mt-4 text-3xl font-semibold">{t("title")}</h1>
      {notice && <p role="status" className="mt-4 text-emerald-800">{t(`notices.${notice}`)}</p>}
      {items.length === 0 ? (
        <p className="mt-6">{t("empty")}</p>
      ) : (
        <ol className="mt-6 flex flex-col gap-4">
          {items.map((item) => (
            <li key={`${item.targetType}:${item.targetId}`} className="rounded border border-stone-300 p-4">
              <h2 className="text-lg font-semibold break-words">
                <Link href={`/admin/reports/${item.targetType}/${item.targetId}`} className="underline">
                  {tr(`targets.${item.targetType}`)}: {item.label ?? t("noLabel")}
                </Link>
              </h2>
              <p className="text-sm">{t("count", { count: item.count })} · {item.reasons.map((r) => tr(`reasons.${r}`)).join(", ")}</p>
              <p className="text-sm text-stone-700">{t("oldest", { time: format.relativeTime(new Date(item.oldest)) })}</p>
              {item.gone && <p className="mt-1 w-fit rounded bg-stone-200 px-2 py-0.5 text-sm">{t("gone")}</p>}
            </li>
          ))}
        </ol>
      )}
      {items.length === REPORT_QUEUE_PAGE && last && (
        <Link href={`/admin/reports?after=${encodeURIComponent(last.oldest)}&afterType=${last.targetType}&afterId=${last.targetId}`} className="mt-6 inline-block underline">
          {t("more")}
        </Link>
      )}
    </main>
  );
}
