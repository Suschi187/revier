import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { LegalOutline, PlaceholderNote, type OutlineSection } from "@/components/legal/LegalOutline";
import { Link } from "@/i18n/navigation";
import { localeAlternates } from "@/i18n/metadata";
import type { AppLocale } from "@/i18n/routing";

// Platzhalter, bis der Anwalt liefert (CLAUDE.md, SPEC 7.2). Deshalb noindex.
export async function generateMetadata(): Promise<Metadata> {
  const locale = (await getLocale()) as AppLocale;
  const t = await getTranslations("Legal.terms");
  return { title: t("title"), robots: { index: false, follow: true }, alternates: localeAlternates(locale, "/terms") };
}

export default async function TermsPage() {
  const t = await getTranslations("Legal");
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
      <h1 className="text-3xl font-semibold">{t("terms.title")}</h1>
      <PlaceholderNote />
      <LegalOutline sections={t.raw("terms.sections") as OutlineSection[]} />
      <p className="mt-8">
        <Link href="/guidelines" className="underline">
          {t("guidelines.title")}
        </Link>
      </p>
    </main>
  );
}
