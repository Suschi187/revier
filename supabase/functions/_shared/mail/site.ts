// Links in Mails (ADR 018, Review B4): SITE_URL wird beim Start geprüft, Abbestell-Token nur als 64 hex. Damit
// enthalten Header und Text nie Zeilenumbrüche, Leerzeichen, Pfade oder Query-Teile aus der Umgebung.
import type { ExtraHeaders } from "./mailer.ts";

// https mit Hostnamen oder lokal http://localhost bzw. http://127.0.0.1, jeweils mit optionalem Port; kein Pfad,
// keine Query, kein Fragment, keine Anmeldedaten. Ein abschließender Schrägstrich wird entfernt.
const SITE_URL = /^(https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*|http:\/\/(?:localhost|127\.0\.0\.1))(:\d{1,5})?\/?$/;

/** Geprüfter Ursprung ohne abschließenden Schrägstrich oder null (die Function verweigert dann mit 503). */
export function parseSiteUrl(value: string | undefined | null): string | null {
  const match = SITE_URL.exec(value ?? "");
  if (!match) return null;
  if (match[2] && (Number(match[2].slice(1)) < 1 || Number(match[2].slice(1)) > 65535)) return null;
  return `${match[1]}${match[2] ?? ""}`;
}

const TOKEN = /^[0-9a-f]{64}$/;

export function validToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN.test(value);
}

function requireToken(token: string): string {
  if (!validToken(token)) throw new Error("invalid token");
  return token;
}

/** Ziel des One-Click-POST (RFC 8058). Header und POST nutzen genau diese URL. */
export function unsubscribePostUrl(site: string, token: string): string {
  return `${site}/api/unsubscribe?t=${requireToken(token)}`;
}

/** Bestätigungsseite für den Link im Text: ein GET ändert nichts (Linkscanner). */
export function unsubscribePageUrl(site: string, lang: string, token: string): string {
  return `${site}/${lang}/unsubscribe?t=${requireToken(token)}`;
}

export function unsubscribeHeaders(site: string, token: string): ExtraHeaders {
  return {
    "List-Unsubscribe": `<${unsubscribePostUrl(site, token)}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}
