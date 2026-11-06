// Chat-Mailtexte (ADR 017, ADR 018 B4). Mailer, Header und SITE_URL prüft _shared/mail/tests/mail_test.ts.
import fixture from "../../../tests/fixtures/mail_links.json" with { type: "json" };
import { composeMail, language, TEXTS } from "../texts.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const TOKEN = "ab".repeat(32);

Deno.test("Mailtext: kein Nachrichtentext, Steuerzeichen aus Namen entfernt, Links je Sprache", () => {
  const { text, subject } = composeMail("pl", "https://revier.example", [
    { conversation_id: "11111111-1111-4111-8111-111111111111", sender_name: "Ola\r\nBcc: x@y.de", listing_title: "Polowanie" },
    { conversation_id: "22222222-2222-4222-8222-222222222222", sender_name: null, listing_title: null },
  ], TOKEN);
  assert(subject === TEXTS.pl.subject, "Betreff fest je Sprache");
  assert(!text.includes("\r") && text.includes("Ola  Bcc: x@y.de"), "Zeilenumbrüche aus Namen entfernt");
  assert(text.includes("https://revier.example/pl/account/messages/11111111-1111-4111-8111-111111111111"), "Link");
  assert(text.includes(TEXTS.pl.unknownSender), "Rückfall ohne Namen");
  assert(language("xx") === "de" && language("cs") === "cs", "Rückfall de");
});

Deno.test("Mailtext: Abbestellen über die Bestätigungsseite, nicht über die POST-URL", () => {
  for (const lang of ["en", "de", "cs", "pl"] as const) {
    const { text } = composeMail(lang, fixture.site, [], TOKEN);
    assert(text.includes(`${TEXTS[lang].unsubscribe}\n${fixture.site}/${lang}/unsubscribe?t=${TOKEN}`), `Seite ${lang}`);
    assert(!text.includes(fixture.unsubscribe_post_path), `keine POST-URL im Text ${lang}`);
    assert(text.includes(`${fixture.site}/${lang}/account/profile`), `Profil ${lang}`);
  }
  let thrown = false;
  try {
    composeMail("de", fixture.site, [], "kein-token");
  } catch {
    thrown = true;
  }
  assert(thrown, "ungültiger Token wirft");
});

Deno.test("Links der Chat-Mail sind Web-Routen (Fixture)", () => {
  for (const path of ["account/profile", "account/messages/:id"]) assert(fixture.static_paths.includes(path), path);
  // Seit M8 Commit 7 eine Web-Route; pending_static_paths ist leer (als JSON-Import vom Typ never[]).
  assert(fixture.static_paths.includes("unsubscribe"), "unsubscribe");
});

Deno.test("Texte in vier Sprachen vollständig", () => {
  const keys = Object.keys(TEXTS.de).sort().join();
  for (const lang of ["en", "cs", "pl"] as const) assert(Object.keys(TEXTS[lang]).sort().join() === keys, lang);
});
