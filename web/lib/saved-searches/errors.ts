// Fehler der Suchaufträge (ADR 018) als Codes für Texte (SavedSearches.errors.*) und die URL nach einer Aktion ohne
// JavaScript. Abbildung der DB-Fehler: 22023 Filter (hint = Schlüssel, „q“ = Suchbegriff zu lang), 23514 mit
// hint saved_searches_limit, RV001 Zustimmung, RV006 Verlängern zu früh (hint extend_from), 42501 fremd, unbekannt
// oder Konto nicht aktiv (gleiche Antwort, kein Orakel).

export const ERROR_PARAMS = ["name", "invalid", "queryTooLong", "limit", "legal", "extendNotYet", "unavailable", "failed"] as const;
export type ErrorParam = (typeof ERROR_PARAMS)[number];

export type SavedSearchError =
  | { code: Exclude<ErrorParam, "extendNotYet"> }
  | { code: "extendNotYet"; extendFrom: string | null };

type PgError = { code?: string; hint?: string | null } | null;

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

function extendFrom(hint: string | null | undefined): string | null {
  try {
    const value = (JSON.parse(hint ?? "{}") as { extend_from?: unknown }).extend_from;
    return typeof value === "string" && ISO.test(value) && !Number.isNaN(Date.parse(value)) ? value : null;
  } catch {
    return null;
  }
}

function hasLimitHint(hint: string | null | undefined): boolean {
  try {
    return (JSON.parse(hint ?? "{}") as { reason?: unknown }).reason === "saved_searches_limit";
  } catch {
    return false;
  }
}

/** Filter-Schlüssel (wie filtersError oder hint der DB) als Code. */
export function filterKeyError(key: string | null | undefined): SavedSearchError {
  return { code: key === "q" ? "queryTooLong" : "invalid" };
}

export function toError(error: PgError): SavedSearchError {
  if (!error) return { code: "failed" };
  switch (error.code) {
    case "22023":
      return filterKeyError(error.hint);
    case "23514":
      return { code: hasLimitHint(error.hint) ? "limit" : "failed" };
    case "RV001":
      return { code: "legal" };
    case "RV006":
      return { code: "extendNotYet", extendFrom: extendFrom(error.hint) };
    case "42501":
      return { code: "unavailable" };
    default:
      return { code: "failed" };
  }
}

export function errorParam(error: SavedSearchError): ErrorParam {
  return error.code;
}

export function isErrorParam(value: unknown): value is ErrorParam {
  return typeof value === "string" && (ERROR_PARAMS as readonly string[]).includes(value);
}
