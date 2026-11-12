import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { REJECT_CODES } from "@/lib/moderation";
import { publicPath } from "@/lib/public/paths";
import { ACCOUNT_CODES, OUTCOMES_BY_TARGET, REPORT_NOTE_MAX, type ReportTarget } from "@/lib/reports";
import { getReportTarget, readReportedMessage } from "@/lib/services/admin-reports";
import { resolveReportsAction } from "./actions";

const ERRORS = ["changed", "code", "note", "forbidden", "adminRole", "notFound", "failed"] as const;

/**
 * Ziel mit offenen Meldungen und Maßnahmen (ADR 020). Die Seiten unter listing/, profile/ und message/[id] prüfen die
 * Admin-Rolle. Die Kopie einer gemeldeten Nachricht erscheint nur nach einem Klick („?show=<Meldung>“), jeder Abruf
 * schreibt `report.message_viewed` (ADR 017: Admins lesen Chats nicht pauschal).
 */
export async function ReportTargetPage({ locale, type, id, query }: { locale: AppLocale; type: ReportTarget; id: string; query: Record<string, string | string[] | undefined> }) {
  const target = await getReportTarget(type, id);
  if (!target) notFound();
  const [t, tr, tm, ta, tp, tl, format] = await Promise.all([
    getTranslations("Admin.reports"),
    getTranslations("Report"),
    getTranslations("Moderation"),
    getTranslations("Account"),
    getTranslations("Profile"),
    getTranslations("Listings"),
    getFormatter(),
  ]);
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" });
  const error = ERRORS.find((e) => e === query.error);
  const shown = typeof query.show === "string" && target.open.some((r) => r.id === query.show) ? query.show : null;
  const message = type === "message" && shown ? await readReportedMessage(shown) : null;
  const outcomes = OUTCOMES_BY_TARGET[type].filter((o) => o !== "point_removed" || target.listing?.hasPoint);
  const radio = "flex items-center gap-2";

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
      <Link href="/admin/reports" className="underline">{t("back")}</Link>
      <h1 className="mt-4 text-3xl font-semibold break-words">{tr(`targets.${type}`)}: {target.label ?? t("noLabel")}</h1>
      {target.gone && <p className="mt-2 font-medium">{t("goneHint")}</p>}

      {target.listing && (
        <p className="mt-2">
          {tl(`status.${target.listing.status}`)} ·{" "}
          {target.listing.status === "pending_review" ? (
            <Link href={`/admin/listings/${target.listing.id}`} className="underline">{t("reviewLink")}</Link>
          ) : target.listing.isPublic ? (
            <a href={publicPath({ route: "listing", id: target.listing.id }, locale)} className="underline">{t("publicLink")}</a>
          ) : null}
        </p>
      )}

      {target.account && (
        <section className="mt-4 rounded border border-stone-300 p-3 text-sm" aria-labelledby="h-account">
          <h2 id="h-account" className="font-semibold">{t("account")}</h2>
          <p>
            <Link href={`/admin/users/${target.account.id}`} className="underline">{target.account.displayName}</Link> · {ta(`accountTypes.${target.account.accountType}`)} ·{" "}
            {tp(`countries.${target.account.country}`)} · {t("listings", { count: target.account.listingCount })}
          </p>
          <p>{t("memberSince", { date: format.dateTime(new Date(target.account.memberSince), { dateStyle: "medium" }) })}</p>
          {target.account.isBlocked && <p className="font-medium text-red-800">{t("blocked")}</p>}
          {target.account.hasRole && <p className="font-medium">{t("hasRole")}</p>}
          {target.account.isOwn && <p className="font-medium">{t("own")}</p>}
        </section>
      )}

      <section className="mt-6" aria-labelledby="h-open">
        <h2 id="h-open" className="text-xl font-semibold">{t("openReports", { count: target.open.length })}</h2>
        {target.handledCount > 0 && <p className="text-sm text-stone-700">{t("handledBefore", { count: target.handledCount })}</p>}
        <ul className="mt-2 flex flex-col gap-2">
          {target.open.map((r) => (
            <li key={r.id} className="rounded border border-stone-300 p-3">
              <p className="font-medium">{tr(`reasons.${r.reason}`)} · <span className="font-normal text-stone-700">{date(r.createdAt)}</span></p>
              {r.note && <p className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{r.note}</p>}
              {type === "message" && (
                shown === r.id && message ? (
                  <figure className="mt-2 rounded bg-stone-100 p-2">
                    <figcaption className="text-xs text-stone-700">{t("messageCaption", { sender: message.sender ?? "–", date: date(message.messageCreatedAt) })}</figcaption>
                    <blockquote className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{message.body}</blockquote>
                  </figure>
                ) : (
                  <form method="get" className="mt-2">
                    <input type="hidden" name="show" value={r.id} />
                    <button type="submit" className="rounded border border-stone-500 px-3 py-1 text-sm">{t("showMessage")}</button>
                    <span className="ml-2 text-xs text-stone-700">{t("showMessageHint")}</span>
                  </form>
                )
              )}
            </li>
          ))}
        </ul>
      </section>

      {error && <p id="r-error" role="alert" className="mt-6 rounded bg-red-50 p-3 text-red-800">{t(`errors.${error}`)}</p>}

      {target.open.length > 0 && (
        <form action={resolveReportsAction} id="decision" className="mt-6 flex flex-col gap-4 rounded border border-stone-400 p-4">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="type" value={type} />
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="version" value={target.listing?.version ?? ""} />
          <input type="hidden" name="accountId" value={target.account?.id ?? ""} />
          <fieldset className="flex flex-col gap-2" aria-describedby={error ? "r-error" : undefined}>
            <legend className="font-medium">{t("measure")}</legend>
            {outcomes.map((o) => (
              <label key={o} className={radio}>
                <input type="radio" name="outcome" value={o} required disabled={(o === "account_warned" || o === "account_blocked") && (!target.account || target.account.hasRole || target.account.isOwn)} />
                {t(`measures.${o}`)}
              </label>
            ))}
          </fieldset>
          {/* QA M9b F5: getrennte Auswahl je Gruppe, damit ohne JavaScript kein unpassender Code ankommt. */}
          {type === "listing" && (
            <div>
              <label htmlFor="r-code-listing" className="font-medium">{t("codeListing")}</label>
              <select id="r-code-listing" name="codeListing" defaultValue="" aria-invalid={error === "code" || undefined} aria-describedby="r-code-hint" className="mt-1 w-full rounded border border-stone-400 px-3 py-2">
                <option value="">{t("codeNone")}</option>
                {REJECT_CODES.map((code) => <option key={code} value={code}>{tm(`reasons.${code}`)}</option>)}
              </select>
            </div>
          )}
          <div>
            <label htmlFor="r-code-account" className="font-medium">{t("codeAccount")}</label>
            <select id="r-code-account" name="codeAccount" defaultValue="" aria-invalid={error === "code" || undefined} aria-describedby="r-code-hint" className="mt-1 w-full rounded border border-stone-400 px-3 py-2">
              <option value="">{t("codeNone")}</option>
              {ACCOUNT_CODES.map((code) => <option key={code} value={code}>{tm(`accountCodes.${code}`)}</option>)}
            </select>
            <p id="r-code-hint" className="text-xs text-stone-700">{t("codeHint")}</p>
          </div>
          <div>
            <label htmlFor="r-note" className="font-medium">{t("note")}</label>
            <textarea id="r-note" name="note" rows={3} maxLength={REPORT_NOTE_MAX} aria-describedby="r-note-hint" aria-invalid={error === "note" || undefined} className="mt-1 w-full rounded border border-stone-400 px-3 py-2" />
            <p id="r-note-hint" className="text-xs text-stone-700">{t("noteHint")}</p>
          </div>
          <button type="submit" className="self-start rounded bg-emerald-800 px-4 py-2 font-medium text-white">{t("submit")}</button>
        </form>
      )}
    </main>
  );
}
