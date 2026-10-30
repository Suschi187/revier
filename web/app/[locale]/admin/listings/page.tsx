import type { Metadata } from "next";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { requireAdmin } from "@/lib/services/admin";
import { getReviewQueue, QUEUE_PAGE } from "@/lib/services/moderation";
import { listRegions } from "@/lib/services/regions";

// `instant = false` nimmt die Seite aus der Instant-Navigation-Prüfung, damit sie die Session ohne
// Suspense-Grenze liest. Den Status (403, Login) setzt der Proxy; die Prüfung hier autorisiert nur und kann
// den schon gesendeten Status nicht mehr ändern (ADR 014, QA M4 F1).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Admin.queue");
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

const NOTICES = ["approved", "returned", "rejected", "decided"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function ReviewQueuePage({ searchParams }: Props) {
  const locale = (await getLocale()) as AppLocale;
  await requireAdmin(locale, `/${locale}/admin/listings`);
  const query = await searchParams;
  const after =
    typeof query.after === "string" && typeof query.afterId === "string" && !Number.isNaN(Date.parse(query.after)) && UUID.test(query.afterId)
      ? { submittedAt: query.after, id: query.afterId }
      : null;
  const [t, tl, format, items] = await Promise.all([getTranslations("Admin.queue"), getTranslations("Listings"), getFormatter(), getReviewQueue(after)]);
  const countries = [...new Set(items.map((i) => i.country))];
  const regions = await Promise.all(countries.map((c) => listRegions(c, locale)));
  const districtName = new Map(regions.flatMap((r) => r.districts.map((d) => [d.id, d.name] as const)));
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
                <Link href={`/admin/listings/${item.id}`} className="underline">
                  {item.title}
                </Link>
              </h2>
              <p className="text-sm text-stone-700">
                {tl(`kinds.${item.kind}`)} · {tl(`directions.${item.direction}`)} · {districtName.get(item.regionId) ?? item.country}
              </p>
              <p className="mt-1 text-sm">
                {t("waiting", { time: format.relativeTime(new Date(item.submittedAt)) })}
                {item.ownerName && <> · {t("owner", { name: item.ownerName })}</>}
              </p>
              {item.hintCount > 0 && (
                <p className="mt-1 w-fit rounded bg-amber-100 px-2 py-0.5 text-sm text-amber-950">{t("hints", { count: item.hintCount })}</p>
              )}
              {(item.listingRejections > 0 || item.ownerRejections > 0) && (
                <p className="mt-1 text-sm text-red-800">{t("rejections", { listing: item.listingRejections, owner: item.ownerRejections })}</p>
              )}
            </li>
          ))}
        </ol>
      )}
      {items.length === QUEUE_PAGE && last && (
        <Link
          href={`/admin/listings?after=${encodeURIComponent(last.submittedAt)}&afterId=${last.id}`}
          className="mt-6 inline-block underline"
        >
          {t("more")}
        </Link>
      )}
    </main>
  );
}
