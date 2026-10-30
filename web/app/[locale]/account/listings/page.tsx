import type { Metadata } from "next";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { requireOnboardedUser } from "@/lib/services/gate";
import { listOwnListings, type ListingStatus, type OwnListingSummary } from "@/lib/services/listings";
import { changeListing } from "./actions";

// Blockierend rendern statt Hülle plus Stream: Gestreamte Inhalte setzt erst ein Inline-Skript ein, ohne
// JavaScript blieben Formulare unsichtbar (QA M3 F1). Der Assistent muss bis auf den Foto-Upload ohne JS gehen.
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Listings.mine");
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

const NOTICES = ["withdrawn", "paused", "resumed", "resumedReview", "deleted", "submitted"] as const;
const ERRORS = ["failed", "legal"] as const;

const STATUS_STYLE: Record<ListingStatus, string> = {
  draft: "bg-stone-100 text-stone-800",
  pending_review: "bg-amber-100 text-amber-900",
  active: "bg-emerald-100 text-emerald-900",
  paused: "bg-sky-100 text-sky-900",
  expired: "bg-stone-200 text-stone-800",
  rejected: "bg-red-100 text-red-900",
  removed: "bg-red-200 text-red-900",
};

export default async function MyListingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const t = await getTranslations("Listings.mine");
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
      <Link href="/account" className="underline">
        {t("back")}
      </Link>
      <h1 className="mt-4 text-3xl font-semibold">{t("title")}</h1>
      <MyListings searchParams={searchParams} />
    </main>
  );
}

async function MyListings({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const locale = (await getLocale()) as AppLocale;
  const user = await requireOnboardedUser(locale, `/${locale}/account/listings`);
  const [listings, params, t] = await Promise.all([listOwnListings(user.id), searchParams, getTranslations("Listings")]);
  const notice = NOTICES.find((n) => n === params.notice);
  const error = ERRORS.find((e) => e === params.error);

  return (
    <div className="mt-6 flex flex-col gap-6">
      {notice && (
        <p role="status" className="rounded bg-emerald-50 p-3 text-emerald-900">
          {t(`notices.${notice}`)}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded bg-red-50 p-3 text-red-800">
          {t(`errors.${error}`)}
        </p>
      )}
      <Link href="/account/listings/new" className="self-start rounded bg-emerald-800 px-4 py-2 font-medium text-white">
        {t("mine.create")}
      </Link>
      {listings.length === 0 ? (
        <p>{t("mine.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {listings.map((listing) => (
            <ListingRow key={listing.id} listing={listing} locale={locale} />
          ))}
        </ul>
      )}
    </div>
  );
}

async function ListingRow({ listing, locale }: { listing: OwnListingSummary; locale: AppLocale }) {
  const [t, format] = await Promise.all([getTranslations("Listings"), getFormatter()]);
  const date = (value: string) => format.dateTime(new Date(value), { dateStyle: "medium" });
  const headingId = `listing-${listing.id}`;
  const editable = listing.status !== "removed";

  return (
    <li className="rounded border border-stone-300 p-4" aria-labelledby={headingId}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 id={headingId} className="text-lg font-semibold break-words">
          {listing.title}
        </h2>
        <span className={`rounded px-2 py-0.5 text-sm font-medium ${STATUS_STYLE[listing.status]}`}>
          <span className="sr-only">{t("mine.statusLabel")}: </span>
          {t(`status.${listing.status}`)}
        </span>
      </div>
      <p className="mt-1 text-sm text-stone-700">
        {t(`kinds.${listing.kind}`)} · {t(`directions.${listing.direction}`)} · {t("mine.createdAt", { date: date(listing.createdAt) })}
      </p>
      {listing.status === "pending_review" && <p className="mt-2 text-sm">{t("mine.reviewHint")}</p>}
      {listing.status === "active" && listing.expiresAt && (
        <p className="mt-2 text-sm">{t("mine.expiresAt", { date: date(listing.expiresAt) })}</p>
      )}
      {listing.rejectReason && (listing.status === "rejected" || listing.status === "removed" || listing.status === "draft") && (
        <p className="mt-2 text-sm text-red-800">{t("mine.rejectReason", { reason: listing.rejectReason })}</p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {editable && (
          <Link href={`/account/listings/${listing.id}/edit`} className="underline">
            {t("actions.edit")}
          </Link>
        )}
        {listing.status === "pending_review" && <ActionButton listing={listing} locale={locale} action="withdraw" label={t("actions.withdraw")} />}
        {listing.status === "active" && <ActionButton listing={listing} locale={locale} action="pause" label={t("actions.pause")} />}
        {listing.status === "paused" && <ActionButton listing={listing} locale={locale} action="resume" label={t("actions.resume")} />}
        {listing.status === "draft" && (
          <details className="w-full sm:w-auto">
            <summary className="cursor-pointer text-red-800 underline">{t("actions.delete")}</summary>
            <div className="mt-2 flex flex-col gap-2">
              <p className="text-sm">{t("actions.deleteQuestion", { title: listing.title })}</p>
              <ActionButton listing={listing} locale={locale} action="delete" label={t("actions.deleteConfirm")} danger />
            </div>
          </details>
        )}
      </div>
    </li>
  );
}

function ActionButton({ listing, locale, action, label, danger }: { listing: OwnListingSummary; locale: AppLocale; action: string; label: string; danger?: boolean }) {
  return (
    <form action={changeListing}>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="id" value={listing.id} />
      <input type="hidden" name="action" value={action} />
      <button
        type="submit"
        className={danger ? "rounded bg-red-800 px-3 py-1.5 text-sm font-medium text-white" : "rounded border border-stone-400 px-3 py-1.5 text-sm"}
      >
        {label}
      </button>
    </form>
  );
}
