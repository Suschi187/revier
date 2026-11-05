import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { counterpartName } from "@/lib/chat/names";
import { requireSessionUser } from "@/lib/services/auth";
import { CHAT_REPORT_REASONS, conversationInfo, messageForReport } from "@/lib/services/chat";
import { reportAction } from "../../actions";

// Melden aus dem Chat (ADR 017): eine fremde Nachricht oder das Profil des Gegenübers. Ohne Legal-Gate, damit
// auch Konten ohne aktuelle Zustimmung melden können (App Store, DSA). Funktioniert ohne JavaScript.
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Chat.report");
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

const ERRORS = ["reason", "limit", "failed"] as const;

export default async function ReportPage(props: Props) {
  const locale = (await getLocale()) as AppLocale;
  const { id } = await props.params;
  const user = await requireSessionUser(locale, `/${locale}/account/messages/${id}/report`);
  const [t, tc, info, query] = await Promise.all([getTranslations("Chat.report"), getTranslations("Chat"), conversationInfo(id), props.searchParams]);
  const messageId = typeof query.message === "string" ? query.message : "";
  const message = info && messageId ? await messageForReport(messageId, id, user.id) : null;
  const profile = query.profile === "1" && info !== null;
  const error = ERRORS.find((code) => code === query.error);

  if (!info || (!message && !profile)) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
        <Link href="/account/messages" className="underline">{tc("conversation.backToList")}</Link>
        <p className="mt-4">{tc("conversation.notFound")}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
      <Link href={`/account/messages/${id}`} className="underline">{t("cancel")}</Link>
      <h1 className="mt-4 text-3xl font-semibold">{message ? t("titleMessage") : t("titleProfile")}</h1>
      <p className="mt-2 [overflow-wrap:anywhere]">{counterpartName(info, tc("accountUnavailable"))}</p>
      {message && (
        <figure className="mt-4 rounded border border-stone-300 p-3">
          <figcaption className="text-sm text-stone-700">{t("quoted")}</figcaption>
          <blockquote className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{message.body}</blockquote>
        </figure>
      )}
      {error && <p className="mt-4 text-red-800" role="alert">{t(`errors.${error}`)}</p>}
      <form action={reportAction} className="mt-6 grid gap-4">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="target" value={message ? "message" : "profile"} />
        <input type="hidden" name="targetId" value={message ? message.id : info.counterpart.id} />
        <fieldset>
          <legend className="font-medium">{t("reason")}</legend>
          <div className="mt-1 grid gap-1">
            {CHAT_REPORT_REASONS.map((reason) => (
              <label key={reason} className="flex items-center gap-2">
                <input type="radio" name="reason" value={reason} required />
                {t(`reasons.${reason}`)}
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <label htmlFor="report-note" className="block font-medium">{t("note")}</label>
          <textarea id="report-note" name="note" rows={3} maxLength={1000} aria-describedby="report-note-hint"
            className="w-full rounded border border-stone-400 px-2 py-1.5" />
          <p id="report-note-hint" className="text-sm text-stone-700">{t("noteHint")}</p>
        </div>
        <button type="submit" className="justify-self-start rounded bg-stone-900 px-4 py-2 text-white">{t("submit")}</button>
      </form>
    </main>
  );
}
