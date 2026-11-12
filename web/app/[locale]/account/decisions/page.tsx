import type { Metadata } from "next";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { actionKey } from "@/lib/reports";
import { requireSessionUser } from "@/lib/services/auth";
import { listMyDecisions } from "@/lib/services/decisions";

// Entscheidungen der Moderation, die das Konto betreffen, mit Begründung und Weg zur Beschwerde (DSA Art. 17, 20;
// ADR 020). Ohne Legal-Gate und für gesperrte Konten (Review A4). Nie die Admin-Identität. Fristen sind Platzhalter.
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Decisions");
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

const CODE_GROUPS: Record<string, "Moderation.reasons" | "Moderation.accountCodes" | "Verification.reasons" | "Verification.revokeReasons"> = {
  "listing.rejected": "Moderation.reasons",
  "listing.draft": "Moderation.reasons",
  "listing.removed": "Moderation.reasons",
  "profile.blocked": "Moderation.accountCodes",
  "profile.warned": "Moderation.accountCodes",
  "verification.rejected": "Verification.reasons",
  "verification.revoked": "Verification.revokeReasons",
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function DecisionsPage(props: Props) {
  const locale = (await getLocale()) as AppLocale;
  await requireSessionUser(locale, `/${locale}/account/decisions`);
  const [t, tr, tv, tm, tc, format, query, decisions] = await Promise.all([
    getTranslations("Decisions"),
    getTranslations("Report"),
    getTranslations("Verification"),
    getTranslations("Moderation"),
    getTranslations("Chat"),
    getFormatter(),
    props.searchParams,
    listMyDecisions(),
  ]);
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium" });
  const codeLabel = (action: string, code: string | null) => {
    const group = CODE_GROUPS[action];
    if (!code || !group) return null;
    const t2 = group.startsWith("Verification") ? tv : tm;
    const key = `${group.split(".")[1]}.${code}`;
    return t2.has(key) ? t2(key) : null;
  };

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
      <Link href="/account" className="underline">{tc("back")}</Link>
      <h1 className="mt-4 text-3xl font-semibold">{t("title")}</h1>
      <p className="mt-2">{t("intro")}</p>
      {/* PLATZHALTER (SPEC 7.2): Rechtsbehelfe und außergerichtliche Streitbeilegung (DSA Art. 17 Abs. 3 f, Art. 21). */}
      <p className="mt-2 text-sm text-stone-700">{t("remedies")}</p>
      {query.notice === "appealed" && <p role="status" className="mt-4 text-emerald-800">{t("appealed")}</p>}
      {decisions.length === 0 ? (
        <p className="mt-6">{t("empty")}</p>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {decisions.map((d) => {
            const key = actionKey(d.action);
            const code = codeLabel(d.action, d.code);
            return (
              <li key={d.id} className="rounded border border-stone-300 p-3">
                <p className="font-medium">{key ? t(`actions.${key}`) : d.action}</p>
                <p className="text-sm text-stone-700">{date(d.createdAt)}</p>
                {d.targetLabel && (
                  <p className="mt-1 [overflow-wrap:anywhere]">
                    {d.action.startsWith("verification.") ? tv(`documentTypes.${d.targetLabel}`) : d.targetLabel}
                  </p>
                )}
                {d.action === "report.handled" && (
                  <p className="mt-1">{tr(`targets.${d.targetType}`)} · {d.outcome ? tr(`outcomes.${d.outcome}`) : tr("outcomeUnknown")}</p>
                )}
                {code && <p className="mt-1">{t("reason")}: {code}</p>}
                {d.reason && <p className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{t("explanation")}: {d.reason}</p>}
                {d.appealStatus ? (
                  <p className="mt-2">{t(`appealStatus.${d.appealStatus}`)}</p>
                ) : d.appealable ? (
                  <p className="mt-2">
                    <Link href={`/account/decisions/${d.id}/appeal`} className="underline">{t("appealLink")}</Link>
                    <span className="ml-2 text-sm text-stone-700">{t("appealUntil", { date: date(d.appealUntil) })}</span>
                  </p>
                ) : (
                  <p className="mt-2 text-sm text-stone-700">{t("appealClosed")}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
