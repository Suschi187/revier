import type { Metadata } from "next";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { actionKey } from "@/lib/reports";
import { requireAdmin } from "@/lib/services/admin";
import { getAppealQueue, REPORT_QUEUE_PAGE } from "@/lib/services/admin-reports";
import { ui } from "@/components/ui/styles";

// Offene Beschwerden, älteste zuerst (ADR 020). Status und CSP setzt der Proxy (ADR 014).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Admin.appeals");
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NOTICES = ["upheld", "reversed", "decided"] as const;

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AdminAppealsPage({ searchParams }: Props) {
  const locale = (await getLocale()) as AppLocale;
  await requireAdmin(locale, `/${locale}/admin/appeals`);
  const query = await searchParams;
  const after = typeof query.after === "string" && !Number.isNaN(Date.parse(query.after)) && typeof query.afterId === "string" && UUID.test(query.afterId)
    ? { createdAt: query.after, id: query.afterId } : null;
  const [t, td, format, items] = await Promise.all([getTranslations("Admin.appeals"), getTranslations("Decisions"), getFormatter(), getAppealQueue(after)]);
  const notice = NOTICES.find((n) => n === query.notice);
  const last = items.at(-1);
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6">
      <Link href="/admin" className="text-sm underline underline-offset-2">← {t("back")}</Link>
      <h1 className="mt-4 font-display text-2xl font-extrabold uppercase leading-tight [overflow-wrap:anywhere] hyphens-auto sm:text-3xl">{t("title")}</h1>
      {notice && <p role="status" className="mt-4 text-success">{t(`notices.${notice}`)}</p>}
      {items.length === 0 ? (
        <p className="mt-6">{t("empty")}</p>
      ) : (
        <ol className="mt-6 flex flex-col gap-4">
          {items.map((item) => {
            const key = actionKey(item.decisionAction);
            return (
              <li key={item.id} className={`${ui.card} p-4`}>
                <h2 className="font-display text-lg font-bold break-words">
                  <Link href={`/admin/appeals/${item.id}`} className={ui.link}>{t("itemTitle", { action: key ? td(`actions.${key}`) : item.decisionAction, name: item.displayName })}</Link>
                </h2>
                <p className="text-sm text-muted">{t("waiting", { time: format.relativeTime(new Date(item.createdAt)) })}</p>
                {item.sameReviewerOnly && <p className="mt-1 w-fit rounded-pill bg-notice-soft px-2.5 py-0.5 text-sm text-notice">{t("byMe")}</p>}
              </li>
            );
          })}
        </ol>
      )}
      {items.length === REPORT_QUEUE_PAGE && last && (
        <Link href={`/admin/appeals?after=${encodeURIComponent(last.createdAt)}&afterId=${last.id}`} className={`mt-6 inline-block ${ui.link}`}>{t("more")}</Link>
      )}
    </main>
  );
}
