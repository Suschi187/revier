import { getTranslations } from "next-intl/server";

export type OutlineSection = { title: string; points: string[] };

/** Markierter Hinweis auf Platzhalter-Rechtstexte (CLAUDE.md, SPEC 7.2): nie als fertig ausgeben. */
export async function PlaceholderNote() {
  const t = await getTranslations("Legal");
  return (
    <p role="note" className="mt-4 rounded border border-amber-600 bg-amber-50 p-3 text-amber-950">
      {t("placeholder")}
    </p>
  );
}

/** Gliederung aus den tatsächlichen Verarbeitungen (Plan M9 2), als Stichpunkte statt Rechtstext. */
export async function LegalOutline({ sections }: { sections: OutlineSection[] }) {
  const t = await getTranslations("Legal");
  return (
    <>
      <p className="mt-4 text-sm text-neutral-700">{t("outlineNote")}</p>
      {sections.map((section) => (
        <section key={section.title} className="mt-8">
          <h2 className="text-xl font-semibold">{section.title}</h2>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            {section.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
