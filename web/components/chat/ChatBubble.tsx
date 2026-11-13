import type { ReactNode } from "react";

/**
 * Chat-Blase (Styleguide „Chat“): eigene Nachrichten rechts in Waldgrün, fremde links weiß mit Sandrahmen;
 * Spitze zur Absenderseite. `meta` trägt Zeit und Lesestatus, `footer` z. B. den Melden-Link.
 */
export function ChatBubble({ mine, meta, footer, children, id }: { mine: boolean; meta: ReactNode; footer?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <li
      id={id}
      className={`max-w-[85%] rounded-bubble px-3.5 py-2.5 ${mine ? "justify-self-end rounded-br-tail bg-forest text-offwhite" : "justify-self-start rounded-bl-tail border border-sand bg-surface"}`}
    >
      <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{children}</p>
      <p className={`mt-1 text-xs ${mine ? "text-right text-offwhite" : "text-muted"}`}>{meta}</p>
      {footer}
    </li>
  );
}

/** Hinweis des Systems im Verlauf (Anzeige beendet, Nutzer blockiert): mittig, ohne Blase. */
export function ChatNotice({ children }: { children: ReactNode }) {
  return <li className="justify-self-center px-2 text-center text-meta text-muted">{children}</li>;
}
