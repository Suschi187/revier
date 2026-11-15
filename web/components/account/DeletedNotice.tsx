"use client";

import { useSearchParams } from "next/navigation";

// Hinweis nach dem Löschantrag (ADR 019, H7): „wird gelöscht“, nicht „ist gelöscht“. Clientseitig, damit die
// gecachte Startseite statisch bleibt; ohne JavaScript entfällt nur der Hinweis. Text als Eigenschaft, damit die
// Startseite keine Übersetzungen an den Browser geben muss.
export function DeletedNotice({ text }: { text: string }) {
  if (useSearchParams().get("deleted") !== "1") return null;
  return <p role="status" className="mb-6 rounded-btn border border-success bg-success-soft p-3 text-success">{text}</p>;
}
