import { getTranslations } from "next-intl/server";
import type { RejectCode } from "@/lib/moderation";
import type { ListingStatus } from "@/lib/services/listings";

/**
 * Grund der Moderation für den Besitzer (ADR 014): Vorlage in seiner Sprache, dazu der Freitext so, wie
 * der Admin ihn geschrieben hat. Bei „Bearbeitung angefordert“ (Entwurf mit Grund) ein Hinweis zum Ablauf.
 */
export async function ModerationNote({ status, code, note, className = "" }: { status: ListingStatus; code: RejectCode | null; note: string | null; className?: string }) {
  if (!code || !(status === "rejected" || status === "removed" || status === "draft")) return null;
  const [t, tm] = await Promise.all([getTranslations("Listings.mine"), getTranslations("Moderation")]);
  return (
    <div className={`text-sm text-red-800 ${className}`}>
      {status === "draft" && <p>{t("changesRequested")}</p>}
      <p>{t("rejectReason", { reason: tm(`reasons.${code}`) })}</p>
      {note && <p className="break-words whitespace-pre-line">{t("moderationNote", { note })}</p>}
    </div>
  );
}
