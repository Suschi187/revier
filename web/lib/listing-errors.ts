import { fieldsFromHint } from "@/lib/validation/listing";

// Fehler der Anzeigenregeln aus der DB (ADR 013) als Fälle für die Oberfläche. Rein, damit Vitest sie prüft.

export type ListingError =
  | { kind: "legal" }
  | { kind: "rateLimited"; retryAfter: string | null }
  | { kind: "fields"; fields: string[] }
  | { kind: "notFound" }
  | { kind: "failed" };

export type DbError = { code?: string; hint?: string | null } | null;

export function toError(error: DbError): ListingError {
  if (!error) return { kind: "notFound" };
  if (error.code === "RV001") return { kind: "legal" };
  if (error.code === "RV002") {
    let retryAfter: string | null = null;
    try {
      const value = (JSON.parse(error.hint ?? "{}") as { retry_after?: unknown }).retry_after;
      retryAfter = typeof value === "string" ? value : null;
    } catch {
      retryAfter = null;
    }
    return { kind: "rateLimited", retryAfter };
  }
  if (error.code === "23514") {
    const fields = fieldsFromHint(error.hint);
    return { kind: "fields", fields: fields.length ? fields : ["form"] };
  }
  if (error.code === "42501") return { kind: "notFound" };
  return { kind: "failed" };
}
