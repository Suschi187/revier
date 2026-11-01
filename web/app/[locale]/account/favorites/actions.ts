"use server";

import { redirect } from "next/navigation";
import { isAppLocale, safeNextPath } from "@/lib/auth/paths";
import { addFavorite, favoritesOverview, removeFavorites } from "@/lib/services/favorites";
import { requireOnboardedUser } from "@/lib/services/gate";

// Merken nur per POST (ADR 015, Review A9): nie per GET-Parameter, auch nicht nach dem Login.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function toggleFavorite(form: FormData): Promise<void> {
  const rawLocale = String(form.get("locale") ?? "");
  const locale = isAppLocale(rawLocale) ? rawLocale : "de";
  const back = safeNextPath(String(form.get("back") ?? ""), locale);
  await requireOnboardedUser(locale, back);
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
  // Neu bestimmen statt IDs aus dem Formular zu übernehmen: entfernt nur, was jetzt nicht öffentlich ist.
  const { unavailableIds } = await favoritesOverview();
  const result = await removeFavorites(unavailableIds);
  redirect(result === "ok" ? `${path}?notice=removed` : `${path}?error=failed`);
}
