// Dienstmails zur Verifizierung (ADR 020): vier Sprachen, Labels = Web (Fixture), Begründung bereinigt, Frist zum
// Anfechten mit Link, Rechtsbehelfe als markierter Platzhalter, kein Kontakt-Platzhalter aus M8.
import labels from "../../../tests/fixtures/mail_labels.json" with { type: "json" };
import links from "../../../tests/fixtures/mail_links.json" with { type: "json" };
import { LANGUAGES } from "../../_shared/mail/text.ts";
import {
  ACCOUNT_CODES,
  ACCOUNT_DECISIONS,
  ACCOUNT_REPORTS,
  ACCOUNT_TEXTS,
  ACCOUNT_VERIFICATION,
  composeAccountMail,
  DECISION_ACTIONS,
  DOCUMENT_TYPES,
  GUIDELINES,
  REPORT_OUTCOMES,
  REVOKE_REASONS,
  TRUST_TEXTS,
  VERIFICATION_REASONS,
} from "../account_texts.ts";

const VERIFICATION_KINDS = ["verification_verified", "verification_rejected", "verification_revoked"] as const;

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
  for (const path of [ACCOUNT_VERIFICATION, ACCOUNT_DECISIONS, ACCOUNT_REPORTS, GUIDELINES]) assert(known.includes(path), path);
});

Deno.test("Labels = Web-Messages (Fixture)", () => {
  for (const lang of LANGUAGES) {
    assert(JSON.stringify(DOCUMENT_TYPES[lang]) === JSON.stringify(labels.document_types[lang]), `Dokumenttypen ${lang}`);
    assert(JSON.stringify(VERIFICATION_REASONS[lang]) === JSON.stringify(labels.verification_reasons[lang]), `Gründe ${lang}`);
    assert(JSON.stringify(REVOKE_REASONS[lang]) === JSON.stringify(labels.revoke_reasons[lang]), `Widerruf ${lang}`);
    assert(JSON.stringify(ACCOUNT_CODES[lang]) === JSON.stringify(labels.account_codes[lang]), `Konto-Codes ${lang}`);
    assert(JSON.stringify(REPORT_OUTCOMES[lang]) === JSON.stringify(labels.report_outcomes[lang]), `Ergebnisse ${lang}`);
    assert(JSON.stringify(DECISION_ACTIONS[lang]) === JSON.stringify(labels.decision_actions[lang]), `Entscheidungen ${lang}`);
  }
});

Deno.test("Jede Art in jeder Sprache: Betreff fest, Link auf die Verifizierung, Fußzeile", () => {
  for (const lang of LANGUAGES) {
    for (const kind of VERIFICATION_KINDS) {
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

const trust = {
  code: "harassment",
  reason: "Beleidigungen\r\nBcc: x@y.de",
  decided_at: "2026-11-12T10:00:00Z",
  appeal_until: "2027-05-14T10:00:00Z",
};

Deno.test("Sperre, Entsperrung, Verwarnung: Code, Begründung, Frist und Platzhalter je Sprache", () => {
  for (const lang of LANGUAGES) {
    const blocked = composeAccountMail(lang, SITE, "account_blocked", trust)!;
    assert(blocked.subject === TRUST_TEXTS[lang].subject.account_blocked, `Betreff ${lang}`);
    assert(blocked.text.includes(ACCOUNT_CODES[lang].harassment) && blocked.text.includes(`${SITE}/${lang}/${ACCOUNT_DECISIONS}`), `Sperre ${lang}`);
    assert(blocked.text.includes(ACCOUNT_TEXTS[lang].remedies) && !blocked.text.includes("\r"), `Platzhalter, bereinigt ${lang}`);
    const warned = composeAccountMail(lang, SITE, "account_warned", trust)!;
    assert(warned.text.includes(`${SITE}/${lang}/${GUIDELINES}`) && warned.text.includes("2027"), `Verwarnung ${lang}`);
    const unblocked = composeAccountMail(lang, SITE, "account_unblocked", { reason: "Beschwerde berechtigt", decided_at: trust.decided_at })!;
    assert(!unblocked.text.includes(ACCOUNT_DECISIONS) && unblocked.text.includes("Beschwerde berechtigt"), `Entsperrung ${lang}`);
  }
});

Deno.test("Meldungsergebnis: nur Zieltyp, Ergebnis, Titel bei Anzeigen; nichts über das Gegenüber", () => {
  for (const lang of LANGUAGES) {
    const mail = composeAccountMail(lang, SITE, "report_resolved", {
      target_type: "listing", outcome: "content_removed", listing_title: "Pacht\nUckermark", appeal_until: trust.appeal_until,
    })!;
    assert(mail.text.includes(REPORT_OUTCOMES[lang].content_removed) && mail.text.includes("Pacht Uckermark"), `Ergebnis ${lang}`);
    assert(mail.text.includes(`${SITE}/${lang}/${ACCOUNT_REPORTS}`) && mail.text.includes(ACCOUNT_DECISIONS), `Links ${lang}`);
  }
  assert(composeAccountMail("de", SITE, "report_resolved", { target_type: "listing", outcome: "geheim" }) === null, "unbekanntes Ergebnis");
  const profile = composeAccountMail("de", SITE, "report_resolved", { target_type: "profile", outcome: "account_blocked" })!;
  assert(profile.text.includes("deine Meldung zu einem Profil") && !profile.text.includes("Anzeige:"), "Profil ohne Namen");
});

Deno.test("Beschwerde: bestätigt mit Platzhalter, aufgehoben ohne", () => {
  for (const lang of LANGUAGES) {
    const upheld = composeAccountMail(lang, SITE, "appeal_decided", { status: "upheld", decision_action: "profile.blocked", reason: "Geprüft" })!;
    assert(upheld.text.includes(DECISION_ACTIONS[lang].profile_blocked) && upheld.text.includes(ACCOUNT_TEXTS[lang].remedies), `bestätigt ${lang}`);
    const reversed = composeAccountMail(lang, SITE, "appeal_decided", { status: "reversed", decision_action: "listing.removed", reason: "Fehler" })!;
    assert(reversed.text.includes(DECISION_ACTIONS[lang].listing_removed) && !reversed.text.includes(ACCOUNT_TEXTS[lang].remedies), `aufgehoben ${lang}`);
  }
  assert(composeAccountMail("de", SITE, "appeal_decided", { status: "open", decision_action: "profile.blocked" }) === null, "offen: keine Mail");
});

Deno.test("Hinweis auf verlassenen Entwurf: Titel, Datum, Link zum Bearbeiten; ohne ID keine Mail", () => {
  const id = "3f2b8c1e-6a4d-4e7b-9c10-5d8e2f1a0b7c";
  for (const lang of LANGUAGES) {
    const mail = composeAccountMail(lang, SITE, "draft_expiry_notice", { listing_id: id, listing_title: "Pacht\nSpessart", deletes_at: "2026-12-12T00:00:00Z" })!;
    assert(mail.subject === TRUST_TEXTS[lang].subject.draft_expiry_notice, `Betreff ${lang}`);
    assert(mail.text.includes("Pacht Spessart") && mail.text.includes("2026"), `Titel und Datum ${lang}`);
    assert(mail.text.includes(`${SITE}/${lang}/account/listings/${id}/edit`), `Link ${lang}`);
    assert(!mail.text.includes(ACCOUNT_DECISIONS), `kein Anfechten ${lang}`);
  }
  assert(composeAccountMail("de", SITE, "draft_expiry_notice", { listing_id: "x", deletes_at: "2026-12-12T00:00:00Z" }) === null, "ID ungültig");
});
