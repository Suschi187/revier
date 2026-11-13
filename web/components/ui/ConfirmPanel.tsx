import type { ReactNode } from "react";

/**
 * Rückfrage vor endgültigen Aktionen (Styleguide „Dialoge“). Ohne JavaScript: ein Link öffnet sie als eigene
 * Ansicht, erst der Button im `action`-Slot löscht. Titel als Frage, ein Satz zur Folge, „Abbrechen“ links,
 * die Aktion rechts in Fehlerrot.
 */
export function ConfirmPanel({ id, title, text, cancel, action }: { id: string; title: ReactNode; text?: ReactNode; cancel: ReactNode; action: ReactNode }) {
  return (
    <div role="group" aria-labelledby={id} className="flex flex-col gap-3 rounded-card border border-sand bg-surface p-5 shadow-dialog">
      <p id={id} className="font-display text-lg font-extrabold uppercase [overflow-wrap:anywhere]">{title}</p>
      {text && <p className="text-compact leading-normal">{text}</p>}
      <div className="flex flex-wrap items-center justify-end gap-3">
        {cancel}
        {action}
      </div>
    </div>
  );
}
