import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { LegalOutline, PlaceholderNote, type OutlineSection } from "@/components/legal/LegalOutline";
import { localeAlternates } from "@/i18n/metadata";
import type { AppLocale } from "@/i18n/routing";

// Richtlinien (verbotene Inhalte, Plan M9 2): Teil der Nutzungsbedingungen, deshalb Platzhalter und noindex.
// Die Punkte folgen den Grund-Codes der Moderation (ADR 014).
export async function generateMetadata(): Promise<Metadata> {
  const locale = (await getLocale()) as AppLocale;
  const t = await getTranslations("Legal.guidelines");
  return { title: t("title"), robots: { index: false, follow: true }, alternates: localeAlternates(locale, "/guidelines") };
}

export default async function GuidelinesPage() {
  const t = await getTranslations("Legal");
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
      <h1 className="text-3xl font-semibold">{t("guidelines.title")}</h1>
      <PlaceholderNote />
      <p className="mt-4">{t("guidelines.intro")}</p>
      <LegalOutline sections={t.raw("guidelines.sections") as OutlineSection[]} />
    </main>
  );
}
