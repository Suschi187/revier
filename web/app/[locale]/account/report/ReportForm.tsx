import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { REPORT_NOTE_MAX, REPORT_REASONS } from "@/lib/reports";
import type { ReportableTarget } from "@/lib/services/reports";
import { reportTargetAction } from "./actions";

const ERRORS = ["reason", "note", "goodFaith", "duplicate", "limit", "unavailable", "failed"] as const;

/**
 * Formular „Melden“ für Anzeige und Anbieter (ADR 020). Die Seiten unter listing/[id] und profile/[id] prüfen Session
 * und Ziel; nicht sichtbare, eigene und unbekannte Ziele ergeben dieselbe Seite. Ohne JavaScript per PRG.
 */
export async function ReportForm({ locale, type, target, error }: { locale: AppLocale; type: "listing" | "profile"; target: ReportableTarget | null; error: unknown }) {
  const t = await getTranslations("Report");
  const shown = ERRORS.find((e) => e === error);
  if (!target) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
        <h1 className="text-3xl font-semibold">{t("title")}</h1>
        <p className="mt-4">{t("unavailable")}</p>
        <Link href="/account/reports" className="mt-4 inline-block underline">{t("myReports")}</Link>
      </main>
    );
  }
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
      <h1 className="text-3xl font-semibold">{t(type === "listing" ? "titleListing" : "titleProfile")}</h1>
      <p className="mt-2 font-medium [overflow-wrap:anywhere]">{target.label}</p>
      <p className="mt-2 text-sm text-stone-700">{t("intro")}</p>
      {shown && <p className="mt-4 text-red-800" role="alert" id="report-error">{t(`errors.${shown}`)}</p>}
      <form action={reportTargetAction} className="mt-6 grid gap-4" aria-describedby={shown ? "report-error" : undefined}>
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="type" value={type} />
        <input type="hidden" name="id" value={target.id} />
        <fieldset>
          <legend className="font-medium">{t("reason")}</legend>
          <div className="mt-1 grid gap-1">
            {REPORT_REASONS[type].map((reason) => (
              <label key={reason} className="flex items-center gap-2">
                <input type="radio" name="reason" value={reason} required />
                {t(`reasons.${reason}`)}
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <label htmlFor="report-note" className="block font-medium">{t("note")}</label>
          <textarea id="report-note" name="note" rows={4} maxLength={REPORT_NOTE_MAX} aria-describedby="report-note-hint"
            className="w-full rounded border border-stone-400 px-2 py-1.5" />
          <p id="report-note-hint" className="text-sm text-stone-700">{t("noteHint")}</p>
        </div>
        {/* PLATZHALTER (SPEC 7.2): Wortlaut der Zusicherung nach DSA Art. 16 Abs. 2 d liefert der Anwalt; nicht gespeichert. */}
        <label className="flex items-start gap-2">
          <input type="checkbox" name="goodFaith" required className="mt-1" />
          <span>{t("goodFaith")}</span>
        </label>
        <button type="submit" className="justify-self-start rounded bg-stone-900 px-4 py-2 text-white">{t("submit")}</button>
      </form>
    </main>
  );
}
