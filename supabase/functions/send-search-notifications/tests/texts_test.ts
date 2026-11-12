// Mailtexte der Suchauftrags- und Moderations-Mails (ADR 018, A5, A8, A13) gegen die gemeinsamen Fixtures.
import links from "../../../tests/fixtures/mail_links.json" with { type: "json" };
import labels from "../../../tests/fixtures/mail_labels.json" with { type: "json" };
import prices from "../../../tests/fixtures/price_format.json" with { type: "json" };
import { LANGUAGES } from "../../_shared/mail/text.ts";
import { ACCOUNT_DECISIONS, ACCOUNT_TEXTS } from "../account_texts.ts";
import {
  ACCOUNT_LISTINGS,
  ACCOUNT_SEARCHES,
  composeModerationMail,
  composeSearchMail,
  DECISIONS,
  IMPRINT,
  type Language,
  listingUrl,
  MODERATION_TEXTS,
  ON_REQUEST,
  PRICE_UNITS,
  priceText,
  REJECT_REASONS,
  type SearchItem,
  SEARCH_TEXTS,
} from "../texts.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const SITE = links.site;
const TOKEN = "c0".repeat(32);
const ID = links.listing_id;

function item(overrides: Partial<SearchItem> = {}): SearchItem {
  return {
    listing_id: ID,
    title: "Rehwildrevier in der Uckermark",
    kind: "lease",
    direction: "offer",
    district_code: "DE-12073",
    district_name: "Uckermark",
    state_code: "DE-BB",
    state_name: "Brandenburg",
    price_minor: 500000,
    currency: "EUR",
    price_unit: "per_year",
    ...overrides,
  };
}

Deno.test("Fixture: Detail-Links je Sprache wie publicPath im Web", () => {
  for (const { lang, path } of links.listing) {
    assert(listingUrl(SITE, lang as Language, ID) === `${SITE}${path}`, lang);
    const { text } = composeSearchMail(lang as Language, SITE, [item()], [], TOKEN);
    assert(text.includes(`${SITE}${path}`), `im Text ${lang}`);
  }
  assert(listingUrl(SITE, "de", "ID-GROSS") === null && listingUrl(SITE, "de", ID.toUpperCase()) === null, "nur UUID klein");
});

Deno.test("Fixture: Konto- und Rechtslinks sind Web-Routen (oder für Commit 6/7 vorgemerkt)", () => {
  const known = [...links.static_paths, ...links.pending_static_paths];
  for (const path of [ACCOUNT_SEARCHES, ACCOUNT_LISTINGS, IMPRINT, "unsubscribe"]) assert(known.includes(path), path);
});

Deno.test("Fixture: Preisformat wie das Web (kleinste Einheit, Währung, Einheit, auf Anfrage)", () => {
  for (const c of prices.cases) {
    const actual = priceText(c.price_minor, c.currency, c.price_unit, c.lang as Language);
    assert(actual === c.expected, `${c.name}: ${JSON.stringify(actual)} statt ${JSON.stringify(c.expected)}`);
  }
  assert(priceText(1.5, "EUR", "total", "de") === null, "keine Bruchteile");
  assert(priceText(100, "USD", "total", "de") === null, "nur bekannte Währungen");
  assert(priceText(100, "EUR", "per_week", "de") === null, "nur bekannte Einheiten");
});

Deno.test("Fixture: Labels (auf Anfrage, Einheiten, Ablehnungsgründe) wie die Web-Messages", () => {
  for (const lang of LANGUAGES) {
    assert(ON_REQUEST[lang] === labels.on_request[lang], `onRequest ${lang}`);
    assert(JSON.stringify(PRICE_UNITS[lang]) === JSON.stringify(labels.price_units[lang]), `Einheiten ${lang}`);
    assert(JSON.stringify(REJECT_REASONS[lang]) === JSON.stringify(labels.reject_reasons[lang]), `Gründe ${lang}`);
  }
});

Deno.test("Suchauftrags-Mail: Titel, Region, Preis, Link, Aufträge, Verlängern, Verwalten, Abbestellen", () => {
  const { subject, text } = composeSearchMail("de", SITE, [item(), item({ listing_id: "11111111-1111-4111-8111-111111111111", title: "Begehungsschein", price_minor: null, currency: null, price_unit: "on_request" })], [
    { id: "a", name: "Pacht Brandenburg", expires_at: "2026-12-01T10:00:00Z", extendable: true },
    { id: "b", name: "Begehung", expires_at: "2027-02-01T10:00:00Z", extendable: false },
  ], TOKEN);
  assert(subject === SEARCH_TEXTS.de.subject, "Betreff fest");
  assert(text.includes("- Rehwildrevier in der Uckermark\n  Region: Uckermark, Brandenburg\n  Preis: 5.000\u00a0€ pro Jahr\n"), "Eintrag (ICU-Leerzeichen)");
  assert(text.includes("  Preis: Auf Anfrage\n"), "auf Anfrage");
  assert(text.includes(`- Pacht Brandenburg\n  läuft am 1. Dezember 2026 ab, jetzt verlängern: ${SITE}/de/account/searches`), "Verlängern");
  assert(text.includes("- Begehung\n- ") || text.includes("- Begehung\n\n"), "ohne Hinweis außerhalb des Fensters");
  assert(text.includes(`${SEARCH_TEXTS.de.manage}\n${SITE}/de/account/searches`), "Verwalten");
  assert(text.includes(`${SEARCH_TEXTS.de.unsubscribe}\n${SITE}/de/unsubscribe?t=${TOKEN}`), "Abbestellen über die Seite");
  assert(!text.includes("/api/unsubscribe"), "keine POST-URL im Text");
  assert(!/<img|https?:\/\/(?!revier\.example\/)/.test(text), "keine fremden Links oder Pixel");
});

Deno.test("Suchauftrags-Mail: keine Zeilen- oder Header-Injektion über Titel, Region und Namen", () => {
  const evil = "X\r\nBcc: evil@example.com\r\n\r\nSubject: hi\u2028\u202E";
  const { subject, text } = composeSearchMail("en", SITE, [item({ title: evil, district_name: evil, state_name: null })], [
    { id: "a", name: evil, expires_at: null, extendable: true },
  ], TOKEN);
  assert(subject === SEARCH_TEXTS.en.subject, "Betreff ohne Nutzerinhalt");
  assert(!text.includes("\r") && !text.includes("\u2028") && !text.includes("\u202E"), "keine Steuerzeichen");
  assert(!text.split("\n").some((line) => /^(Bcc|Subject):/.test(line)), "keine Zeile beginnt wie ein Header");
  assert(text.includes("- X  Bcc: evil@example.com    Subject: hi"), "Titel bereinigt");
});

Deno.test("Suchauftrags-Mail: Rückfälle ohne Titel, Namen, Region, Preis; ungültige ID ohne Eintrag", () => {
  const { text } = composeSearchMail("cs", SITE, [
    item({ title: "  ", district_name: null, state_name: null, price_minor: null, currency: null, price_unit: null }),
    item({ listing_id: "kein-uuid", title: "Unsichtbar" }),
  ], [{ id: "a", name: null, expires_at: "kaputt", extendable: true }], TOKEN);
  assert(text.includes(`- ${SEARCH_TEXTS.cs.untitled}\n  ${SEARCH_TEXTS.cs.open}`), "ohne Titel, Region, Preis");
  assert(!text.includes("Unsichtbar"), "ungültige ID");
  assert(text.includes(`- ${SEARCH_TEXTS.cs.unnamed}\n`) && !text.includes("kaputt"), "ohne Namen, ohne kaputtes Datum");
});

Deno.test("Moderations-Mail: Betreff je Sprache und Entscheidung, Grund-Label, Begründung, Links", () => {
  for (const lang of LANGUAGES) {
    for (const decision of DECISIONS) {
      const approved = decision === "approved";
      const { subject, text } = composeModerationMail(lang, SITE, {
        decision,
        reject_code: approved ? null : "contact_in_text",
        reason: approved ? null : "Bitte\r\nTelefonnummer entfernen",
        listing_id: ID,
        title: "Drückjagd im Spessart",
        appeal_until: approved ? null : "2027-05-14T10:00:00Z",
      });
      const t = MODERATION_TEXTS[lang];
      assert(subject === t.subject[decision], `Betreff ${lang} ${decision}`);
      assert(text.includes("Drückjagd im Spessart"), `Titel ${lang} ${decision}`);
      assert(text.includes(`${t.dashboard}\n${SITE}/${lang}/account/listings`), `Dashboard ${lang} ${decision}`);
      if (approved) {
        assert(!text.includes(t.reasonLabel) && !text.includes(ACCOUNT_DECISIONS) && !text.includes(ACCOUNT_TEXTS[lang].remedies),
          `Freigabe ohne Begründung und ohne Anfechten ${lang}`);
        assert(text.includes(`${t.view}\n${SITE}${links.listing.find((l) => l.lang === lang)!.path}`), `Anzeige-Link ${lang}`);
      } else {
        assert(text.includes(`${t.reasonLabel} ${REJECT_REASONS[lang].contact_in_text}`), `Grund-Label ${lang} ${decision}`);
        assert(text.includes(`${t.reasonText} Bitte  Telefonnummer entfernen`), `Begründung bereinigt ${lang} ${decision}`);
        assert(text.includes(`\n${SITE}/${lang}/${ACCOUNT_DECISIONS}\n`) && text.includes("2027"), `Frist und Link ${lang} ${decision}`);
        assert(text.includes(ACCOUNT_TEXTS[lang].remedies) && !text.includes("/imprint"), `Platzhalter statt Kontaktweg ${lang}`);
      }
      assert(!text.includes("unsubscribe"), `kein Abbestellen ${lang} ${decision}`);
    }
  }
});

Deno.test("Moderations-Mail: unbekannter Code ohne Label, Injektion über Titel und Grund bereinigt", () => {
  const evil = "a\r\nBcc: x@y.de\u0000";
  const { subject, text } = composeModerationMail("pl", SITE, { decision: "removed", reject_code: "evil", reason: evil, listing_id: ID, title: evil });
  assert(subject === MODERATION_TEXTS.pl.subject.removed, "Betreff fest");
  assert(!text.includes(MODERATION_TEXTS.pl.reasonLabel), "unbekannter Code ohne Label");
  assert(!text.includes("\r") && !text.includes("\u0000"), "keine Steuerzeichen");
  assert(!text.split("\n").some((line) => line.startsWith("Bcc:")), "keine Header-Zeile");
});

Deno.test("Texte in vier Sprachen vollständig", () => {
  const keys = (o: object) => JSON.stringify(Object.keys(o).sort());
  for (const lang of LANGUAGES) {
    assert(keys(SEARCH_TEXTS[lang]) === keys(SEARCH_TEXTS.de), `Suche ${lang}`);
    assert(keys(MODERATION_TEXTS[lang]) === keys(MODERATION_TEXTS.de), `Moderation ${lang}`);
    assert(keys(MODERATION_TEXTS[lang].subject) === keys(MODERATION_TEXTS.de.subject), `Betreffe ${lang}`);
    assert(keys(MODERATION_TEXTS[lang].decision) === keys(MODERATION_TEXTS.de.decision), `Entscheidungen ${lang}`);
    for (const value of [...Object.values(SEARCH_TEXTS[lang]), ...Object.values(MODERATION_TEXTS[lang].subject)]) {
      if (typeof value === "string") assert(value.trim().length > 0 && !/[\r\n]/.test(value), `Text ${lang}`);
    }
  }
  // Eigene Sprachfassungen, keine Kopie der Quelle
  for (const lang of ["de", "cs", "pl"] as const) assert(SEARCH_TEXTS[lang].subject !== SEARCH_TEXTS.en.subject, lang);
});
