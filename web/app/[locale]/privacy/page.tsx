import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

// Platzhalter, bis der Anwalt liefert (CLAUDE.md, SPEC 7.2). Deshalb noindex.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Legal.privacy");
  return { title: t("title"), robots: { index: false, follow: true } };
}

export default async function PrivacyPage() {
  const t = await getTranslations("Legal");
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
      <h1 className="text-3xl font-semibold">{t("privacy.title")}</h1>
      <p role="note" className="mt-4 rounded border border-amber-600 bg-amber-50 p-3 text-amber-950">
        {t("placeholder")}
      </p>
    </main>
  );
}
