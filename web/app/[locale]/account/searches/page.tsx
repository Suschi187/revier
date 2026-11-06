import type { Metadata } from "next";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { publicPath } from "@/lib/public/paths";
import { isErrorParam } from "@/lib/saved-searches/errors";
import { describeFilters, extendWindow, NAME_MAX, resultsHref, SAVED_SEARCH_LIMIT, searchStatus, storedFilters } from "@/lib/saved-searches/rules";
import { filterTexts } from "@/lib/saved-searches/texts";
import { requireSessionUser } from "@/lib/services/auth";
import { listSavedSearches, type SavedSearch } from "@/lib/services/saved-searches";
import { changeSavedSearchAction } from "./actions";

// Suchaufträge verwalten (ADR 018). Ohne Suspense, damit Liste und Formulare ohne JavaScript im HTML stehen (QA M3
// F1). Nur angemeldet, ohne Zustimmungs-Pflicht: Pausieren, E-Mail aus und Löschen gehen immer (wie Melden).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("SavedSearches");
  return { title: t("page.metaTitle"), robots: { index: false, follow: false } };
}

const NOTICES = ["created", "paused", "resumed", "extended", "emailOn", "emailOff", "cadence", "renamed", "deleted"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TIME_ZONE = "Europe/Berlin";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function SavedSearchesPage(props: Props) {
  const locale = (await getLocale()) as AppLocale;
  const path = `/${locale}/account/searches`;
  await requireSessionUser(locale, path);
  const [t, items, query] = await Promise.all([getTranslations("SavedSearches"), listSavedSearches(), props.searchParams]);
  const notice = NOTICES.find((n) => n === query.notice);
  const error = isErrorParam(query.error) ? query.error : null;
  const confirmDelete = typeof query.delete === "string" && UUID.test(query.delete) ? query.delete : null;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
      <Link href="/account" className="underline">{t("page.back")}</Link>
      <h1 className="mt-4 text-3xl font-semibold">{t("page.title")}</h1>
      <p className="mt-2">{t("page.intro")}</p>
      {notice && <p role="status" className="mt-4 rounded bg-emerald-50 p-3 text-emerald-900">{t(`notices.${notice}`)}</p>}
      {error && (
        <p role="alert" className="mt-4 rounded bg-red-50 p-3 text-red-800">
          {t(`errors.${error}`)}
          {error === "legal" && (
            <>
              {" "}
              <a href={`/${locale}/welcome?next=${encodeURIComponent(path)}`} className="underline">{t("legalLink")}</a>
            </>
          )}
        </p>
      )}
      {items === null && <p role="alert" className="mt-4">{t("page.loadFailed")}</p>}
      {items && items.length === 0 && (
        <p className="mt-6">
          {t("page.empty")} <a href={publicPath({ route: "search" }, locale)} className="underline">{t("page.toSearch")}</a>
        </p>
      )}
      {items && items.length > 0 && (
        <>
          <p className="mt-4 text-sm text-stone-700">{t("page.count", { count: items.length, max: SAVED_SEARCH_LIMIT })}</p>
          <ul className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4">
            {items.map((item) => (
              <SavedSearchItem key={item.id} item={item} locale={locale} confirmDelete={confirmDelete === item.id} />
            ))}
          </ul>
        </>
      )}
    </main>
  );
}

const button = "rounded border border-stone-500 px-3 py-1";

function ActionForm({ locale, id, op, label, className = button }: { locale: AppLocale; id: string; op: string; label: string; className?: string }) {
  return (
    <form action={changeSavedSearchAction}>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="op" value={op} />
      <button type="submit" className={className}>{label}</button>
    </form>
  );
}

async function SavedSearchItem({ item, locale, confirmDelete }: { item: SavedSearch; locale: AppLocale; confirmDelete: boolean }) {
  const [t, format, texts] = await Promise.all([getTranslations("SavedSearches"), getFormatter(), filterTexts(locale)]);
  const now = new Date();
  const date = (value: Date | string) => format.dateTime(new Date(value), { dateStyle: "medium", timeZone: TIME_ZONE });
  const filters = storedFilters(item.filters);
  const status = searchStatus(item, now);
  const extend = extendWindow(item.expires_at, now);
  const headingId = `search-${item.id}-name`;

  return (
    <li id={`search-${item.id}`} className="rounded border border-stone-300 p-4" aria-labelledby={headingId}>
      <h2 id={headingId} className="text-xl font-semibold [overflow-wrap:anywhere]">{item.name}</h2>
      {filters ? (
        <p className="mt-1 text-sm text-stone-800 [overflow-wrap:anywhere]">
          {describeFilters(filters, locale, texts).join(" · ") || t("save.noFilters")}
        </p>
      ) : (
        <p className="mt-1 text-sm text-red-800">{t("page.invalidFilters")}</p>
      )}

      <p className="mt-2 font-medium">
        {status.state === "expired"
          ? t("status.expired", { date: date(status.expiresAt), deleteDate: date(status.deleteAt) })
          : t(`status.${status.state}`, { date: date(status.expiresAt) })}
      </p>
      {status.state === "paused" && <p className="text-sm text-stone-700">{t("status.pausedHint")}</p>}
      <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="font-medium">{t("fields.cadence")}</dt>
        <dd>{t(`cadence.${item.cadence}`)}</dd>
        <dt className="font-medium">{t("fields.email")}</dt>
        <dd>{item.notify_email ? t("email.on") : t("email.off")}</dd>
        {item.last_notified_at && (
          <>
            <dt className="font-medium">{t("fields.lastNotified")}</dt>
            <dd>{date(item.last_notified_at)}</dd>
          </>
        )}
      </dl>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {filters && <a href={resultsHref(filters, locale)} className="rounded bg-stone-900 px-3 py-1 text-white">{t("actions.results")}</a>}
        {status.state !== "expired" &&
          (item.paused_at === null ? (
            <ActionForm locale={locale} id={item.id} op="pause" label={t("actions.pause")} />
          ) : (
            <ActionForm locale={locale} id={item.id} op="resume" label={t("actions.resume")} />
          ))}
        {extend.open && <ActionForm locale={locale} id={item.id} op="extend" label={t("actions.extend")} />}
        <ActionForm locale={locale} id={item.id} op={item.notify_email ? "emailOff" : "emailOn"} label={t(item.notify_email ? "actions.emailOff" : "actions.emailOn")} />
        <ActionForm locale={locale} id={item.id} op={item.cadence === "instant" ? "daily" : "instant"} label={t(item.cadence === "instant" ? "actions.toDaily" : "actions.toInstant")} />
      </div>
      {!extend.open && <p className="mt-2 text-sm text-stone-700">{t("actions.extendFrom", { date: date(extend.from) })}</p>}

      <details className="mt-3">
        <summary className="cursor-pointer underline">{t("actions.rename")}</summary>
        <form action={changeSavedSearchAction} className="mt-2 flex flex-wrap items-end gap-2">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="id" value={item.id} />
          <input type="hidden" name="op" value="rename" />
          <div className="min-w-0 flex-1">
            <label htmlFor={`rename-${item.id}`} className="block text-sm font-medium">{t("fields.name")}</label>
            <input
              id={`rename-${item.id}`}
              name="name"
              required
              maxLength={NAME_MAX}
              defaultValue={item.name}
              aria-describedby={`rename-${item.id}-hint`}
              className="w-full rounded border border-stone-400 px-2 py-1.5"
            />
            <p id={`rename-${item.id}-hint`} className="text-sm text-stone-700">{t("fields.nameHint")}</p>
          </div>
          <button type="submit" className={button}>{t("actions.renameSubmit")}</button>
        </form>
      </details>

      {/* Löschen zweistufig ohne confirm(): Der Link zeigt die Rückfrage, erst der Button löscht (POST). */}
      {confirmDelete ? (
        <div role="group" aria-labelledby={`delete-${item.id}`} className="mt-3 rounded border border-red-700 bg-red-50 p-3">
          <p id={`delete-${item.id}`} className="font-medium text-red-900">{t("actions.deleteConfirm", { name: item.name })}</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <ActionForm locale={locale} id={item.id} op="delete" label={t("actions.deleteYes")} className="rounded bg-red-800 px-3 py-1 text-white" />
            <a href={`/${locale}/account/searches#search-${item.id}`} className="underline">{t("actions.cancel")}</a>
          </div>
        </div>
      ) : (
        <p className="mt-3">
          <a href={`/${locale}/account/searches?delete=${item.id}#search-${item.id}`} className="text-red-800 underline">{t("actions.delete")}</a>
        </p>
      )}
    </li>
  );
}
