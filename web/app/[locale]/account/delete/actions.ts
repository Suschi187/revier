"use server";

import { redirect } from "next/navigation";
import { routing, type AppLocale } from "@/i18n/routing";
import { requestAccountDeletion } from "@/lib/services/account";
import { getVerifiedUser, requireSessionUser, signOutCurrentSession } from "@/lib/services/auth";

// Konto endgültig löschen (ADR 019): getUser() (sofort wirksame Prüfung), dann die RPC; sie prüft frische Anmeldung,
// TOTP und Rolle selbst. Danach lokal abmelden (Fehler ignorieren, H6) und sofort weiter: Die Function löscht im
// Hintergrund, der Hinweis sagt „wird gelöscht“ (H7).
export async function deleteAccountAction(form: FormData): Promise<void> {
  const raw = String(form.get("locale") ?? "");
  const locale: AppLocale = routing.locales.includes(raw as AppLocale) ? (raw as AppLocale) : routing.defaultLocale;
  const path = `/${locale}/account/delete`;
  await requireSessionUser(locale, path);
  if (form.get("confirm") !== "yes") redirect(`${path}?error=confirm`);
  if (!(await getVerifiedUser())) redirect(`/${locale}/login?next=${encodeURIComponent(path)}`);
  const result = await requestAccountDeletion();
  if (result !== "ok") redirect(`${path}?error=${result}`);
  try {
    await signOutCurrentSession();
  } catch {
    // Session kann schon weg sein; die Cookies löscht signOut trotzdem lokal.
  }
  redirect(`/${locale}?deleted=1`);
}
