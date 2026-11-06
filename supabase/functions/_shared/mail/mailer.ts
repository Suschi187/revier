// Versand (ADR 017, ADR 018, Review A7, B4): schmales Interface für alle Mail-Functions. SmtpMailer nur für Mailpit
// lokal und in der CI (ohne TLS und ohne Anmeldung); Supabase Edge Functions in der Cloud verbinden nicht auf Port
// 25/587, dort folgt in M10 ein HTTP-Adapter eines EU-Anbieters. Bewusst ohne SMTP-Bibliothek: kein fremder Code
// für einen reinen Testpfad.

/**
 * Zusätzliche Header, nur aus einer festen Liste und nur mit geprüften Werten (B4): Name und Form sind fest, es gibt
 * keinen Weg, beliebige Header oder Zeilenumbrüche einzuschleusen. In M10 muss DKIM beide Header signieren (H3).
 */
export type ExtraHeaders = {
  "List-Unsubscribe"?: string;
  "List-Unsubscribe-Post"?: string;
};

export type Mail = { to: string; subject: string; text: string; headers?: ExtraHeaders };

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

// Keine Zeilenumbrüche oder spitzen Klammern in Adressen: sonst ließen sich SMTP-Befehle oder Header einschleusen.
const ADDRESS = /^[^\s<>()\[\]\\,;:"]+@[^\s<>()\[\]\\,;:"]+\.[^\s<>()\[\]\\,;:"]+$/;

export function validAddress(address: string): boolean {
  return ADDRESS.test(address) && address.length <= 254;
}

// Genau die One-Click-URL (RFC 8058): Ursprung wie SITE_URL (site.ts), Pfad fest, Token 64 hex.
const LIST_UNSUBSCRIBE =
  /^<(?:https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*|http:\/\/(?:localhost|127\.0\.0\.1))(?::\d{1,5})?\/api\/unsubscribe\?t=[0-9a-f]{64}>$/;

const HEADER_RULES: Record<keyof ExtraHeaders, (value: string) => boolean> = {
  "List-Unsubscribe": (value) => LIST_UNSUBSCRIBE.test(value),
  "List-Unsubscribe-Post": (value) => value === "List-Unsubscribe=One-Click",
};

/** Zusätzliche Headerzeilen in fester Reihenfolge; wirft bei unbekanntem Namen oder ungültigem Wert. */
export function extraHeaderLines(headers: ExtraHeaders | undefined): string[] {
  if (!headers) return [];
  for (const name of Object.keys(headers)) {
    if (!Object.hasOwn(HEADER_RULES, name)) throw new Error("header not allowed");
  }
  const lines: string[] = [];
  for (const name of Object.keys(HEADER_RULES) as (keyof ExtraHeaders)[]) {
    const value = headers[name];
    if (value === undefined) continue;
    if (typeof value !== "string" || !HEADER_RULES[name](value)) throw new Error("header invalid");
    lines.push(`${name}: ${value}`);
  }
  return lines;
}

function base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Betreff nach RFC 2047 (UTF-8, Base64); der Betreff ist fest je Sprache, nie mit Nutzerinhalten. */
export function encodeHeader(value: string): string {
  return `=?UTF-8?B?${base64(value)}?=`;
}

/** Vollständige Nachricht: Text als Base64 (enthält nie einen Punkt am Zeilenanfang, kein Dot-Stuffing nötig). */
export function buildMessage(from: string, mail: Mail, now = new Date()): string {
  const body = base64(mail.text).replace(/.{1,76}/g, "$&\r\n");
  const domain = from.split("@")[1] ?? "localhost";
  return [
    `From: Revier <${from}>`,
    `To: <${mail.to}>`,
    `Subject: ${encodeHeader(mail.subject)}`,
    `Date: ${now.toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "Auto-Submitted: auto-generated",
    ...extraHeaderLines(mail.headers),
    "",
    body,
  ].join("\r\n");
}

export class SmtpMailer implements Mailer {
  constructor(private readonly host: string, private readonly port: number, private readonly from: string) {
    if (!validAddress(from)) throw new Error("invalid from");
  }

  async send(mail: Mail): Promise<void> {
    if (!validAddress(mail.to)) throw new Error("invalid recipient");
    // Vor dem Verbindungsaufbau: ein ungültiger Header bricht ohne SMTP-Verkehr ab.
    const message = buildMessage(this.from, mail);
    const conn = await Deno.connect({ hostname: this.host, port: this.port });
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffer = "";
    const reply = async (expected: number[]): Promise<void> => {
      // Antworten können mehrzeilig sein („250-…“); fertig bei „NNN “.
      while (true) {
        const lines = buffer.split("\r\n");
        const done = lines.findIndex((line) => /^\d{3} /.test(line));
        if (done >= 0) {
          const code = Number(lines[done].slice(0, 3));
          buffer = lines.slice(done + 1).join("\r\n");
          if (!expected.includes(code)) throw new Error(`smtp ${code}`);
          return;
        }
        const chunk = new Uint8Array(4096);
        const read = await conn.read(chunk);
        if (read === null) throw new Error("smtp closed");
        buffer += decoder.decode(chunk.subarray(0, read));
      }
    };
    const command = async (line: string, expected: number[]) => {
      await conn.write(encoder.encode(`${line}\r\n`));
      await reply(expected);
    };
    try {
      await reply([220]);
      await command("EHLO revier.local", [250]);
      await command(`MAIL FROM:<${this.from}>`, [250]);
      await command(`RCPT TO:<${mail.to}>`, [250, 251]);
      await command("DATA", [354]);
      await command(`${message}\r\n.`, [250]);
      await command("QUIT", [221]);
    } finally {
      conn.close();
    }
  }
}

/** Mailer aus der Umgebung (lokal Mailpit laut config.toml); ohne SMTP_HOST oder MAIL_FROM kein Versand (503). */
export function mailerFromEnv(): Mailer | null {
  const host = Deno.env.get("SMTP_HOST");
  const from = Deno.env.get("MAIL_FROM");
  if (!host || !from || !validAddress(from)) return null;
  return new SmtpMailer(host, Number(Deno.env.get("SMTP_PORT") ?? "1025"), from);
}
