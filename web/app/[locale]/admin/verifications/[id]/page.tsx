import type { Metadata } from "next";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { requireAdmin } from "@/lib/services/admin";
import { documentView, getVerification, type DocumentView } from "@/lib/services/admin-verifications";
import { REVOKE_CODES, VERIFICATION_NOTE_MAX, VERIFICATION_REJECT_CODES } from "@/lib/verification";
import { decideVerificationAction, openVerificationDocument, revokeVerificationAction } from "./actions";

// Antrag mit Konto, Verlauf und Dokument (ADR 020). Das Dokument erscheint nur nach einem Klick, der das Audit
// schreibt (Review B3); die Seite signiert dann 60 Sekunden lang und zeigt Bilder als <img>, PDFs als Link in einem
// neuen Tab. Passt der Inhalt nicht zum erlaubten Typ, wird nichts angezeigt (Review A6). Status und CSP setzt der Proxy.
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Admin.verifications.detail");
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ERRORS = ["code", "note", "forbidden", "notFound", "failed"] as const;

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AdminVerificationPage({ params, searchParams }: Props) {
  const locale = (await getLocale()) as AppLocale;
  const [{ id }, query] = await Promise.all([params, searchParams]);
  await requireAdmin(locale, `/${locale}/admin/verifications/${UUID.test(id) ? id : ""}`);
  if (!UUID.test(id)) notFound();
  const v = await getVerification(id);
  if (!v) notFound();

  const [t, tv, ta, tp, format] = await Promise.all([
    getTranslations("Admin.verifications.detail"),
    getTranslations("Verification"),
    getTranslations("Account"),
    getTranslations("Profile"),
    getFormatter(),
  ]);
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" });
  const error = ERRORS.find((e) => e === query.error);
  const view: DocumentView | null = query.document === "1" && v.documentPresent && !v.isOwn ? await documentView(v.id) : null;
  const type = tv(`documentTypes.${v.documentType}`);
  const canRevoke = v.status === "verified" && !v.revokedAt && !v.isOwn;
  const radio = "flex items-center gap-2";

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
      <Link href="/admin/verifications" className="underline">
        {t("back")}
      </Link>
      <h1 className="mt-4 text-3xl font-semibold break-words">{t("title", { type, name: v.user.displayName })}</h1>

      <dl className="mt-4 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="font-medium">{t("status")}</dt>
        <dd>{tv(`requestStatus.${v.revokedAt ? "revoked" : v.status}`)}</dd>
        <dt className="font-medium">{t("submitted")}</dt>
        <dd>{date(v.submittedAt)}</dd>
        <dt className="font-medium">{t("accountType")}</dt>
        <dd>
          {ta(`accountTypes.${v.user.accountType}`)}
          {v.user.businessName ? ` (${v.user.businessName})` : ""}
        </dd>
        <dt className="font-medium">{t("country")}</dt>
        <dd>{tp(`countries.${v.user.country}`)}</dd>
        <dt className="font-medium">{t("memberSince")}</dt>
        <dd>{format.dateTime(new Date(v.user.memberSince), { dateStyle: "medium" })}</dd>
        <dt className="font-medium">{t("profileStatus")}</dt>
        <dd>{ta(`verificationStatus.${v.user.verificationStatus}`)}</dd>
      </dl>
      {v.user.isBlocked && <p className="mt-2 font-medium text-red-800">{t("blocked")}</p>}
      {v.isOwn && <p className="mt-2 w-fit rounded bg-amber-100 px-2 py-0.5 text-amber-950">{t("own")}</p>}
      {v.rejectCode && (
        <p className="mt-2 text-sm">
          {tv("reasonLabel")}: {tv(`reasons.${v.rejectCode}`)}. {v.rejectReason}
        </p>
      )}
      {v.revokeCode && (
        <p className="mt-2 text-sm">
          {tv("reasonLabel")}: {tv(`revokeReasons.${v.revokeCode}`)}. {v.revokeReason}
        </p>
      )}

      <section className="mt-6" aria-labelledby="h-history">
        <h2 id="h-history" className="text-xl font-semibold">
          {t("history")}
        </h2>
        {v.history.length === 0 ? (
          <p className="mt-1">{t("historyEmpty")}</p>
        ) : (
          <ul className="mt-1 list-disc pl-6 text-sm">
            {v.history.map((h) => (
              <li key={h.id}>
                {tv("historyItem", {
                  date: h.revokedAt ?? h.decidedAt ? format.dateTime(new Date((h.revokedAt ?? h.decidedAt)!), { dateStyle: "medium" }) : "–",
                  type: tv(`documentTypes.${h.documentType}`),
                  status: tv(`requestStatus.${h.revokedAt ? "revoked" : h.status}`),
                })}
                {h.rejectCode && <> ({tv(`reasons.${h.rejectCode}`)})</>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section id="document" className="mt-6 flex flex-col gap-2 rounded border border-stone-400 p-4" aria-labelledby="h-document">
        <h2 id="h-document" className="text-xl font-semibold">
          {t("documentTitle")}
        </h2>
        {!v.documentPresent ? (
          <p>{t("documentMissing")}</p>
        ) : v.isOwn ? (
          <p>{t("own")}</p>
        ) : (
          <>
            <p className="text-sm text-stone-700">{t("documentHint")}</p>
            {view?.ok === true &&
              (view.mime === "application/pdf" ? (
                <a href={view.url} target="_blank" rel="noopener noreferrer" className="underline">
                  {t("pdfLink")}
                </a>
              ) : (
                // Signierte 60-s-URL der Storage-Origin; next/image würde sie über den Server cachen.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={view.url} alt={t("imageAlt", { type })} referrerPolicy="no-referrer" className="max-h-[80vh] w-auto rounded border" />
              ))}
            {view?.ok === false && (
              <p role="alert" className="text-red-700">
                {t(`documentErrors.${view.error}`)}
              </p>
            )}
            <form action={openVerificationDocument}>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="id" value={v.id} />
              <button type="submit" className="rounded border border-stone-500 px-4 py-2">
                {view?.ok ? t("documentAgain") : t("documentShow")}
              </button>
            </form>
          </>
        )}
      </section>

      {error && (
        <p id="v-error" role="alert" className="mt-6 rounded bg-red-50 p-3 text-red-800">
          {t(`errors.${error}`)}
        </p>
      )}

      {v.status === "pending" && !v.isOwn && (
        <form action={decideVerificationAction} id="decision" className="mt-6 flex flex-col gap-4 rounded border border-stone-400 p-4">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="id" value={v.id} />
          <input type="hidden" name="userId" value={v.user.id} />
          <fieldset className="flex flex-col gap-2" aria-describedby={error ? "v-error" : undefined}>
            <legend className="font-medium">{t("decision")}</legend>
            <label className={radio}>
              <input type="radio" name="decision" value="verify" required />
              {t("verify")}
            </label>
            <label className={radio}>
              <input type="radio" name="decision" value="reject" required />
              {t("reject")}
            </label>
          </fieldset>
          <div>
            <label htmlFor="v-code" className="font-medium">
              {t("reason")}
            </label>
            <select id="v-code" name="code" defaultValue="" aria-invalid={error === "code" || undefined} className="mt-1 w-full rounded border border-stone-400 px-3 py-2">
              <option value="">{t("reasonNone")}</option>
              {VERIFICATION_REJECT_CODES.map((code) => (
                <option key={code} value={code}>
                  {tv(`reasons.${code}`)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="v-note" className="font-medium">
              {t("note")}
            </label>
            <textarea id="v-note" name="note" rows={3} maxLength={VERIFICATION_NOTE_MAX} aria-describedby="v-note-hint" aria-invalid={error === "note" || undefined} className="mt-1 w-full rounded border border-stone-400 px-3 py-2" />
            <p id="v-note-hint" className="text-xs text-stone-700">
              {t("noteHint")}
            </p>
          </div>
          <button type="submit" className="self-start rounded bg-emerald-800 px-4 py-2 font-medium text-white">
            {t("submit")}
          </button>
        </form>
      )}

      {canRevoke && (
        <form action={revokeVerificationAction} id="revoke" className="mt-6 flex flex-col gap-4 rounded border border-red-300 p-4">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="id" value={v.id} />
          <input type="hidden" name="userId" value={v.user.id} />
          <h2 className="text-xl font-semibold">{t("revokeTitle")}</h2>
          <p className="text-sm">{t("revokeHint")}</p>
          <div>
            <label htmlFor="r-code" className="font-medium">
              {t("reason")}
            </label>
            <select id="r-code" name="code" required defaultValue="" className="mt-1 w-full rounded border border-stone-400 px-3 py-2">
              <option value="" disabled>
                {t("reasonNone")}
              </option>
              {REVOKE_CODES.map((code) => (
                <option key={code} value={code}>
                  {tv(`revokeReasons.${code}`)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="r-note" className="font-medium">
              {t("note")}
            </label>
            <textarea id="r-note" name="note" rows={3} maxLength={VERIFICATION_NOTE_MAX} aria-describedby="r-note-hint" className="mt-1 w-full rounded border border-stone-400 px-3 py-2" />
            <p id="r-note-hint" className="text-xs text-stone-700">
              {t("noteHint")}
            </p>
          </div>
          <button type="submit" className="self-start rounded bg-red-800 px-4 py-2 font-medium text-white">
            {t("revokeSubmit")}
          </button>
        </form>
      )}
    </main>
  );
}
