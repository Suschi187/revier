import type { Metadata } from "next";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { ACCOUNT_CODES, REPORT_NOTE_MAX } from "@/lib/reports";
import { requireAdmin } from "@/lib/services/admin";
import { findAccount } from "@/lib/services/admin-reports";
import { accountAction } from "../actions";

// Konto im Admin (ADR 020): Sperren, Entsperren, Verwarnen mit Code und Begründung für den Betroffenen (H9). Jede
// Ansicht zählt als Suche (Limit, Audit `user.looked_up`). Konten mit Rolle lassen sich nicht sperren.
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Admin.users");
  return { title: t("detailMetaTitle"), robots: { index: false, follow: false } };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ERRORS = ["code", "note", "forbidden", "adminRole", "decided", "notFound", "failed"] as const;
const NOTICES = ["block", "unblock", "warn"] as const;

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AdminUserPage(props: Props) {
  const locale = (await getLocale()) as AppLocale;
  const [{ id }, query] = await Promise.all([props.params, props.searchParams]);
  await requireAdmin(locale, `/${locale}/admin/users/${UUID.test(id) ? id : ""}`);
  if (!UUID.test(id)) notFound();
  const result = await findAccount(id);
  const [t, ta, tp, tm, format] = await Promise.all([
    getTranslations("Admin.users"),
    getTranslations("Account"),
    getTranslations("Profile"),
    getTranslations("Moderation"),
    getFormatter(),
  ]);
  if (!result.ok) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
        <Link href="/admin/users" className="underline">{t("back")}</Link>
        <p role="alert" className="mt-4 text-red-800">{t(`errors.${result.error}`)}</p>
      </main>
    );
  }
  const account = result.account;
  if (!account) notFound();
  const error = ERRORS.find((e) => e === query.error);
  const notice = NOTICES.find((n) => n === query.notice);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
      <Link href="/admin/users" className="underline">{t("back")}</Link>
      <h1 className="mt-4 text-3xl font-semibold break-words">{account.displayName}</h1>
      {notice && <p role="status" className="mt-4 text-emerald-800">{t(`notices.${notice}`)}</p>}
      <dl className="mt-4 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="font-medium">{t("accountType")}</dt>
        <dd>{ta(`accountTypes.${account.accountType}`)}</dd>
        <dt className="font-medium">{t("country")}</dt>
        <dd>{tp(`countries.${account.country}`)}</dd>
        <dt className="font-medium">{t("memberSince")}</dt>
        <dd>{format.dateTime(new Date(account.memberSince), { dateStyle: "medium" })}</dd>
        <dt className="font-medium">{t("verification")}</dt>
        <dd>{ta(`verificationStatus.${account.verificationStatus}`)}</dd>
        <dt className="font-medium">{t("listings")}</dt>
        <dd>{account.listingCount}</dd>
        <dt className="font-medium">{t("openReports")}</dt>
        <dd>{account.openReports}</dd>
        <dt className="font-medium">{t("status")}</dt>
        <dd className={account.isBlocked ? "font-medium text-red-800" : undefined}>{account.isBlocked ? t("blocked") : t("active")}</dd>
      </dl>
      {account.hasRole && <p className="mt-4 font-medium">{t("hasRole")}</p>}
      {error && <p role="alert" id="a-error" className="mt-6 rounded bg-red-50 p-3 text-red-800">{t(`errors.${error}`)}</p>}

      {!account.hasRole && (
        <form action={accountAction} className="mt-6 flex flex-col gap-4 rounded border border-stone-400 p-4">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="id" value={account.id} />
          <fieldset className="flex flex-col gap-2" aria-describedby={error ? "a-error" : undefined}>
            <legend className="font-medium">{t("action")}</legend>
            {account.isBlocked ? (
              <label className="flex items-center gap-2"><input type="radio" name="action" value="unblock" required />{t("actions.unblock")}</label>
            ) : (
              <>
                <label className="flex items-center gap-2"><input type="radio" name="action" value="warn" required />{t("actions.warn")}</label>
                <label className="flex items-center gap-2"><input type="radio" name="action" value="block" required />{t("actions.block")}</label>
              </>
            )}
          </fieldset>
          <div>
            <label htmlFor="a-code" className="font-medium">{t("code")}</label>
            <select id="a-code" name="code" defaultValue="" className="mt-1 w-full rounded border border-stone-400 px-3 py-2">
              <option value="">{t("codeNone")}</option>
              {ACCOUNT_CODES.map((code) => <option key={code} value={code}>{tm(`accountCodes.${code}`)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="a-note" className="font-medium">{t("note")}</label>
            <textarea id="a-note" name="note" rows={3} maxLength={REPORT_NOTE_MAX} aria-describedby="a-note-hint" className="mt-1 w-full rounded border border-stone-400 px-3 py-2" />
            <p id="a-note-hint" className="text-xs text-stone-700">{t("noteHint")}</p>
          </div>
          <button type="submit" className="self-start rounded bg-red-800 px-4 py-2 font-medium text-white">{t("submit")}</button>
        </form>
      )}
    </main>
  );
}
