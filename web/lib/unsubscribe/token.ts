import { routing, type AppLocale } from "@/i18n/routing";

// Abbestellen per Klick (ADR 018, RFC 8058): Token aus Query oder Formular, Sprache aus Accept-Language. Rein und ohne
// Request-Daten in Logs; der Token ist 32 zufällige Bytes als Hex (Mailer: _shared/mail/site.ts).

const TOKEN_RE = /^[0-9a-f]{64}$/;
/** Ein One-Click-Body ist ein paar Dutzend Bytes; mehr wird nicht gelesen. */
export const MAX_BODY_BYTES = 8192;

export function parseToken(value: unknown): string | null {
  return typeof value === "string" && TOKEN_RE.test(value) ? value : null;
}

/** Erste unterstützte Sprache nach q-Wert, sonst de (nie aus dem Token-Datensatz: Orakel, Review B4). */
export function localeFromAcceptLanguage(header: string | null): AppLocale {
  if (!header || header.length > 1000) return routing.defaultLocale;
  const entries = header
    .split(",")
    .slice(0, 30)
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => /^\s*q=([01](?:\.\d{1,3})?)\s*$/.exec(p)?.[1]).find((v) => v !== undefined);
      return { lang: tag.trim().toLowerCase().split("-")[0], q: q === undefined ? 1 : Number(q), index };
    })
    .filter((e) => e.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  return (entries.map((e) => e.lang).find((lang) => routing.locales.includes(lang as AppLocale)) as AppLocale | undefined) ?? routing.defaultLocale;
}

/** Liest höchstens `limit` Bytes; null, wenn der Body größer ist (dann wird er verworfen, nicht abgeschnitten). */
export async function readCappedBody(body: ReadableStream<Uint8Array> | null, limit = MAX_BODY_BYTES): Promise<Uint8Array | null> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

type FormFields = { t: string | null; lang: string | null };
const NO_FIELDS: FormFields = { t: null, lang: null };

/** Felder `t` und `lang` aus x-www-form-urlencoded oder multipart/form-data; andere Typen ergeben keine Felder. */
export async function formFields(contentType: string | null, bytes: Uint8Array): Promise<FormFields> {
  const type = (contentType ?? "").split(";")[0].trim().toLowerCase();
  const text = (value: unknown) => (typeof value === "string" ? value : null);
  try {
    if (type === "application/x-www-form-urlencoded") {
      const params = new URLSearchParams(new TextDecoder().decode(bytes));
      return { t: params.get("t"), lang: params.get("lang") };
    }
    if (type === "multipart/form-data") {
      const form = await new Response(bytes as BodyInit, { headers: { "Content-Type": contentType! } }).formData();
      return { t: text(form.get("t")), lang: text(form.get("lang")) };
    }
  } catch {
    return NO_FIELDS;
  }
  return NO_FIELDS;
}

export type UnsubscribePost = { token: string | null; locale: AppLocale };

/**
 * Token und Sprache eines POST. Token zuerst aus der Query (RFC 8058: der Client POSTet an die URL aus
 * List-Unsubscribe, Body `List-Unsubscribe=One-Click`), sonst aus dem Formularfeld `t` (Bestätigungsseite). Sprache
 * aus dem Feld `lang` der Seite, sonst Accept-Language, sonst de.
 */
export async function readUnsubscribePost(request: Request): Promise<UnsubscribePost> {
  const bytes = await readCappedBody(request.body);
  const fields = bytes ? await formFields(request.headers.get("content-type"), bytes) : NO_FIELDS;
  const token = parseToken(new URL(request.url).searchParams.get("t")) ?? parseToken(fields.t);
  const locale = routing.locales.includes(fields.lang as AppLocale)
    ? (fields.lang as AppLocale)
    : localeFromAcceptLanguage(request.headers.get("accept-language"));
  return { token, locale };
}
