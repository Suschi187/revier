import type { Metadata } from "next";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { actionKey } from "@/lib/reports";
import { requireAdmin } from "@/lib/services/admin";
import { getAppealQueue, REPORT_QUEUE_PAGE } from "@/lib/services/admin-reports";

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
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
      <Link href="/admin" className="underline">{t("back")}</Link>
      <h1 className="mt-4 text-3xl font-semibold">{t("title")}</h1>
      {notice && <p role="status" className="mt-4 text-emerald-800">{t(`notices.${notice}`)}</p>}
      {items.length === 0 ? (
        <p className="mt-6">{t("empty")}</p>
      ) : (
        <ol className="mt-6 flex flex-col gap-4">
          {items.map((item) => {
            const key = actionKey(item.decisionAction);
            return (
              <li key={item.id} className="rounded border border-stone-300 p-4">
                <h2 className="text-lg font-semibold break-words">
                  <Link href={`/admin/appeals/${item.id}`} className="underline">{t("itemTitle", { action: key ? td(`actions.${key}`) : item.decisionAction, name: item.displayName })}</Link>
                </h2>
                <p className="text-sm text-stone-700">{t("waiting", { time: format.relativeTime(new Date(item.createdAt)) })}</p>
                {item.sameReviewerOnly && <p className="mt-1 w-fit rounded bg-amber-100 px-2 py-0.5 text-sm text-amber-950">{t("byMe")}</p>}
              </li>
            );
          })}
        </ol>
      )}
      {items.length === REPORT_QUEUE_PAGE && last && (
        <Link href={`/admin/appeals?after=${encodeURIComponent(last.createdAt)}&afterId=${last.id}`} className="mt-6 inline-block underline">{t("more")}</Link>
      )}
    </main>
  );
}
