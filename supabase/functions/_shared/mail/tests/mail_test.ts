// Gemeinsamer Mailer (ADR 017, ADR 018 B4): Adressen, Nachrichtenaufbau, feste Zusatz-Header, SITE_URL, Token.
import { buildMessage, encodeHeader, extraHeaderLines, type Mail, SmtpMailer, validAddress } from "../mailer.ts";
import { parseSiteUrl, unsubscribeHeaders, unsubscribePageUrl, unsubscribePostUrl, validToken } from "../site.ts";
import { clean, language } from "../text.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function throws(fn: () => unknown, message: string): void {
  let thrown = false;
  try {
    fn();
  } catch {
    thrown = true;
  }
  assert(thrown, message);
}

const TOKEN = "0123456789abcdef".repeat(4);
const SITE = "https://revier.example";

Deno.test("Adressen ohne Zeilenumbrüche und spitze Klammern", () => {
  assert(validAddress("a.b@example.de"), "gültig");
  for (const bad of ["a@b.de\r\nRCPT TO:<x@y.de>", "a@b.de>", "<a@b.de", "a b@c.de", "kein-at", "a@b"]) {
    assert(!validAddress(bad), `ungültig: ${JSON.stringify(bad)}`);
  }
});

Deno.test("Nachricht: Betreff kodiert, Text Base64, kein Punkt am Zeilenanfang", () => {
  const message = buildMessage("noreply@revier.local", { to: "x@example.de", subject: "Neue Nachrichten", text: ".\nZeile\r\n.\r\nQUIT" });
  assert(message.includes(`Subject: ${encodeHeader("Neue Nachrichten")}`), "Betreff");
  assert(!/\r\n\.\r\n/.test(message), "kein Datenende im Text");
  assert(!message.split("\r\n").some((line) => line.startsWith(".")), "keine Zeile mit Punkt");
  assert(!/List-Unsubscribe/i.test(message), "ohne Zusatz-Header keine List-Unsubscribe-Zeile");
});

Deno.test("Zusatz-Header: One-Click genau mit POST-URL, Reihenfolge fest, vor der Leerzeile", () => {
  const headers = unsubscribeHeaders(SITE, TOKEN);
  assert(headers["List-Unsubscribe"] === `<${unsubscribePostUrl(SITE, TOKEN)}>`, "Header-URL = POST-URL");
  assert(unsubscribePostUrl(SITE, TOKEN) === `${SITE}/api/unsubscribe?t=${TOKEN}`, "POST-URL");
  assert(headers["List-Unsubscribe-Post"] === "List-Unsubscribe=One-Click", "Post-Header");
  const message = buildMessage("noreply@revier.local", { to: "x@example.de", subject: "S", text: "T", headers });
  const [head] = message.split("\r\n\r\n");
  const lines = head.split("\r\n");
  assert(lines.includes(`List-Unsubscribe: <${SITE}/api/unsubscribe?t=${TOKEN}>`), "List-Unsubscribe-Zeile");
  assert(lines.includes("List-Unsubscribe-Post: List-Unsubscribe=One-Click"), "Post-Zeile");
  assert(lines.indexOf("List-Unsubscribe-Post: List-Unsubscribe=One-Click") > lines.findIndex((l) => l.startsWith("List-Unsubscribe:")), "Reihenfolge");
  const local = unsubscribeHeaders("http://localhost:3000", TOKEN);
  assert(extraHeaderLines(local)[0] === `List-Unsubscribe: <http://localhost:3000/api/unsubscribe?t=${TOKEN}>`, "lokal");
});

Deno.test("Zusatz-Header: keine fremden Namen, keine Zeilenumbrüche, keine anderen Werte", () => {
  const base: Mail = { to: "x@example.de", subject: "S", text: "T" };
  const bad: unknown[] = [
    { "List-Unsubscribe": `<${SITE}/api/unsubscribe?t=${TOKEN}>\r\nBcc: y@z.de` },
    { "List-Unsubscribe": `<${SITE}/api/unsubscribe?t=${TOKEN}\n>` },
    { "List-Unsubscribe": `<${SITE}/api/unsubscribe?t=${TOKEN.toUpperCase()}>` },
    { "List-Unsubscribe": `<${SITE}/api/unsubscribe?t=${TOKEN}&x=1>` },
    { "List-Unsubscribe": `<${SITE}/de/unsubscribe?t=${TOKEN}>` },
    { "List-Unsubscribe": `<http://revier.example/api/unsubscribe?t=${TOKEN}>` },
    { "List-Unsubscribe": `<mailto:x@y.de>` },
    { "List-Unsubscribe-Post": "List-Unsubscribe=One-Click\r\nBcc: y@z.de" },
    { "List-Unsubscribe-Post": "anything" },
    { Bcc: "y@z.de" },
    { "List-Unsubscribe": 1 },
  ];
  for (const headers of bad) {
    throws(() => buildMessage("noreply@revier.local", { ...base, headers: headers as Mail["headers"] }), JSON.stringify(headers));
  }
});

Deno.test("SITE_URL: https oder lokal http, ohne Pfad, Query und Anmeldedaten", () => {
  const good: [string, string][] = [
    ["https://revier.example", "https://revier.example"],
    ["https://revier.example/", "https://revier.example"],
    ["https://www.revier-app.eu:8443", "https://www.revier-app.eu:8443"],
    ["http://localhost:3000", "http://localhost:3000"],
    ["http://localhost", "http://localhost"],
    ["http://127.0.0.1:3000/", "http://127.0.0.1:3000"],
  ];
  for (const [input, expected] of good) assert(parseSiteUrl(input) === expected, input);
  for (
    const bad of [
      undefined,
      "",
      "revier.example",
      "http://revier.example",
      "http://localhost.evil.example",
      "http://127.0.0.2",
      "https://revier.example/de",
      "https://revier.example?x=1",
      "https://revier.example#x",
      "https://user:pw@revier.example",
      "https://revier.example\r\nBcc: x@y.de",
      "https://revier.example ",
      " https://revier.example",
      "https://Revier.example",
      "https://revier.example:0",
      "https://revier.example:70000",
      "javascript:alert(1)",
      "ftp://revier.example",
    ]
  ) {
    assert(parseSiteUrl(bad) === null, `abgelehnt: ${JSON.stringify(bad)}`);
  }
});

Deno.test("Token nur 64 hex in Kleinbuchstaben; ungültige werfen beim Linkbau", () => {
  assert(validToken(TOKEN), "gültig");
  for (const bad of [null, undefined, 1, "", TOKEN.slice(1), `${TOKEN}0`, TOKEN.toUpperCase(), `${TOKEN.slice(0, 63)}\n`, `${TOKEN.slice(0, 62)}&x`]) {
    assert(!validToken(bad), `ungültig: ${JSON.stringify(bad)}`);
  }
  throws(() => unsubscribePostUrl(SITE, "x"), "POST-URL");
  throws(() => unsubscribePageUrl(SITE, "de", `${TOKEN}\r\n`), "Seite");
  throws(() => unsubscribeHeaders(SITE, "abc"), "Header");
  assert(unsubscribePageUrl(SITE, "cs", TOKEN) === `${SITE}/cs/unsubscribe?t=${TOKEN}`, "Bestätigungsseite");
});

Deno.test("clean: Steuerzeichen, Zeilentrenner und Bidi entfernt, Länge in Zeichen", () => {
  assert(clean("a\r\nb\u2028c\u202Ed\u0085e") === "a  b c d e", "ersetzt");
  assert(clean("  x  ") === "x", "getrimmt");
  assert(Array.from(clean("😀".repeat(200))).length === 120, "120 Zeichen ohne halbe Surrogate");
  assert(clean("a".repeat(2000), 1000).length === 1000, "eigene Grenze");
  assert(language("xx") === "de" && language("pl") === "pl", "Rückfall de");
});

Deno.test("SmtpMailer: Zusatz-Header kommen an, ungültiger Header bricht vor der Verbindung ab", async () => {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  const received: string[] = [];
  const server = (async () => {
    for await (const conn of listener) {
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();
      await conn.write(encoder.encode("220 test\r\n"));
      let buffer = "";
      let data = false;
      const chunk = new Uint8Array(65536);
      while (true) {
        const read = await conn.read(chunk);
        if (read === null) break;
        buffer += decoder.decode(chunk.subarray(0, read));
        let at: number;
        while ((at = buffer.indexOf(data ? "\r\n.\r\n" : "\r\n")) >= 0) {
          const line = buffer.slice(0, at);
          buffer = buffer.slice(at + (data ? 5 : 2));
          if (data) {
            received.push(line);
            data = false;
            await conn.write(encoder.encode("250 ok\r\n"));
          } else if (line === "DATA") {
            data = true;
            await conn.write(encoder.encode("354 go\r\n"));
          } else if (line === "QUIT") {
            await conn.write(encoder.encode("221 bye\r\n"));
          } else {
            await conn.write(encoder.encode("250 ok\r\n"));
          }
        }
      }
      conn.close();
      break;
    }
  })();
  const mailer = new SmtpMailer("127.0.0.1", port, "noreply@revier.local");
  await mailer.send({ to: "x@example.de", subject: "S", text: "T", headers: unsubscribeHeaders(SITE, TOKEN) });
  // Das break in for-await schließt den Listener.
  await server;
  assert(received.length === 1, "eine Nachricht");
  assert(received[0].includes(`\r\nList-Unsubscribe: <${SITE}/api/unsubscribe?t=${TOKEN}>\r\n`), "Header übertragen");
  // Kein Listener mehr: ein Verbindungsversuch würde mit einem anderen Fehler scheitern.
  let message = "";
  try {
    await mailer.send({ to: "x@example.de", subject: "S", text: "T", headers: { "List-Unsubscribe-Post": "x" } });
  } catch (error) {
    message = (error as Error).message;
  }
  assert(message === "header invalid", `vor der Verbindung: ${message}`);
});
