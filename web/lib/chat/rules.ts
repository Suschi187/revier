import { z } from "zod";

// Textregeln für Chatnachrichten (ADR 017, Review A9), gleichlautend mit private.chat_normalize_body und
// private.chat_body_valid. Gemeinsame Fälle: supabase/tests/fixtures/chat_rules.json (auch für iOS).

export const MAX_BODY = 2000;

/** Wie gespeichert: CRLF und CR zu LF, Leerraum außen entfernt (trim() wie private.trim_all, ADR 013). */
export function normalizeBody(body: string): string {
  return body.replace(/\r\n?/g, "\n").trim();
}

// Steuerzeichen außer TAB und LF (C0, DEL, C1) und Bidi-Steuerzeichen. NUL kann die DB nicht speichern.
const FORBIDDEN = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/;

/** Länge in Codepoints wie char_length in Postgres (ein Emoji zählt eins). */
export function bodyLength(body: string): number {
  return [...body].length;
}

export function bodyValid(body: string): boolean {
  const normalized = normalizeBody(body);
  const length = bodyLength(normalized);
  return length >= 1 && length <= MAX_BODY && !FORBIDDEN.test(normalized);
}

export const bodySchema = z.string().max(MAX_BODY * 4).refine(bodyValid).transform(normalizeBody);
