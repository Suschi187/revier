import type { Metadata } from "next";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import type { ReportTarget } from "@/lib/reports";
import { requireAdmin } from "@/lib/services/admin";
import { getReportQueue, REPORT_QUEUE_PAGE } from "@/lib/services/admin-reports";
import { ui } from "@/components/ui/styles";

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
    <main id="main" className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6">
      <Link href="/admin" className="text-sm underline underline-offset-2">← {t("back")}</Link>
      <h1 className="mt-4 font-display text-2xl font-extrabold uppercase leading-tight [overflow-wrap:anywhere] hyphens-auto sm:text-3xl">{t("title")}</h1>
      {notice && <p role="status" className="mt-4 text-success">{t(`notices.${notice}`)}</p>}
      {items.length === 0 ? (
        <p className="mt-6">{t("empty")}</p>
      ) : (
        <ol className="mt-6 flex flex-col gap-4">
          {items.map((item) => (
            <li key={`${item.targetType}:${item.targetId}`} className={`${ui.card} p-4`}>
              <h2 className="font-display text-lg font-bold break-words">
                <Link href={`/admin/reports/${item.targetType}/${item.targetId}`} className={ui.link}>
                  {tr(`targets.${item.targetType}`)}: {item.label ?? t("noLabel")}
                </Link>
              </h2>
              <p className="text-sm">{t("count", { count: item.count })} · {item.reasons.map((r) => tr(`reasons.${r}`)).join(", ")}</p>
              <p className="text-sm text-muted">{t("oldest", { time: format.relativeTime(new Date(item.oldest)) })}</p>
              {item.gone && <p className="mt-1 w-fit rounded-pill bg-sand px-2.5 py-0.5 text-sm">{t("gone")}</p>}
            </li>
          ))}
        </ol>
      )}
      {items.length === REPORT_QUEUE_PAGE && last && (
        <Link href={`/admin/reports?after=${encodeURIComponent(last.oldest)}&afterType=${last.targetType}&afterId=${last.targetId}`} className={`mt-6 inline-block ${ui.link}`}>
          {t("more")}
        </Link>
      )}
    </main>
  );
}
