"use server";

import { redirect } from "next/navigation";
import { isAppLocale, safeNextPath } from "@/lib/auth/paths";
import { addFavorite, removeFavorites, removeUnavailable } from "@/lib/services/favorites";
import { requireOnboardedUser } from "@/lib/services/gate";

// Merken nur per POST (ADR 015, Review A9): nie per GET-Parameter, auch nicht nach dem Login.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function toggleFavorite(form: FormData): Promise<void> {
  const rawLocale = String(form.get("locale") ?? "");
  const locale = isAppLocale(rawLocale) ? rawLocale : "de";
  // POST: Der Suchtext darf im Rücksprung nach dem Merken bleiben (QA M5 F9). Führt die Prüfung zu Login oder
  // Onboarding, geht das Ziel in deren URL, dort also ohne Suchtext (H10, QA M5 N2).
  const rawBack = String(form.get("back") ?? "");
  const back = safeNextPath(rawBack, locale, { keepSearchText: true });
  await requireOnboardedUser(locale, safeNextPath(rawBack, locale));
  const id = String(form.get("id") ?? "");
  if (!UUID.test(id)) redirect(back);
  const result = form.get("op") === "remove" ? await removeFavorites([id]) : await addFavorite(id);
  // Fehler zeigt die Favoritenseite: öffentliche Seiten bekommen keinen Query-Parameter (Canonical, Cache).
  redirect(result === "ok" ? back : `/${locale}/account/favorites?error=${result}`);
}

export async function removeUnavailableFavorites(form: FormData): Promise<void> {
  const rawLocale = String(form.get("locale") ?? "");
  const locale = isAppLocale(rawLocale) ? rawLocale : "de";
  const path = `/${locale}/account/favorites`;
  await requireOnboardedUser(locale, path);
  // Die DB bestimmt die Menge selbst (QA M5 F3): nie IDs aus dem Formular oder einer fehlgeschlagenen Abfrage.
  const result = await removeUnavailable();
  redirect(result === "ok" ? `${path}?notice=removed` : `${path}?error=failed`);
}
