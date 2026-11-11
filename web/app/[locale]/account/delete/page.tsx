import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { ReauthForm } from "@/components/account/ReauthForm";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { deletionPending } from "@/lib/services/account";
import { requireSessionUser } from "@/lib/services/auth";
import { deleteAccountAction } from "./actions";

// Konto löschen (ADR 019): erklärt, was gelöscht wird und was pseudonymisiert bleibt, dann frische Anmeldung (Client)
// und Bestätigung (Server Action, auch ohne JavaScript). requireSessionUser statt requireOnboardedUser (Review A4):
// auch ohne aktuelle Zustimmung und für gesperrte Konten (App Store, DSGVO).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("AccountDelete");
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

const DELETED = ["profile", "listings", "messages", "searches", "documents", "login"] as const;
const KEPT = ["audit", "reports", "snapshots"] as const;
const ERRORS = ["reauth", "step_up", "admin_role", "confirm", "failed"] as const;

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AccountDeletePage(props: Props) {
  const locale = (await getLocale()) as AppLocale;
  const user = await requireSessionUser(locale, `/${locale}/account/delete`);
  const [t, tc, query, pending] = await Promise.all([
    getTranslations("AccountDelete"),
    getTranslations("Chat"),
    props.searchParams,
    deletionPending(user.id),
  ]);
  const error = ERRORS.find((e) => e === query.error) ?? null;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
      <Link href="/account" className="underline">{tc("back")}</Link>
      <h1 className="mt-4 text-3xl font-semibold">{t("title")}</h1>
      {pending ? (
        <p role="status" className="mt-6 font-medium">{t("pending")}</p>
      ) : (
        <>
          <p className="mt-2">{t("intro")}</p>
          <h2 className="mt-6 text-xl font-semibold">{t("deletedTitle")}</h2>
          <ul className="mt-2 list-disc space-y-1 pl-6">{DELETED.map((k) => <li key={k}>{t(`deleted.${k}`)}</li>)}</ul>
          <h2 className="mt-6 text-xl font-semibold">{t("keptTitle")}</h2>
          <ul className="mt-2 list-disc space-y-1 pl-6">{KEPT.map((k) => <li key={k}>{t(`kept.${k}`)}</li>)}</ul>
          <p className="mt-4">
            {t("exportHint")}{" "}
            <Link href="/account/data" className="underline">{t("exportLink")}</Link>
          </p>
          {error && <p role="alert" className="mt-6 text-red-700">{t(`errors.${error}`)}</p>}
          <section className="mt-8 rounded border border-neutral-300 p-4">
            <h2 className="text-xl font-semibold">{t("step1")}</h2>
            <div className="mt-3">
              {user.email ? <ReauthForm email={user.email} userId={user.id} locale={locale} /> : <p>{t("noEmail")}</p>}
              <noscript><p className="mt-2">{t("noscript")}</p></noscript>
            </div>
          </section>
          <section className="mt-6 rounded border border-red-700 p-4">
            <h2 className="text-xl font-semibold">{t("step2")}</h2>
            <form action={deleteAccountAction} className="mt-3 flex flex-col gap-3">
              <input type="hidden" name="locale" value={locale} />
              <label className="flex items-start gap-2">
                <input type="checkbox" name="confirm" value="yes" required className="mt-1" />
                <span>{t("confirmLabel")}</span>
              </label>
              <button type="submit" className="self-start rounded bg-red-800 px-4 py-2 font-medium text-white">{t("submit")}</button>
            </form>
          </section>
        </>
      )}
    </main>
  );
}
