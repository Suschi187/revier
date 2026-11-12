// Dienstmails zur Verifizierung (ADR 020): vier Sprachen, Labels = Web (Fixture), Begründung bereinigt, Frist zum
// Anfechten mit Link, Rechtsbehelfe als markierter Platzhalter, kein Kontakt-Platzhalter aus M8.
import labels from "../../../tests/fixtures/mail_labels.json" with { type: "json" };
import links from "../../../tests/fixtures/mail_links.json" with { type: "json" };
import { LANGUAGES } from "../../_shared/mail/text.ts";
import {
  ACCOUNT_DECISIONS,
  ACCOUNT_KINDS,
  ACCOUNT_TEXTS,
  ACCOUNT_VERIFICATION,
  composeAccountMail,
  DOCUMENT_TYPES,
  REVOKE_REASONS,
  VERIFICATION_REASONS,
} from "../account_texts.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const SITE = links.site;
const details = {
  document_type: "jagdkarte",
  code: "other",
  reason: "Foto\r\nBcc: x@y.de \u202Eunscharf",
  decided_at: "2026-11-12T10:00:00Z",
  appeal_until: "2027-05-14T10:00:00Z",
};

Deno.test("Links sind Web-Routen oder vorgemerkt (Fixture)", () => {
  const known = [...links.static_paths, ...links.pending_static_paths];
  for (const path of [ACCOUNT_VERIFICATION, ACCOUNT_DECISIONS]) assert(known.includes(path), path);
});

Deno.test("Labels = Web-Messages (Fixture)", () => {
  for (const lang of LANGUAGES) {
    assert(JSON.stringify(DOCUMENT_TYPES[lang]) === JSON.stringify(labels.document_types[lang]), `Dokumenttypen ${lang}`);
    assert(JSON.stringify(VERIFICATION_REASONS[lang]) === JSON.stringify(labels.verification_reasons[lang]), `Gründe ${lang}`);
    assert(JSON.stringify(REVOKE_REASONS[lang]) === JSON.stringify(labels.revoke_reasons[lang]), `Widerruf ${lang}`);
  }
});

Deno.test("Jede Art in jeder Sprache: Betreff fest, Link auf die Verifizierung, Fußzeile", () => {
  for (const lang of LANGUAGES) {
    for (const kind of ACCOUNT_KINDS) {
      const mail = composeAccountMail(lang, SITE, kind, details)!;
      assert(mail.subject === ACCOUNT_TEXTS[lang].subject[kind], `${lang} ${kind} Betreff`);
      assert(!/[\r\n]/.test(mail.subject), "Betreff einzeilig");
      assert(mail.text.includes(`${SITE}/${lang}/${ACCOUNT_VERIFICATION}`), `${lang} ${kind} Link`);
      assert(mail.text.includes(DOCUMENT_TYPES[lang].jagdkarte), `${lang} ${kind} Dokumenttyp`);
      assert(mail.text.endsWith(ACCOUNT_TEXTS[lang].footer), `${lang} ${kind} Fußzeile`);
      assert(!mail.text.includes("imprint") && !mail.text.includes("Impressum"), "kein Kontakt-Platzhalter aus M8");
    }
  }
});

Deno.test("Ablehnung und Widerruf: Grund, bereinigte Begründung, Frist mit Link, markierter Platzhalter", () => {
  for (const lang of LANGUAGES) {
    for (const kind of ["verification_rejected", "verification_revoked"] as const) {
      const mail = composeAccountMail(lang, SITE, kind, details)!;
      const reasons = kind === "verification_rejected" ? VERIFICATION_REASONS[lang] : REVOKE_REASONS[lang];
      assert(mail.text.includes(reasons.other), `${lang} ${kind} Grund`);
      assert(!mail.text.includes("\r") && !mail.text.includes("Bcc: x@y.de\n") && !mail.text.includes("\u202E"), "bereinigt");
      assert(mail.text.includes(`${SITE}/${lang}/${ACCOUNT_DECISIONS}`), `${lang} ${kind} Link zu den Entscheidungen`);
      assert(mail.text.includes("2027"), `${lang} ${kind} Frist`);
      assert(mail.text.includes(ACCOUNT_TEXTS[lang].remedies) && ACCOUNT_TEXTS[lang].remedies.startsWith("["), "Platzhalter markiert");
    }
  }
  const verified = composeAccountMail("de", SITE, "verification_verified", details)!;
  assert(!verified.text.includes(ACCOUNT_DECISIONS) && !verified.text.includes("Begründung"), "Verifiziert: kein Anfechten, keine Begründung");
});

Deno.test("Ohne Details keine Mail; unbekannte Codes und Typen ohne Label", () => {
  assert(composeAccountMail("de", SITE, "verification_rejected", null) === null, "null");
  const mail = composeAccountMail("en", SITE, "verification_rejected", { document_type: "pass", code: "blurry", reason: null, appeal_until: null })!;
  assert(mail.text.includes("(document)") && !mail.text.includes("blurry") && !mail.text.includes("Reason:"), "ohne Label");
  assert(!mail.text.includes(ACCOUNT_DECISIONS), "ohne Frist kein Link");
});
