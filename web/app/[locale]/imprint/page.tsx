import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LegalOutline, PlaceholderNote, type OutlineSection } from "@/components/legal/LegalOutline";

// Entwurf, bis der Anwalt prüft (CLAUDE.md, SPEC 7.2). Deshalb noindex und als Hinweis markiert.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Legal.imprint");
  return { title: t("title"), robots: { index: false, follow: true } };
}

export default async function ImprintPage() {
  const t = await getTranslations("Legal");
  return (
    <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6">
      <h1 className="font-display text-2xl font-extrabold uppercase leading-tight [overflow-wrap:anywhere] hyphens-auto sm:text-3xl">{t("imprint.title")}</h1>
      <PlaceholderNote />
      <LegalOutline sections={t.raw("imprint.sections") as OutlineSection[]} />
    </main>
  );
}
