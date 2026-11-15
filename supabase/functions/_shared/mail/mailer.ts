// Versand (ADR 017, ADR 018, Review A7, B4): schmales Interface für alle Mail-Functions. SmtpMailer lokal und in der
// CI gegen Mailpit (ohne TLS und ohne Anmeldung), in der Cloud gegen United Domains (M10, Entscheidung 2026-11-15)
// mit implizitem TLS auf Port 465 und AUTH PLAIN: Supabase Edge Functions verbinden in der Cloud nicht auf Port
// 25/587, STARTTLS ist deshalb nicht vorgesehen. Bewusst ohne SMTP-Bibliothek: wenige feste Befehle.

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
    `From: Huntery <${from}>`,
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

export type SmtpOptions = {
  /** Implizites TLS ab Verbindungsaufbau (SMTPS, Port 465). */
  tls?: boolean;
  /** AUTH PLAIN, nur zusammen mit TLS: Zugangsdaten nie im Klartext über das Netz. */
  auth?: { user: string; pass: string };
  /** Nur für Tests: eigene Zertifizierungsstelle. */
  caCerts?: string[];
};

// Keine Zeilenumbrüche und keine NUL in Zugangsdaten: sonst ließen sich SMTP-Befehle anhängen.
const CREDENTIAL = /^[^\r\n\0]{1,256}$/;

export class SmtpMailer implements Mailer {
  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly from: string,
    private readonly options: SmtpOptions = {},
  ) {
    if (!validAddress(from)) throw new Error("invalid from");
    if (options.auth) {
      if (!options.tls) throw new Error("auth needs tls");
      if (!CREDENTIAL.test(options.auth.user) || !CREDENTIAL.test(options.auth.pass)) throw new Error("invalid credentials");
    }
  }

  async send(mail: Mail): Promise<void> {
    if (!validAddress(mail.to)) throw new Error("invalid recipient");
    // Vor dem Verbindungsaufbau: ein ungültiger Header bricht ohne SMTP-Verkehr ab.
    const message = buildMessage(this.from, mail);
    const conn = this.options.tls
      ? await Deno.connectTls({ hostname: this.host, port: this.port, caCerts: this.options.caCerts })
      : await Deno.connect({ hostname: this.host, port: this.port });
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
      // Absenderdomain als Name: Anbieter prüfen ihn gegen DNS; ein fester lokaler Name wirkt wie Spam.
      await command(`EHLO ${this.from.split("@")[1]}`, [250]);
      if (this.options.auth) {
        // Fehlermeldungen tragen nur den Code, nie die Zugangsdaten.
        await command(`AUTH PLAIN ${base64(`\0${this.options.auth.user}\0${this.options.auth.pass}`)}`, [235]);
      }
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

/**
 * Mailer aus der Umgebung. Lokal Mailpit laut config.toml; in der Cloud United Domains mit SMTP_TLS=true,
 * SMTP_USER und SMTP_PASS (Function-Secrets). Ohne SMTP_HOST oder MAIL_FROM kein Versand (503).
 */
export function mailerFromEnv(): Mailer | null {
  const host = Deno.env.get("SMTP_HOST");
  const from = Deno.env.get("MAIL_FROM");
  if (!host || !from || !validAddress(from)) return null;
  const tls = Deno.env.get("SMTP_TLS") === "true";
  const user = Deno.env.get("SMTP_USER");
  const pass = Deno.env.get("SMTP_PASS");
  return new SmtpMailer(host, Number(Deno.env.get("SMTP_PORT") ?? (tls ? "465" : "1025")), from, {
    tls,
    auth: user && pass ? { user, pass } : undefined,
  });
}
