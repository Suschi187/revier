import type { Database } from "@/lib/supabase/database.types";
import {
  ATTRIBUTE_SCHEMAS,
  attributesError,
  type Attributes,
  type ListingKind,
  LEASE_TYPES,
  PERMIT_SCOPES,
  REVIER_TYPES,
} from "@/lib/validation/listing";

// Assistent „Anzeige aufgeben“ (Plan M3 7): Schritte, Umwandlung der Formularfelder in Attribute und die
// Zuordnung der Feldcodes (ADR 013) zu Schritten für die Fehlerzusammenfassung.

type Enums = Database["public"]["Enums"];

export const WIZARD_STEPS = ["basics", "location", "details", "photos", "price", "preview"] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

export function isWizardStep(value: unknown): value is WizardStep {
  return WIZARD_STEPS.includes(value as WizardStep);
}

export function nextStep(step: WizardStep): WizardStep {
  return WIZARD_STEPS[Math.min(WIZARD_STEPS.indexOf(step) + 1, WIZARD_STEPS.length - 1)];
}

/** In welchem Schritt ein Feldcode behoben wird. */
export function stepOfField(code: string): WizardStep {
  if (code.startsWith("place.") || code === "district" || code === "postal_format") return "location";
  if (code === "title") return "basics";
  if (code.startsWith("price") || code === "dates") return "price";
  if (code === "photos.unprocessed") return "photos";
  return "details";
}

// Feldcodes der DB (ADR 013) und der Formulare (title, district, postal_format, area_invalid, price_*, dates).
const KNOWN_CODES = new Set([
  "description.length", "place.postal_code.required", "place.place_name.required", "place.postal_code.unknown",
  "place.postal_code.region_mismatch", "attributes.legal_ack", "attributes.event_date.past", "attributes.lease_type",
  "attributes.revier_type", "area_hectares", "attributes.permit_scope", "attributes.paid", "attributes.event_date",
  "attributes.spots_available", "attributes.tasks", "species", "photos.unprocessed", "attributes.unknown",
  "title", "district", "postal_format", "area_invalid", "dates", "price_required", "price_invalid", "price_negative",
  "price_tooManyDecimals", "price_zero", "price_tooLarge", "price_conflict",
  "place.point.small_district", "place.point.too_far", "place.point.invalid",
]);

/** Feldcode als Schlüssel für die Message-Dateien (next-intl verschachtelt an Punkten). */
export function fieldMessageKey(code: string): string {
  if (KNOWN_CODES.has(code)) return code.replaceAll(".", "_");
  if (code.startsWith("attributes.")) return "attributes_invalid";
  return "form";
}

/** Nur bekannte Codes aus der URL übernehmen (`?errors=a,b`), höchstens 20. */
export function parseErrorCodes(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .filter((code) => KNOWN_CODES.has(code) || /^attributes\.[a-z_]{1,40}$/.test(code))
    .slice(0, 20);
}

/** id des Formularfelds, an dem ein Feldcode angezeigt wird (Anker der Fehlerzusammenfassung). */
export function fieldIdOf(code: string): string {
  if (code === "title") return "f-title";
  if (code === "district") return "f-district";
  if (code.startsWith("place.postal_code") || code === "postal_format") return "f-postal";
  if (code === "place.place_name.required") return "f-place";
  if (code.startsWith("place.point.")) return "f-point";
  if (code === "description.length") return "f-description";
  if (code === "area_hectares" || code === "area_invalid") return "f-area";
  if (code === "species") return "f-species";
  if (code.startsWith("price_")) return "f-amount";
  if (code === "dates") return "f-end";
  if (code === "photos.unprocessed") return "f-photos";
  if (code.startsWith("attributes.")) {
    const key = code.split(".")[1];
    return key === "unknown" ? "f-kind-details" : `f-attr-${key}`;
  }
  return "f-form";
}

/** Standardwährung aus dem Land des Kreises (änderbar). */
export const DEFAULT_CURRENCY: Record<Enums["country_code"], Enums["currency_code"]> = {
  DE: "EUR", AT: "EUR", CH: "CHF", CZ: "CZK", PL: "PLN",
};

/** Status, in denen Art und Richtung feststehen: eingereicht oder veröffentlicht (QA M3 F5). */
export const TYPE_LOCKED: readonly Enums["listing_status"][] = ["pending_review", "active", "paused"];

export const PRICE_UNITS = ["total", "per_year", "per_hectare_year", "per_day", "per_animal"] as const;

// Feldtypen der Attribute für die Formularfelder je Art.
export type AttributeField =
  | { key: string; type: "choice"; options: readonly string[] }
  | { key: string; type: "choices"; options: readonly string[] }
  | { key: string; type: "yesno" }
  | { key: string; type: "flag" }
  | { key: string; type: "date" }
  | { key: string; type: "int"; min: number; max: number }
  | { key: string; type: "text"; max: number; multiline: boolean }
  | { key: string; type: "lines"; max: number; maxItems: number };

export const ATTRIBUTE_FIELDS: Record<ListingKind, AttributeField[]> = {
  lease: [
    { key: "lease_type", type: "choice", options: LEASE_TYPES },
    { key: "revier_type", type: "choices", options: REVIER_TYPES },
    { key: "submission_deadline", type: "date" },
    { key: "lease_duration_years", type: "int", min: 1, max: 99 },
    { key: "shooting_plan", type: "text", max: 2000, multiline: true },
    { key: "hunting_hut", type: "flag" },
    { key: "co_lessee_slots", type: "int", min: 0, max: 50 },
  ],
  permit: [
    { key: "permit_scope", type: "choice", options: PERMIT_SCOPES },
    { key: "paid", type: "yesno" },
    { key: "season", type: "text", max: 200, multiline: false },
    { key: "species_limits", type: "text", max: 1000, multiline: true },
  ],
  driven_hunt: [
    { key: "event_date", type: "date" },
    { key: "spots_available", type: "int", min: 1, max: 500 },
    { key: "meeting_point_description", type: "text", max: 500, multiline: true },
    { key: "dogs_required", type: "flag" },
  ],
  trophy_hunt: [
    { key: "trophy_details", type: "text", max: 1000, multiline: true },
    { key: "season", type: "text", max: 200, multiline: false },
    { key: "includes_accommodation", type: "flag" },
    { key: "import_export_note", type: "text", max: 1000, multiline: true },
    { key: "legal_ack", type: "flag" },
  ],
  helper: [
    { key: "tasks", type: "lines", max: 100, maxItems: 20 },
    { key: "experience_level", type: "text", max: 200, multiline: false },
  ],
};

// Jede Art hat genau die Felder ihres Schemas (Test in listing-wizard.test.ts).
export const ATTRIBUTE_KEYS = Object.fromEntries(
  Object.entries(ATTRIBUTE_SCHEMAS).map(([kind, schema]) => [kind, Object.keys(schema)]),
) as Record<ListingKind, string[]>;

type FormLike = { get(name: string): FormDataEntryValue | null; getAll(name: string): FormDataEntryValue[] };

const str = (value: FormDataEntryValue | null) => (typeof value === "string" ? value : "");

/**
 * Formularfelder `attr.<schlüssel>` → Attribute. Leere Felder fallen weg (Entwürfe dürfen unvollständig sein);
 * ein nicht gesetztes Häkchen fehlt, statt `false` zu sein. Ergebnis mit dem Feldcode des ersten Fehlers.
 */
export function attributesFromForm(kind: ListingKind, form: FormLike): { attributes: Attributes; error: string | null } {
  const attributes: Attributes = {};
  for (const field of ATTRIBUTE_FIELDS[kind]) {
    const name = `attr.${field.key}`;
    const raw = str(form.get(name)).trim();
    switch (field.type) {
      case "choice":
      case "text":
      case "date":
        if (raw) attributes[field.key] = raw;
        break;
      case "choices": {
        const values = form.getAll(name).map(str).filter(Boolean);
        if (values.length) attributes[field.key] = values;
        break;
      }
      case "yesno":
        if (raw === "yes") attributes[field.key] = true;
        else if (raw === "no") attributes[field.key] = false;
        break;
      case "flag":
        if (raw === "on") attributes[field.key] = true;
        break;
      case "int":
        if (raw) attributes[field.key] = /^\d+$/.test(raw) ? Number(raw) : raw;
        break;
      case "lines": {
        const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        if (lines.length) attributes[field.key] = [...new Set(lines)];
        break;
      }
    }
  }
  return { attributes, error: attributesError(kind, attributes) };
}

/** Fläche in Hektar: „12,5“ oder „12.5“, höchstens 2 Nachkommastellen; leer = null. */
export function parseHectares(input: string): { ok: true; value: number | null } | { ok: false } {
  const text = input.trim().replace(",", ".");
  if (!text) return { ok: true, value: null };
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(text)) return { ok: false };
  const value = Number(text);
  return value > 0 ? { ok: true, value } : { ok: false };
}
