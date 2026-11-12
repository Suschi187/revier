import type { Metadata } from "next";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { VerificationUpload } from "@/components/account/VerificationUpload";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { requireOnboardedUser } from "@/lib/services/gate";
import { getOwnProfile } from "@/lib/services/profile";
import { listOwnVerifications } from "@/lib/services/verification";
import { documentTypesFor } from "@/lib/verification";
import { withdrawVerificationAction } from "./actions";

// Verifizierung (ADR 020, freiwillig): Status, Grund einer Ablehnung oder eines Widerrufs, Upload und Zurückziehen.
// Der Upload braucht JavaScript (Browser-Upload auf den Serverpfad); Status und Zurückziehen gehen ohne.
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Verification");
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

const NOTICES = ["submitted", "withdrawn"] as const;

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function VerificationPage(props: Props) {
  const locale = (await getLocale()) as AppLocale;
  const user = await requireOnboardedUser(locale, `/${locale}/account/verification`);
  const [t, ta, format, query, profile, requests] = await Promise.all([
    getTranslations("Verification"),
    getTranslations("Account"),
    getFormatter(),
    props.searchParams,
    getOwnProfile(user.id),
    listOwnVerifications(user.id),
  ]);
  if (!profile) throw new Error("Profil nicht verfügbar");
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium" });
  const notice = NOTICES.find((n) => n === query.notice);
  const open = requests.find((r) => r.status === "pending");
  const decided = requests.filter((r) => r.status !== "pending");
  // Letzte Entscheidung, ein Widerruf zählt mit seinem Zeitpunkt (wie sync_verification_status).
  const last = [...decided].sort((a, b) => Date.parse(b.revokedAt ?? b.decidedAt ?? b.createdAt) - Date.parse(a.revokedAt ?? a.decidedAt ?? a.createdAt))[0];
  const verified = profile.verificationStatus === "verified";

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
      <Link href="/account" className="underline">
        {t("back")}
      </Link>
      <h1 className="mt-4 text-3xl font-semibold">{t("title")}</h1>
      <p className="mt-2">{t("intro")}</p>
      {/* PLATZHALTER (SPEC 7.2): Was das Badge zusagt, steht in den Nutzungsbedingungen, sobald der Anwalt liefert. */}
      <p className="mt-2 text-sm text-stone-700">{t("badgeNote")}</p>
      <p className="mt-2 text-sm text-stone-700">{t("retention")}</p>

      {notice && (
        <p role="status" className="mt-4 text-emerald-800">
          {t(`notices.${notice}`)}
        </p>
      )}
      {query.error === "withdraw" && (
        <p role="alert" className="mt-4 text-red-700">
          {t("errors.withdraw")}
        </p>
      )}

      <section className="mt-6 flex flex-col gap-2" aria-labelledby="v-status">
        <h2 id="v-status" className="text-xl font-semibold">
          {t("status")}: {ta(`verificationStatus.${profile.verificationStatus}`)}
        </h2>
        <p>{t(`statusText.${profile.verificationStatus}`)}</p>
        {!verified && last?.revokedAt && (
          <p>
            {t("revoked", { date: date(last.revokedAt) })} {last.revokeCode && <>{t("reasonLabel")}: {t(`revokeReasons.${last.revokeCode}`)}.</>}{" "}
            {last.revokeReason}
          </p>
        )}
        {!verified && last?.status === "rejected" && (
          <p>
            {t("rejected", { date: date(last.decidedAt ?? last.createdAt) })}{" "}
            {last.rejectCode && <>{t("reasonLabel")}: {t(`reasons.${last.rejectCode}`)}.</>} {last.rejectReason}
          </p>
        )}
      </section>

      {open && (
        <section className="mt-6 flex flex-col gap-2 rounded border border-stone-300 p-4" aria-labelledby="v-open">
          <h2 id="v-open" className="text-lg font-semibold">
            {t(`documentTypes.${open.documentType}`)}
          </h2>
          <p>{open.submittedAt ? t("inReview", { date: date(open.submittedAt) }) : t("unfinished")}</p>
          <form action={withdrawVerificationAction}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="id" value={open.id} />
            <button type="submit" className="rounded border border-stone-500 px-4 py-2">
              {t("withdraw")}
            </button>
            <p className="mt-1 text-sm text-stone-700">{t("withdrawHint")}</p>
          </form>
        </section>
      )}

      {(!open || !open.submittedAt) && !verified && !profile.isBlocked && (
        <div className="mt-6">
          <VerificationUpload types={documentTypesFor(profile.accountType)} />
          <noscript>
            <p className="mt-2 text-red-700">{t("noscript")}</p>
          </noscript>
        </div>
      )}

      {decided.length > 0 && (
        <section className="mt-8" aria-labelledby="v-history">
          <h2 id="v-history" className="text-xl font-semibold">
            {t("history")}
          </h2>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            {decided.map((r) => (
              <li key={r.id}>
                {t("historyItem", {
                  date: date(r.revokedAt ?? r.decidedAt ?? r.createdAt),
                  type: t(`documentTypes.${r.documentType}`),
                  status: t(`requestStatus.${r.revokedAt ? "revoked" : r.status}`),
                })}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
