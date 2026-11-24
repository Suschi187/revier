import { getTranslations } from "next-intl/server";
import { Icon } from "@/components/ui/Icon";
import { ui } from "@/components/ui/styles";

export type OutlineSection = { title: string; points: string[] };

/** Markierter Hinweis auf Entwürfe der Rechtstexte (CLAUDE.md, SPEC 7.2): nie als fertig ausgeben. */
export async function PlaceholderNote() {
  const t = await getTranslations("Legal");
  return (
    <p role="note" className="mt-4 flex items-start gap-2 rounded-card border border-notice bg-notice-soft p-3 text-notice">
      <Icon name="scale" size={20} className="mt-0.5 shrink-0" />
      <span>{t("placeholder")}</span>
    </p>
  );
}

/** Rechtstext in Abschnitten mit Absätzen (Entwurf 2026-11-25, Grundlage: tatsächliche Verarbeitungen, Plan M9 2). */
export async function LegalOutline({ sections }: { sections: OutlineSection[] }) {
  const t = await getTranslations("Legal");
  return (
    <>
      <p className="mt-4 text-sm text-muted">{t("outlineNote")}</p>
      {sections.map((section) => (
        <section key={section.title} className={`${ui.card} mt-4 p-5`}>
          <h2 className={`${ui.headingCaps} text-base [overflow-wrap:anywhere] sm:text-lg`}>{section.title}</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 marker:text-brand-ink">
            {section.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
