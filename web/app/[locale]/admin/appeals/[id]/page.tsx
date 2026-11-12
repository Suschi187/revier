import type { Metadata } from "next";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { actionKey, REPORT_NOTE_MAX } from "@/lib/reports";
import { requireAdmin } from "@/lib/services/admin";
import { getAppeal } from "@/lib/services/admin-reports";
import { decideAppealAction } from "../actions";

// Beschwerde mit der ursprünglichen Entscheidung (ADR 020). Nie die Identität des ursprünglichen Admins, nur der
// Hinweis „deine eigene Entscheidung“. Status und CSP setzt der Proxy (ADR 014).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Admin.appeals");
  return { title: t("detailMetaTitle"), robots: { index: false, follow: false } };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ERRORS = ["note", "forbidden", "notFound", "failed"] as const;

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AdminAppealPage(props: Props) {
  const locale = (await getLocale()) as AppLocale;
  const [{ id }, query] = await Promise.all([props.params, props.searchParams]);
  await requireAdmin(locale, `/${locale}/admin/appeals/${UUID.test(id) ? id : ""}`);
  if (!UUID.test(id)) notFound();
  const appeal = await getAppeal(id);
  if (!appeal) notFound();
  const [t, td, tr, format] = await Promise.all([getTranslations("Admin.appeals"), getTranslations("Decisions"), getTranslations("Report"), getFormatter()]);
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" });
  const error = ERRORS.find((e) => e === query.error);
  const key = actionKey(appeal.decision?.action ?? appeal.decisionAction);
  const d = appeal.decision;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
      <Link href="/admin/appeals" className="underline">{t("back")}</Link>
      <h1 className="mt-4 text-3xl font-semibold break-words">{t("itemTitle", { action: key ? td(`actions.${key}`) : appeal.decisionAction, name: appeal.user.displayName })}</h1>
      <p className="mt-1 text-sm text-stone-700">{t("submitted", { date: date(appeal.createdAt) })}</p>

      <section className="mt-6 rounded border border-stone-300 p-3" aria-labelledby="h-decision">
        <h2 id="h-decision" className="font-semibold">{t("decision")}</h2>
        {d ? (
          <>
            <p className="text-sm">{date(d.createdAt)}{d.targetLabel ? ` · ${d.targetLabel}` : ""}</p>
            {d.outcome && <p className="text-sm">{tr(`targets.${d.targetType}`)} · {tr(`outcomes.${d.outcome}`)}</p>}
            {d.code && <p className="text-sm">{t("code")}: {d.code}</p>}
            {d.reason && <p className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{d.reason}</p>}
            {d.targetType === "listing" && <Link href={`/admin/reports/listing/${d.targetId}`} className="text-sm underline">{t("targetLink")}</Link>}
            {d.byMe && <p className="mt-2 w-fit rounded bg-amber-100 px-2 py-0.5 text-sm text-amber-950">{t("byMe")}</p>}
          </>
        ) : (
          <p className="text-sm">{t("decisionGone")}</p>
        )}
      </section>

      <section className="mt-4" aria-labelledby="h-text">
        <h2 id="h-text" className="font-semibold">{t("text")}</h2>
        <blockquote className="mt-1 whitespace-pre-wrap rounded bg-stone-100 p-3 [overflow-wrap:anywhere]">{appeal.text}</blockquote>
      </section>

      {appeal.status !== "open" ? (
        <p className="mt-6">{t(`status.${appeal.status}`)}{appeal.decisionNote ? `: ${appeal.decisionNote}` : ""}{appeal.sameReviewer ? ` (${t("sameReviewer")})` : ""}</p>
      ) : (
        <>
          {error && <p role="alert" id="ap-error" className="mt-6 rounded bg-red-50 p-3 text-red-800">{t(`errors.${error}`)}</p>}
          <form action={decideAppealAction} className="mt-6 flex flex-col gap-4 rounded border border-stone-400 p-4">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="id" value={appeal.id} />
            <input type="hidden" name="userId" value={appeal.user.id} />
            <fieldset className="flex flex-col gap-2" aria-describedby={error ? "ap-error" : undefined}>
              <legend className="font-medium">{t("outcome")}</legend>
              <label className="flex items-center gap-2"><input type="radio" name="outcome" value="upheld" required />{t("outcomes.upheld")}</label>
              <label className="flex items-center gap-2"><input type="radio" name="outcome" value="reversed" required />{t("outcomes.reversed")}</label>
            </fieldset>
            <div>
              <label htmlFor="ap-note" className="font-medium">{t("note")}</label>
              <textarea id="ap-note" name="note" rows={3} required maxLength={REPORT_NOTE_MAX} aria-describedby="ap-note-hint" className="mt-1 w-full rounded border border-stone-400 px-3 py-2" />
              <p id="ap-note-hint" className="text-xs text-stone-700">{t("noteHint")}</p>
            </div>
            <button type="submit" className="self-start rounded bg-emerald-800 px-4 py-2 font-medium text-white">{t("submit")}</button>
          </form>
        </>
      )}
    </main>
  );
}
