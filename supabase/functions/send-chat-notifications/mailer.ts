// Versand (ADR 017, Review A7): schmales Interface. SmtpMailer nur für Mailpit lokal und in der CI (ohne TLS und
// ohne Anmeldung); Supabase Edge Functions in der Cloud verbinden nicht auf Port 25/587, dort folgt in M10 ein
// HTTP-Adapter eines EU-Anbieters. Bewusst ohne SMTP-Bibliothek: kein fremder Code für einen reinen Testpfad.

export type Mail = { to: string; subject: string; text: string };

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

// Keine Zeilenumbrüche oder spitzen Klammern in Adressen: sonst ließen sich SMTP-Befehle oder Header einschleusen.
const ADDRESS = /^[^\s<>()\[\]\\,;:"]+@[^\s<>()\[\]\\,;:"]+\.[^\s<>()\[\]\\,;:"]+$/;

export function validAddress(address: string): boolean {
  return ADDRESS.test(address) && address.length <= 254;
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
      await command(`${buildMessage(this.from, mail)}\r\n.`, [250]);
      await command("QUIT", [221]);
    } finally {
      conn.close();
    }
  }
}
