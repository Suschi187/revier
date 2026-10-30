import { z } from "zod";
import { Constants, type Database } from "@/lib/supabase/database.types";

// Spiegelt die Regeln der Datenbank (Migration listing_rules, ADR 013) mit denselben Feldcodes. Die DB bleibt
// maßgeblich; diese Prüfung zeigt Fehler vorab. Gemeinsame Fälle: supabase/tests/fixtures/listing_rules.json
// (Vitest hier, API-Test gegen die DB in web/integration/listing-rules-parity.test.ts).

type Enums = Database["public"]["Enums"];
export type ListingKind = Enums["listing_kind"];
export type ListingDirection = Enums["listing_direction"];

export const LISTING_KINDS = Constants.public.Enums.listing_kind;
export const LISTING_DIRECTIONS = Constants.public.Enums.listing_direction;
export const TITLE_MIN = 3;
export const TITLE_MAX = 100;
export const DESCRIPTION_MIN = 30;
export const DESCRIPTION_MAX = 5000;
export const MAX_PHOTOS = 8;
export const ALT_TEXT_MAX = 200;

export const LEASE_TYPES = ["eigenjagd", "genossenschaft", "pachtnachfolge", "anteil"] as const;
export const REVIER_TYPES = ["hochwild", "niederwild", "feld", "wald", "berg", "wasser"] as const;
export const PERMIT_SCOPES = ["selbststaendig", "begleitet"] as const;

/** Länge in Codepoints wie char_length() in Postgres (Emoji zählen einfach, QA M3 F2). */
export const charCount = (value: string) => [...value].length;

// trim() entfernt dieselben Zeichen wie private.trim_all in der DB (Migration listing_whitespace).
const text = (max: number) => z.string().refine((v) => charCount(v.trim()) >= 1 && charCount(v.trim()) <= max);
const int = (low: number, high: number) => z.number().int().min(low).max(high);
const isoDate = z.string().refine((v) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!match) return false;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
});
const list = <T extends z.ZodType<string>>(item: T, max: number) =>
  z.array(item).min(1).max(max).refine((values) => new Set(values).size === values.length);

// Je Art die erlaubten Schlüssel (SPEC 3.2) und ihre Werte, wie private.listing_attributes_error.
export const ATTRIBUTE_SCHEMAS = {
  lease: {
    lease_type: z.enum(LEASE_TYPES),
    revier_type: list(z.enum(REVIER_TYPES), 6),
    submission_deadline: isoDate,
    lease_duration_years: int(1, 99),
    shooting_plan: text(2000),
    hunting_hut: z.boolean(),
    co_lessee_slots: int(0, 50),
  },
  permit: {
    paid: z.boolean(),
    permit_scope: z.enum(PERMIT_SCOPES),
    season: text(200),
    species_limits: text(1000),
  },
  driven_hunt: {
    event_date: isoDate,
    spots_available: int(1, 500),
    meeting_point_description: text(500),
    dogs_required: z.boolean(),
  },
  trophy_hunt: {
    legal_ack: z.boolean(),
    trophy_details: text(1000),
    season: text(200),
    includes_accommodation: z.boolean(),
    import_export_note: text(1000),
  },
  helper: {
    experience_level: text(200),
    tasks: list(text(100), 20),
  },
} satisfies Record<ListingKind, Record<string, z.ZodType>>;

export type Attributes = Record<string, unknown>;

/** Feldcode des ersten ungültigen Attributs („attributes.unknown“, „attributes.<schlüssel>“) oder null. */
export function attributesError(kind: ListingKind, attributes: Attributes): string | null {
  const schemas: Record<string, z.ZodType> = ATTRIBUTE_SCHEMAS[kind];
  for (const [key, value] of Object.entries(attributes)) {
    const schema = schemas[key];
    if (!schema) return "attributes.unknown";
    if (!schema.safeParse(value).success) return `attributes.${key}`;
  }
  return null;
}

export type PostalStatus = "match" | "mismatch" | "unknown";

export type ReadinessInput = {
  kind: ListingKind;
  direction: ListingDirection;
  description: string;
  areaHectares: number | null;
  attributes: Attributes;
  speciesCount: number;
  place: { postalCode: string | null; placeName: string | null } | null;
  /** Ergebnis des Abgleichs der PLZ mit dem Verzeichnis und dem Kreis (der Assistent lädt die PLZ des Kreises). */
  postalStatus: (code: string) => PostalStatus;
  /** Beim Absenden und bei der Freigabe: Gibt es unverarbeitete Fotos? */
  unprocessedPhotos: boolean;
  /** Heute als YYYY-MM-DD (für Termine in der Vergangenheit). */
  today: string;
};

/** Fehlende oder falsche Angaben als Feldcodes, in derselben Reihenfolge wie private.listing_readiness. */
export function listingReadiness(input: ReadinessInput): string[] {
  const codes: string[] = [];
  const attrs = input.attributes;
  const offer = input.direction === "offer";
  const postalCode = input.place?.postalCode ?? null;
  const has = (key: string) => key in attrs;

  if (charCount(input.description.trim()) < DESCRIPTION_MIN) codes.push("description.length");
  if (offer && !postalCode) codes.push("place.postal_code.required");
  if (offer && !input.place?.placeName) codes.push("place.place_name.required");
  if (postalCode) {
    const status = input.postalStatus(postalCode);
    if (status === "unknown") codes.push("place.postal_code.unknown");
    else if (status === "mismatch") codes.push("place.postal_code.region_mismatch");
  }
  if (input.kind === "trophy_hunt" && attrs.legal_ack !== true) codes.push("attributes.legal_ack");
  if (typeof attrs.event_date === "string" && attrs.event_date < input.today) codes.push("attributes.event_date.past");

  if (offer) {
    if (input.kind === "lease") {
      if (!has("lease_type")) codes.push("attributes.lease_type");
      if (!has("revier_type")) codes.push("attributes.revier_type");
      if (input.areaHectares === null) codes.push("area_hectares");
    } else if (input.kind === "permit") {
      if (!has("permit_scope")) codes.push("attributes.permit_scope");
      if (!has("paid")) codes.push("attributes.paid");
    } else if (input.kind === "driven_hunt") {
      if (!has("event_date")) codes.push("attributes.event_date");
      if (!has("spots_available")) codes.push("attributes.spots_available");
    } else if (input.kind === "helper") {
      if (!has("tasks")) codes.push("attributes.tasks");
    }
    if ((input.kind === "lease" || input.kind === "permit" || input.kind === "trophy_hunt") && input.speciesCount === 0) {
      codes.push("species");
    }
  }
  if (input.unprocessedPhotos) codes.push("photos.unprocessed");
  return codes;
}

/** Feldcodes aus dem Hint eines DB-Fehlers (`{"fields": [...]}`), sonst leer. */
export function fieldsFromHint(hint: string | null | undefined): string[] {
  if (!hint) return [];
  try {
    const parsed: unknown = JSON.parse(hint);
    const fields = (parsed as { fields?: unknown })?.fields;
    return Array.isArray(fields) ? fields.filter((f): f is string => typeof f === "string") : [];
  } catch {
    return [];
  }
}

/** Format der PLZ je Land, wie private.listing_places_prepare. */
export const POSTAL_CODE_FORMAT: Record<Enums["country_code"], RegExp> = {
  DE: /^[0-9]{5}$/,
  AT: /^[1-9][0-9]{3}$/,
  CH: /^[1-9][0-9]{3}$/,
  CZ: /^[1-7][0-9]{2} ?[0-9]{2}$/,
  PL: /^[0-9]{2}-[0-9]{3}$/,
};

export const titleSchema = z
  .string()
  .transform((v) => v.trim())
  .pipe(
    z
      .string()
      .refine((v) => charCount(v) >= TITLE_MIN, { error: "tooShort" })
      .refine((v) => charCount(v) <= TITLE_MAX, { error: "tooLong" }),
  );
export const descriptionSchema = z.string().refine((v) => charCount(v) <= DESCRIPTION_MAX, { error: "tooLong" });
