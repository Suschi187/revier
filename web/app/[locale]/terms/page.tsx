import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { LegalOutline, PlaceholderNote, type OutlineSection } from "@/components/legal/LegalOutline";
import { Link } from "@/i18n/navigation";
import { localeAlternates } from "@/i18n/metadata";
import type { AppLocale } from "@/i18n/routing";
import { ui } from "@/components/ui/styles";

// Platzhalter, bis der Anwalt liefert (CLAUDE.md, SPEC 7.2). Deshalb noindex.
export async function generateMetadata(): Promise<Metadata> {
  const locale = (await getLocale()) as AppLocale;
  const t = await getTranslations("Legal.terms");
  return { title: t("title"), robots: { index: false, follow: true }, alternates: localeAlternates(locale, "/terms") };
}

export default async function TermsPage() {
  const t = await getTranslations("Legal");
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6">
      <h1 className="font-display text-2xl font-extrabold uppercase leading-tight [overflow-wrap:anywhere] hyphens-auto sm:text-3xl">{t("terms.title")}</h1>
      <PlaceholderNote />
      <LegalOutline sections={t.raw("terms.sections") as OutlineSection[]} />
      <p className="mt-6">
        <Link href="/guidelines" className={ui.link}>
          {t("guidelines.title")}
        </Link>
      </p>
    </main>
  );
}
