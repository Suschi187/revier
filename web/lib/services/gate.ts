import "server-only";
import { redirect } from "next/navigation";
import type { AppLocale } from "@/i18n/routing";
import { requireSessionUser, type SessionUser } from "./auth";
import { getLegalStatus } from "./legal";

/**
 * Autoritative Prüfung für geschützte Seiten (ADR 010): angemeldet und aktuelle Rechtstexte
 * akzeptiert, sonst Login bzw. Onboarding. Jede geschützte Seite ruft das selbst auf.
 */
export async function requireOnboardedUser(locale: AppLocale, path: string): Promise<SessionUser> {
  const user = await requireSessionUser(locale, path);
  const legal = await getLegalStatus();
  if (!legal?.accepted) redirect(`/${locale}/welcome?next=${encodeURIComponent(path)}`);
  return user;
}
