import "server-only";
import { z } from "zod";
import { toError, type SavedSearchError } from "@/lib/saved-searches/errors";
import { cadenceSchema, nameSchema, type Cadence } from "@/lib/saved-searches/rules";
import type { Filters } from "@/lib/search/filters";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Suchaufträge (ADR 018): nur Session-Client, nie service_role. RLS saved_searches_own; Filter, Limit, Zustimmung
// und Server-Spalten prüft die DB (Trigger). Pausieren, Fortsetzen und Verlängern nur per RPC.

const UUID = z.string().uuid();

const COLUMNS = "id, name, filters, cadence, notify_email, paused_at, expires_at, created_at, last_notified_at";

const rowSchema = z.object({
  id: z.string(),
  name: z.string(),
  filters: z.unknown(),
  cadence: cadenceSchema,
  notify_email: z.boolean(),
  paused_at: z.string().nullable(),
  expires_at: z.string(),
  created_at: z.string(),
  last_notified_at: z.string().nullable(),
});
export type SavedSearch = z.infer<typeof rowSchema>;

export type Result = { ok: true } | { ok: false; error: SavedSearchError };

/** Eigene Suchaufträge, neueste zuerst; null bei Fehler (dann nie „keine Aufträge“ anzeigen). */
export async function listSavedSearches(): Promise<SavedSearch[] | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("saved_searches").select(COLUMNS).order("created_at", { ascending: false }).limit(50);
  if (error) return null;
  const parsed = z.array(rowSchema).safeParse(data);
  return parsed.success ? parsed.data : null;
}

export type NewSavedSearch = { name: string; filters: Filters; cadence: Cadence; notifyEmail: boolean };

export async function createSavedSearch(input: NewSavedSearch): Promise<{ ok: true; id: string } | { ok: false; error: SavedSearchError }> {
  const name = nameSchema.safeParse(input.name);
  if (!name.success) return { ok: false, error: { code: "name" } };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("saved_searches")
    .insert({ name: name.data, filters: input.filters, cadence: input.cadence, notify_email: input.notifyEmail })
    .select("id")
    .single();
  return error || !data ? { ok: false, error: toError(error) } : { ok: true, id: data.id };
}

/** Update über RLS; keine Zeile betroffen = fremd oder unbekannt (gleiche Antwort wie die RPCs). */
async function update(id: string, values: { name?: string; cadence?: Cadence; notify_email?: boolean }): Promise<Result> {
  if (!UUID.safeParse(id).success) return { ok: false, error: { code: "unavailable" } };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("saved_searches").update(values).eq("id", id).select("id");
  if (error) return { ok: false, error: toError(error) };
  return data.length === 1 ? { ok: true } : { ok: false, error: { code: "unavailable" } };
}

export async function renameSavedSearch(id: string, rawName: string): Promise<Result> {
  const name = nameSchema.safeParse(rawName);
  if (!name.success) return { ok: false, error: { code: "name" } };
  return update(id, { name: name.data });
}

export async function setSavedSearchCadence(id: string, cadence: Cadence): Promise<Result> {
  return update(id, { cadence });
}

/** E-Mail aus geht immer, wieder an verlangt aktives Konto und Zustimmung (RV001). */
export async function setSavedSearchEmail(id: string, enabled: boolean): Promise<Result> {
  return update(id, { notify_email: enabled });
}

type Rpc = "pause_saved_search" | "resume_saved_search" | "extend_saved_search";

async function rpc(name: Rpc, id: string): Promise<Result> {
  if (!UUID.safeParse(id).success) return { ok: false, error: { code: "unavailable" } };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc(name, { p_id: id });
  return error ? { ok: false, error: toError(error) } : { ok: true };
}

export const pauseSavedSearch = (id: string) => rpc("pause_saved_search", id);
export const resumeSavedSearch = (id: string) => rpc("resume_saved_search", id);
export const extendSavedSearch = (id: string) => rpc("extend_saved_search", id);

export async function deleteSavedSearch(id: string): Promise<Result> {
  if (!UUID.safeParse(id).success) return { ok: false, error: { code: "unavailable" } };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("saved_searches").delete().eq("id", id).select("id");
  if (error) return { ok: false, error: toError(error) };
  return data.length === 1 ? { ok: true } : { ok: false, error: { code: "unavailable" } };
}
