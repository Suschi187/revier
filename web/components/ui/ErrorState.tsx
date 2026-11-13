import type { ReactNode } from "react";
import { LogoMark } from "@/components/brand/Logo";
import { ui } from "./styles";

/**
 * Fehlerseiten (SPEC M10a Schritt 4.9): Statuscode groß in Marken-Orange (dunkler Ton für Text, DESIGN.md), Titel,
 * optional ein Satz und Wege zurück. Ohne Anfragedaten, damit die Seiten vollständig im ersten HTML stehen.
 */
export function ErrorState({ code, title, text, children }: { code: string; title: ReactNode; text?: ReactNode; children: ReactNode }) {
  return (
    <div className={`${ui.card} flex flex-col items-center gap-3 px-5 py-10 text-center sm:px-10`}>
      <LogoMark size={48} />
      <p aria-hidden="true" className="font-display text-6xl font-extrabold leading-none text-brand-ink">{code}</p>
      {title}
      {text}
      <div className="mt-3 flex flex-wrap justify-center gap-3">{children}</div>
    </div>
  );
}
