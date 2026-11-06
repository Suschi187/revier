"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { AppLocale } from "@/i18n/routing";
import { isAppLocale, safeNextPath } from "@/lib/auth/paths";
import { publicPath } from "@/lib/public/paths";
import { errorParam, filterKeyError, type SavedSearchError } from "@/lib/saved-searches/errors";
import { cadenceSchema, filtersForSaving, type Cadence } from "@/lib/saved-searches/rules";
import { paramsFromFilters, VIEW_PARAM } from "@/lib/search/filters";
import { requireSessionUser } from "@/lib/services/auth";
import { requireOnboardedUser } from "@/lib/services/gate";
import {
  createSavedSearch,
  deleteSavedSearch,
  extendSavedSearch,
  pauseSavedSearch,
  renameSavedSearch,
  resumeSavedSearch,
  setSavedSearchCadence,
  setSavedSearchEmail,
  type Result,
} from "@/lib/services/saved-searches";

// Suchaufträge (ADR 018). Speichern aus der Suche: useActionState, Fehler im Formularzustand. Ohne JavaScript (kein
// Header Next-Action) leitet die Action mit dem Fehlercode zurück auf die Suche: Ein zurückgegebener Zustand
// scheitert dort an einem Fehler in Next.js 16.4 (wie M7, messages/actions.ts). Verwalten auf /account/searches:
// nur angemeldet, ohne Legal-Gate (Pausieren, E-Mail aus und Löschen gehen immer); Fortsetzen, Verlängern und
// E-Mail an prüft die DB (RV001).

export type SaveState = { error: SavedSearchError | null; name: string; cadence: Cadence; notifyEmail: boolean };

function localeOf(form: FormData): AppLocale {
  const raw = String(form.get("locale") ?? "");
  return isAppLocale(raw) ? raw : "de";
}

export async function saveSearchAction(_state: SaveState, form: FormData): Promise<SaveState> {
  const locale = localeOf(form);
  const filters = filtersForSaving(form.get("filters"));
  const mapView = form.get("view") === "map";
  // Zurück auf die Suche mit denselben Filtern (aus den geprüften Filtern neu gebaut, nie Rohwerte).
  const query = filters.ok ? paramsFromFilters(filters.filters) : new URLSearchParams();
  if (mapView) query.set(VIEW_PARAM, "map");
  const searchPath = publicPath({ route: "search" }, locale);
  const back = query.size ? `${searchPath}?${query}` : searchPath;
  // Login und Zustimmung: Ziel ohne Suchtext (H10, QA M5 N2).
  await requireOnboardedUser(locale, safeNextPath(back, locale));

  const state = {
    name: String(form.get("name") ?? "").slice(0, 400),
    cadence: cadenceSchema.safeParse(form.get("cadence")).data ?? "instant",
    notifyEmail: form.get("notifyEmail") === "on",
  };
  const fail = async (error: SavedSearchError): Promise<SaveState> => {
    if (!(await headers()).has("next-action")) {
      redirect(`${back}${back.includes("?") ? "&" : "?"}error=${errorParam(error)}`);
    }
    return { error, ...state };
  };
  if (!filters.ok) return fail(filterKeyError(filters.key));
  const result = await createSavedSearch({ name: state.name, filters: filters.filters, cadence: state.cadence, notifyEmail: state.notifyEmail });
  if (!result.ok) return fail(result.error);
  const path = `/${locale}/account/searches`;
  revalidatePath(path);
  redirect(`${path}?notice=created#search-${result.id}`);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const OPS = {
  pause: { notice: "paused", run: (id: string) => pauseSavedSearch(id) },
  resume: { notice: "resumed", run: (id: string) => resumeSavedSearch(id) },
  extend: { notice: "extended", run: (id: string) => extendSavedSearch(id) },
  emailOn: { notice: "emailOn", run: (id: string) => setSavedSearchEmail(id, true) },
  emailOff: { notice: "emailOff", run: (id: string) => setSavedSearchEmail(id, false) },
  instant: { notice: "cadence", run: (id: string) => setSavedSearchCadence(id, "instant") },
  daily: { notice: "cadence", run: (id: string) => setSavedSearchCadence(id, "daily") },
  delete: { notice: "deleted", run: (id: string) => deleteSavedSearch(id) },
} as const satisfies Record<string, { notice: string; run: (id: string) => Promise<Result> }>;

export async function changeSavedSearchAction(form: FormData): Promise<void> {
  const locale = localeOf(form);
  const path = `/${locale}/account/searches`;
  await requireSessionUser(locale, path);
  const id = String(form.get("id") ?? "");
  const op = String(form.get("op") ?? "");
  let result: Result;
  let notice: string;
  if (!UUID.test(id)) {
    result = { ok: false, error: { code: "unavailable" } };
    notice = "";
  } else if (op === "rename") {
    result = await renameSavedSearch(id, String(form.get("name") ?? "").slice(0, 400));
    notice = "renamed";
  } else if (Object.hasOwn(OPS, op)) {
    const entry = OPS[op as keyof typeof OPS];
    result = await entry.run(id);
    notice = entry.notice;
  } else {
    result = { ok: false, error: { code: "failed" } };
    notice = "";
  }
  // Gleicher Pfad: Ohne revalidatePath zeigte der Router nach dem Redirect den alten Stand (M7).
  revalidatePath(path);
  if (result.ok) redirect(op === "delete" ? `${path}?notice=deleted` : `${path}?notice=${notice}#search-${id}`);
  redirect(`${path}?error=${errorParam(result.error)}${UUID.test(id) && op !== "delete" ? `#search-${id}` : ""}`);
}
