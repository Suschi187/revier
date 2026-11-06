import { z } from "zod";
import type { AppLocale } from "@/i18n/routing";
import { publicPath } from "@/lib/public/paths";
import { filtersError, paramsFromFilters, VIEW_PARAM, type Filters } from "@/lib/search/filters";
import { Constants } from "@/lib/supabase/database.types";
import { formatPrice } from "@/lib/validation/price";

// Suchaufträge (ADR 018): Regeln, die das Web anzeigt. Die DB entscheidet (Trigger, RPCs); die Werte hier spiegeln
// app_settings (saved_search_days, saved_search_extend_window_days, saved_search_expired_keep_days) nur für die
// Anzeige. Weicht die DB ab, gilt ihre Antwort (RV006 mit extend_from).

export const SAVED_SEARCH_LIMIT = 25;
export const NAME_MAX = 100;
export const EXTEND_WINDOW_DAYS = 14;
export const EXPIRED_KEEP_DAYS = 30;
const DAY_MS = 86_400_000;

export const CADENCES = Constants.public.Enums.saved_search_cadence;
export type Cadence = (typeof CADENCES)[number];

/** Wie die DB: `char_length(btrim(name)) between 1 and 100`; gespeichert wird der getrimmte Name. */
export const nameSchema = z
  .string()
  .transform((value) => value.trim())
  .refine((value) => [...value].length >= 1 && [...value].length <= NAME_MAX);

export const cadenceSchema = z.enum(CADENCES);

/** Name kürzen, ohne Zeichen aus Ersatzpaaren zu zerteilen. */
export function clipName(name: string): string {
  const chars = [...name.trim()];
  return chars.length <= NAME_MAX ? chars.join("") : `${chars.slice(0, NAME_MAX - 1).join("").trimEnd()}…`;
}

// ---------------------------------------------------------------------------
// Filter beim Speichern und aus der DB
// ---------------------------------------------------------------------------

const FILTERS_MAX_BYTES = 4096;

/**
 * Filter aus dem Formular (verstecktes Feld, JSON). Die Reihenfolge zählt für den Abgleich nicht, `sort` fällt weg
 * (wie im Trigger). Liefert den Fehler-Schlüssel wie `filtersError` (hint der DB).
 */
export function filtersForSaving(raw: unknown): { ok: true; filters: Filters } | { ok: false; key: string } {
  if (typeof raw !== "string" || raw.length === 0 || new TextEncoder().encode(raw).length > FILTERS_MAX_BYTES) return { ok: false, key: "filters" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, key: "filters" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { ok: false, key: "filters" };
  const rest: Record<string, unknown> = { ...(parsed as Record<string, unknown>) };
  delete rest.sort;
  const key = filtersError(rest);
  return key === null ? { ok: true, filters: rest as Filters } : { ok: false, key };
}

/** Gespeicherte Filter lesen; null, wenn sie (nach geänderten Referenzdaten) nicht mehr gültig sind. */
export function storedFilters(raw: unknown): Filters | null {
  return filtersError(raw) === null ? (raw as Filters) : null;
}

/** „Ergebnisse ansehen“: dieselben Parameter wie die Suche; mit Kartenausschnitt die Kartenansicht (H1). */
export function resultsHref(filters: Filters, locale: AppLocale): string {
  const params = paramsFromFilters(filters);
  if (filters.bbox) params.set(VIEW_PARAM, "map");
  const path = publicPath({ route: "search" }, locale);
  return params.size ? `${path}?${params}` : path;
}

// ---------------------------------------------------------------------------
// Laufzeit und Status (H4: Pausieren hält die Laufzeit nicht an)
// ---------------------------------------------------------------------------

export type SavedSearchStatus =
  | { state: "active"; expiresAt: Date }
  | { state: "expiring"; expiresAt: Date }
  | { state: "paused"; expiresAt: Date }
  | { state: "expired"; expiresAt: Date; deleteAt: Date };

export function searchStatus(row: { paused_at: string | null; expires_at: string }, now: Date): SavedSearchStatus {
  const expiresAt = new Date(row.expires_at);
  if (expiresAt.getTime() <= now.getTime()) {
    return { state: "expired", expiresAt, deleteAt: new Date(expiresAt.getTime() + EXPIRED_KEEP_DAYS * DAY_MS) };
  }
  if (row.paused_at !== null) return { state: "paused", expiresAt };
  if (extendWindow(row.expires_at, now).open) return { state: "expiring", expiresAt };
  return { state: "active", expiresAt };
}

/** Verlängern geht in den letzten 14 Tagen und nach dem Ablauf, auch aus der Pause. */
export function extendWindow(expiresAt: string, now: Date): { open: true } | { open: false; from: Date } {
  const from = new Date(new Date(expiresAt).getTime() - EXTEND_WINDOW_DAYS * DAY_MS);
  return now.getTime() >= from.getTime() ? { open: true } : { open: false, from };
}

// ---------------------------------------------------------------------------
// Name-Vorschlag und Kurzbeschreibung aus den bestehenden Labels der Suche
// ---------------------------------------------------------------------------

type E = typeof Constants.public.Enums;

export type FilterTexts = {
  kind: (kind: E["listing_kind"][number]) => string;
  direction: (direction: E["listing_direction"][number]) => string;
  country: (country: E["country_code"][number]) => string;
  unit: (unit: E["price_unit"][number]) => string;
  regionName: (code: string) => string | undefined;
  speciesName: (code: string) => string | undefined;
  /** Suchbegriff in typografischen Anführungszeichen der Sprache. */
  quoted: (text: string) => string;
  labels: { q: string; species: string; price: string; area: string; period: string; from: string; to: string };
  verifiedOnly: string;
  mapArea: string;
  allListings: string;
};

/** Vorbelegter Name: Art, Angebot/Gesuch, Region oder Land, Suchbegriff; ohne diese der Kartenausschnitt oder „Alle Anzeigen“. */
export function suggestName(filters: Filters, texts: FilterTexts): string {
  const parts: string[] = [];
  if (filters.kind) parts.push(texts.kind(filters.kind));
  if (filters.direction) parts.push(texts.direction(filters.direction));
  if (filters.region) parts.push(texts.regionName(filters.region) ?? filters.region);
  else if (filters.country) parts.push(texts.country(filters.country));
  if (filters.q) parts.push(texts.quoted(filters.q));
  if (parts.length === 0) parts.push(filters.bbox ? texts.mapArea : texts.allListings);
  return clipName(parts.join(" · "));
}

function range(min: string | null, max: string | null, labels: FilterTexts["labels"]): string {
  return [min !== null ? `${labels.from} ${min}` : null, max !== null ? `${labels.to} ${max}` : null].filter(Boolean).join(" ");
}

/** Kurzbeschreibung als Liste kurzer Texte, in der Reihenfolge des Filterformulars. */
export function describeFilters(filters: Filters, locale: AppLocale, texts: FilterTexts): string[] {
  const parts: string[] = [];
  const { labels } = texts;
  if (filters.kind) parts.push(texts.kind(filters.kind));
  if (filters.direction) parts.push(texts.direction(filters.direction));
  if (filters.country && !filters.region) parts.push(texts.country(filters.country));
  if (filters.region) parts.push(texts.regionName(filters.region) ?? filters.region);
  if (filters.q) parts.push(`${labels.q}: ${texts.quoted(filters.q)}`);
  if (filters.species?.length) parts.push(`${labels.species}: ${filters.species.map((s) => texts.speciesName(s) ?? s).join(", ")}`);
  if (filters.currency) {
    const money = (minor: number | undefined) => (minor === undefined ? null : formatPrice(minor, filters.currency!, locale));
    const amount = range(money(filters.price_min), money(filters.price_max), labels);
    const unit = filters.price_unit ? texts.unit(filters.price_unit) : null;
    parts.push(`${labels.price}: ${[amount || filters.currency, unit].filter(Boolean).join(" ")}`);
  } else if (filters.price_unit) {
    parts.push(`${labels.price}: ${texts.unit(filters.price_unit)}`);
  }
  if (filters.area_min !== undefined || filters.area_max !== undefined) {
    const number = new Intl.NumberFormat(locale);
    const area = (value: number | undefined) => (value === undefined ? null : number.format(value));
    parts.push(`${labels.area}: ${range(area(filters.area_min), area(filters.area_max), labels)}`);
  }
  if (filters.date_from || filters.date_to) {
    const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });
    const day = (value: string | undefined) => (value ? date.format(new Date(`${value}T00:00:00Z`)) : null);
    parts.push(`${labels.period}: ${range(day(filters.date_from), day(filters.date_to), labels)}`);
  }
  if (filters.verified_only) parts.push(texts.verifiedOnly);
  if (filters.bbox) parts.push(texts.mapArea);
  return parts;
}
