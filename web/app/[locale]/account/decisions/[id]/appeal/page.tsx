import type { Metadata } from "next";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { actionKey, APPEAL_MAX, APPEAL_MIN } from "@/lib/reports";
import { requireSessionUser } from "@/lib/services/auth";
import { getMyDecision } from "@/lib/services/decisions";
import { submitAppealAction } from "./actions";

// Beschwerde einlegen (DSA Art. 20, ADR 020). Fremde, unbekannte und abgelaufene Entscheidungen ergeben dieselbe Seite.
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Appeal");
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ERRORS = ["text", "notFound", "failed"] as const;

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AppealPage(props: Props) {
  const locale = (await getLocale()) as AppLocale;
  const [{ id }, query] = await Promise.all([props.params, props.searchParams]);
  await requireSessionUser(locale, `/${locale}/account/decisions/${UUID.test(id) ? id : ""}/appeal`);
  const [t, td, format, decision] = await Promise.all([
    getTranslations("Appeal"),
    getTranslations("Decisions"),
    getFormatter(),
    UUID.test(id) ? getMyDecision(id) : null,
  ]);
  const error = ERRORS.find((e) => e === query.error);
  const key = decision ? actionKey(decision.action) : null;

  if (!decision || !decision.appealable) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
        <Link href="/account/decisions" className="underline">{t("back")}</Link>
        <h1 className="mt-4 text-3xl font-semibold">{t("title")}</h1>
        <p className="mt-4">{decision?.appealId ? t("alreadyAppealed") : t("unavailable")}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
      <Link href="/account/decisions" className="underline">{t("back")}</Link>
      <h1 className="mt-4 text-3xl font-semibold">{t("title")}</h1>
      <p className="mt-2 font-medium">{key ? td(`actions.${key}`) : decision.action} · {format.dateTime(new Date(decision.createdAt), { dateStyle: "medium" })}</p>
      <p className="mt-2">{t("intro", { date: format.dateTime(new Date(decision.appealUntil), { dateStyle: "long" }) })}</p>
      {error && <p className="mt-4 text-red-800" role="alert" id="appeal-error">{t(`errors.${error}`)}</p>}
      <form action={submitAppealAction} className="mt-6 grid gap-4">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="id" value={decision.id} />
        <div>
          <label htmlFor="appeal-text" className="block font-medium">{t("text")}</label>
          <textarea id="appeal-text" name="text" rows={6} minLength={APPEAL_MIN} maxLength={APPEAL_MAX} required
            aria-describedby={`appeal-hint${error ? " appeal-error" : ""}`} aria-invalid={error === "text" || undefined}
            className="w-full rounded border border-stone-400 px-2 py-1.5" />
          <p id="appeal-hint" className="text-sm text-stone-700">{t("textHint")}</p>
        </div>
        <button type="submit" className="justify-self-start rounded bg-stone-900 px-4 py-2 text-white">{t("submit")}</button>
      </form>
    </main>
  );
}
