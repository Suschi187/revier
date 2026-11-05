import { buildMessage, encodeHeader, validAddress } from "../mailer.ts";
import { composeMail, language, TEXTS } from "../texts.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

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
});

Deno.test("Mailtext: kein Nachrichtentext, Steuerzeichen aus Namen entfernt, Links je Sprache", () => {
  const { text, subject } = composeMail("pl", "https://revier.example", [
    { conversation_id: "11111111-1111-4111-8111-111111111111", sender_name: "Ola\r\nBcc: x@y.de", listing_title: "Polowanie" },
    { conversation_id: "22222222-2222-4222-8222-222222222222", sender_name: null, listing_title: null },
  ]);
  assert(subject === TEXTS.pl.subject, "Betreff fest je Sprache");
  assert(!text.includes("\r") && text.includes("Ola  Bcc: x@y.de"), "Zeilenumbrüche aus Namen entfernt");
  assert(text.includes("https://revier.example/pl/account/messages/11111111-1111-4111-8111-111111111111"), "Link");
  assert(text.includes(TEXTS.pl.unknownSender), "Rückfall ohne Namen");
  assert(language("xx") === "de" && language("cs") === "cs", "Rückfall de");
});

Deno.test("Texte in vier Sprachen vollständig", () => {
  const keys = Object.keys(TEXTS.de).sort().join();
  for (const lang of ["en", "cs", "pl"] as const) assert(Object.keys(TEXTS[lang]).sort().join() === keys, lang);
});
