import type { Metadata } from "next";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { requireAdmin } from "@/lib/services/admin";
import { getVerificationQueue, VERIFICATION_QUEUE_PAGE } from "@/lib/services/admin-verifications";

// Verifizierungen zur Prüfung (ADR 020), älteste Einreichung zuerst. Status und CSP setzt der Proxy (ADR 014).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Admin.verifications");
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

const NOTICES = ["verified", "rejected", "revoked", "decided"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function VerificationQueuePage({ searchParams }: Props) {
  const locale = (await getLocale()) as AppLocale;
  await requireAdmin(locale, `/${locale}/admin/verifications`);
  const query = await searchParams;
  const after =
    typeof query.after === "string" && typeof query.afterId === "string" && !Number.isNaN(Date.parse(query.after)) && UUID.test(query.afterId)
      ? { submittedAt: query.after, id: query.afterId }
      : null;
  const [t, tv, ta, tp, format, items] = await Promise.all([
    getTranslations("Admin.verifications"),
    getTranslations("Verification"),
    getTranslations("Account"),
    getTranslations("Profile"),
    getFormatter(),
    getVerificationQueue(after),
  ]);
  const notice = NOTICES.find((n) => n === query.notice);
  const last = items.at(-1);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
      <Link href="/admin" className="underline">
        {t("back")}
      </Link>
      <h1 className="mt-4 text-3xl font-semibold">{t("title")}</h1>
      {notice && (
        <p role="status" className="mt-4 text-emerald-800">
          {t(`notices.${notice}`)}
        </p>
      )}
      {items.length === 0 ? (
        <p className="mt-6">{t("empty")}</p>
      ) : (
        <ol className="mt-6 flex flex-col gap-4">
          {items.map((item) => (
            <li key={item.id} className="rounded border border-stone-300 p-4">
              <h2 className="text-lg font-semibold break-words">
                <Link href={`/admin/verifications/${item.id}`} className="underline">
                  {t("itemTitle", { type: tv(`documentTypes.${item.documentType}`), name: item.displayName })}
                </Link>
              </h2>
              <p className="text-sm text-stone-700">
                {ta(`accountTypes.${item.accountType}`)} · {tp(`countries.${item.country}`)} · {ta(`verificationStatus.${item.profileStatus}`)}
              </p>
              <p className="mt-1 text-sm">
                {t("waiting", { time: format.relativeTime(new Date(item.submittedAt)) })} · {t("previous", { count: item.previousRequests })}
              </p>
              {item.isOwn && <p className="mt-1 w-fit rounded bg-amber-100 px-2 py-0.5 text-sm text-amber-950">{t("own")}</p>}
            </li>
          ))}
        </ol>
      )}
      {items.length === VERIFICATION_QUEUE_PAGE && last && (
        <Link href={`/admin/verifications?after=${encodeURIComponent(last.submittedAt)}&afterId=${last.id}`} className="mt-6 inline-block underline">
          {t("more")}
        </Link>
      )}
    </main>
  );
}
