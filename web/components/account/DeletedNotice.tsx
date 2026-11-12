"use client";

import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";

// Hinweis nach dem Löschantrag (ADR 019, H7): „wird gelöscht“, nicht „ist gelöscht“. Clientseitig, damit die
// gecachte Startseite statisch bleibt; ohne JavaScript entfällt nur der Hinweis.
export function DeletedNotice() {
  const t = useTranslations("AccountDelete");
  if (useSearchParams().get("deleted") !== "1") return null;
  return <p role="status" className="mb-6 rounded border border-success bg-success-soft p-3 text-success">{t("deletedNotice")}</p>;
}
