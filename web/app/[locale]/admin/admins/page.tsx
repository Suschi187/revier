import type { Metadata } from "next";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { candidateProfile, listAdmins, requireAdmin } from "@/lib/services/admin";
import { changeRole, findAdminCandidate } from "./actions";

// Blockierend (403 per forbidden(), ADR 014).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Admin.admins");
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NOTICES = ["granted", "revoked"] as const;
const ERRORS = ["notFound", "code", "stepUp", "waiting", "limit", "lastAdmin", "forbidden", "failed"] as const;
const input = "mt-1 block w-full max-w-md rounded border border-stone-400 px-3 py-2";
const codeInput = "mt-1 block w-40 rounded border border-stone-400 px-3 py-2 tracking-widest";
const button = "rounded bg-emerald-800 px-4 py-2 font-medium text-white";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AdminsPage({ searchParams }: Props) {
  const locale = (await getLocale()) as AppLocale;
  const me = await requireAdmin(locale, `/${locale}/admin/admins`);
  const query = await searchParams;
  const candidateId = typeof query.candidate === "string" && UUID.test(query.candidate) ? query.candidate : null;
  const [t, format, admins, candidate] = await Promise.all([
    getTranslations("Admin.admins"),
    getFormatter(),
    listAdmins(),
    candidateId ? candidateProfile(candidateId) : Promise.resolve(null),
  ]);
  const date = (value: string) => format.dateTime(new Date(value), { dateStyle: "medium" });
  const notice = NOTICES.find((n) => n === query.notice);
  const error = ERRORS.find((e) => e === query.error);
  const until = typeof query.until === "string" && !Number.isNaN(Date.parse(query.until)) ? query.until : null;
  const isAdmin = candidateId ? admins.some((a) => a.userId === candidateId) : false;
  const hidden = (change: "grant" | "revoke", userId: string) => (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="change" value={change} />
      <input type="hidden" name="userId" value={userId} />
    </>
  );

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
      <Link href="/admin" className="underline">
        {t("back")}
      </Link>
      <h1 className="mt-4 text-3xl font-semibold">{t("title")}</h1>
      <p className="mt-3">{t("intro")}</p>
      <p className="mt-2 text-sm text-stone-700">{t("rules")}</p>
      {notice && (
        <p role="status" className="mt-4 text-emerald-800">
          {t(`notices.${notice}`)}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-4 rounded bg-red-50 p-3 text-red-800">
          {error === "waiting" ? (until ? t("errors.waiting", { date: date(until) }) : t("errors.waitingNoDate")) : t(`errors.${error}`)}
        </p>
      )}

      <section className="mt-8" aria-labelledby="admins-list">
        <h2 id="admins-list" className="text-xl font-semibold">
          {t("listTitle")}
        </h2>
        <ul className="mt-3 flex flex-col gap-3">
          {admins.map((entry) => {
            const name = entry.displayName ?? entry.userId.slice(0, 8);
            return (
              <li key={entry.userId} className="rounded border border-stone-300 p-3">
                <p className="font-medium">
                  {name} {entry.userId === me.id && t("you")}
                </p>
                <p className="text-sm">
                  {t("since", { date: date(entry.adminSince) })}
                  {!entry.active && <> · {t("inactive")}</>}
                </p>
                <details className="mt-2">
                  <summary className="cursor-pointer underline">{t("revoke")}</summary>
                  <form action={changeRole} className="mt-2 flex flex-col gap-2">
                    {hidden("revoke", entry.userId)}
                    <label htmlFor={`code-${entry.userId}`} className="text-sm font-medium">
                      {t("code")}
                    </label>
                    <input id={`code-${entry.userId}`} name="code" inputMode="numeric" autoComplete="one-time-code" required className={codeInput} />
                    <button type="submit" className="self-start rounded border border-red-700 px-3 py-1.5 text-red-800">
                      {t("revokeConfirm", { name })}
                    </button>
                  </form>
                </details>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="mt-8" aria-labelledby="admins-find">
        <h2 id="admins-find" className="text-xl font-semibold">
          {t("findTitle")}
        </h2>
        <form action={findAdminCandidate} className="mt-3 flex flex-col gap-2">
          <input type="hidden" name="locale" value={locale} />
          <label htmlFor="admin-email" className="font-medium">
            {t("email")}
          </label>
          <input id="admin-email" name="email" type="email" autoComplete="off" required className={input} />
          <button type="submit" className={`self-start ${button}`}>
            {t("find")}
          </button>
        </form>

        {candidate && candidateId && (
          <div className="mt-4 rounded border border-stone-400 p-4">
            <p className="font-medium">{t("candidate", { name: candidate.displayName, date: date(candidate.memberSince) })}</p>
            {isAdmin ? (
              <p className="mt-2">{t("alreadyAdmin")}</p>
            ) : (
              <form action={changeRole} className="mt-3 flex flex-col gap-2">
                {hidden("grant", candidateId)}
                <label htmlFor="grant-code" className="font-medium">
                  {t("code")}
                </label>
                <input id="grant-code" name="code" inputMode="numeric" autoComplete="one-time-code" required className={codeInput} />
                <button type="submit" className={`self-start ${button}`}>
                  {t("grant")}
                </button>
              </form>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
