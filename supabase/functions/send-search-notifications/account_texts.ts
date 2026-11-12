// Dienstmails aus private.account_notifications (ADR 020, Review A11) in vier Sprachen, Begriffe laut
// docs/GLOSSARY.md, Rückfall de. Nur Klartext, Betreff fest je Sprache und Art, nie Admin-Identität, interne Notizen,
// Kontaktdaten Dritter oder Dokumentinhalte. Begründungen nur bereinigt im Text.
//
// Verifizierung (Commit 7), Sperre, Verwarnung, Meldungsergebnis und Beschwerde (Commit 9); verlassene Entwürfe folgen
// mit den Aufräumjobs. Dokumenttypen und Labels sind Kopien aus web/messages (Verification.*, Moderation.accountCodes,
// Report.outcomes, Decisions.actions); die Fixture supabase/tests/fixtures/mail_labels.json prüft beide
// Seiten.
import { clean, type Language } from "../_shared/mail/text.ts";

export const ACCOUNT_VERIFICATION = "account/verification";
export const ACCOUNT_DECISIONS = "account/decisions";

export const ACCOUNT_REPORTS = "account/reports";
export const ACCOUNT_LISTINGS_PATH = "account/listings";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const GUIDELINES = "guidelines";

export type VerificationKind = "verification_verified" | "verification_rejected" | "verification_revoked";
export type TrustKind = "account_blocked" | "account_unblocked" | "account_warned" | "report_resolved" | "appeal_decided" | "draft_expiry_notice";
export type AccountKind = VerificationKind | TrustKind;
export const ACCOUNT_KINDS: readonly AccountKind[] = [
  "verification_verified",
  "verification_rejected",
  "verification_revoked",
  "account_blocked",
  "account_unblocked",
  "account_warned",
  "report_resolved",
  "appeal_decided",
  "draft_expiry_notice",
];

function isVerificationKind(kind: AccountKind): kind is VerificationKind {
  return kind.startsWith("verification_");
}

export function isAccountKind(value: unknown): value is AccountKind {
  return typeof value === "string" && (ACCOUNT_KINDS as readonly string[]).includes(value);
}

export type DocumentType = "jagdschein" | "jagdkarte" | "revierbescheinigung" | "gewerbe";
export type VerificationReason = "unreadable" | "expired" | "mismatch" | "wrong_document" | "other";
export type RevokeReason = "expired" | "mismatch" | "fraud" | "other";

/** Verification.documentTypes aus web/messages. */
export const DOCUMENT_TYPES: Record<Language, Record<DocumentType, string>> = {
  en: { jagdschein: "Hunting licence", jagdkarte: "Hunting card", revierbescheinigung: "Hunting ground certificate", gewerbe: "Business registration" },
  de: { jagdschein: "Jagdschein", jagdkarte: "Jagdkarte", revierbescheinigung: "Revierbescheinigung", gewerbe: "Gewerbenachweis" },
  cs: { jagdschein: "Lovecký lístek", jagdkarte: "Lovecká karta", revierbescheinigung: "Potvrzení o honitbě", gewerbe: "Doklad o podnikání" },
  pl: {
    jagdschein: "Legitymacja myśliwska",
    jagdkarte: "Karta łowiecka",
    revierbescheinigung: "Zaświadczenie o obwodzie łowieckim",
    gewerbe: "Dowód działalności gospodarczej",
  },
};

/** Verification.reasons aus web/messages (Check verifications.reject_code). */
export const VERIFICATION_REASONS: Record<Language, Record<VerificationReason, string>> = {
  en: {
    unreadable: "Document not readable",
    expired: "Document expired",
    mismatch: "Details do not match the account",
    wrong_document: "Wrong document type",
    other: "Other reason",
  },
  de: {
    unreadable: "Dokument nicht lesbar",
    expired: "Dokument abgelaufen",
    mismatch: "Angaben passen nicht zum Konto",
    wrong_document: "Falscher Dokumenttyp",
    other: "Anderer Grund",
  },
  cs: {
    unreadable: "Doklad není čitelný",
    expired: "Platnost dokladu vypršela",
    mismatch: "Údaje neodpovídají účtu",
    wrong_document: "Nesprávný typ dokladu",
    other: "Jiný důvod",
  },
  pl: {
    unreadable: "Dokument nieczytelny",
    expired: "Dokument wygasł",
    mismatch: "Dane nie pasują do konta",
    wrong_document: "Niewłaściwy rodzaj dokumentu",
    other: "Inny powód",
  },
};

/** Verification.revokeReasons aus web/messages (Check verifications.revoke_code). */
export const REVOKE_REASONS: Record<Language, Record<RevokeReason, string>> = {
  en: { expired: "Document expired", mismatch: "Details do not match the account", fraud: "Suspicion of misuse", other: "Other reason" },
  de: { expired: "Dokument abgelaufen", mismatch: "Angaben passen nicht zum Konto", fraud: "Verdacht auf Missbrauch", other: "Anderer Grund" },
  cs: { expired: "Platnost dokladu vypršela", mismatch: "Údaje neodpovídají účtu", fraud: "Podezření na zneužití", other: "Jiný důvod" },
  pl: { expired: "Dokument wygasł", mismatch: "Dane nie pasują do konta", fraud: "Podejrzenie nadużycia", other: "Inny powód" },
};

type AccountTexts = {
  subject: Record<VerificationKind, string>;
  greeting: string;
  body: Record<VerificationKind, (type: string) => string>;
  verifiedRetention: string;
  reasonLabel: string;
  reasonText: string;
  verification: string;
  newRequest: string;
  appeal: (date: string) => string;
  // PLATZHALTER (SPEC 7.2, DSA Art. 17 Abs. 3 f, Art. 21): Rechtsbehelfe und außergerichtliche Streitbeilegung
  // formuliert der Anwalt; bis dahin nur dieser markierte Hinweis.
  remedies: string;
  unknownType: string;
  footer: string;
};

export const ACCOUNT_TEXTS: Record<Language, AccountTexts> = {
  en: {
    subject: {
      verification_verified: "Your account on Revier is verified",
      verification_rejected: "Your verification request on Revier was rejected",
      verification_revoked: "Your verification on Revier was revoked",
    },
    greeting: "Hello,",
    body: {
      verification_verified: (type) => `your document (${type}) has been reviewed. Your account is now verified, and your listings show the badge “Verified”.`,
      verification_rejected: (type) => `your verification request (${type}) has been rejected.`,
      verification_revoked: (type) => `your verification (${type}) has been revoked. The badge “Verified” is no longer shown.`,
    },
    verifiedRetention: "Your document will be deleted 30 days after the decision.",
    reasonLabel: "Reason:",
    reasonText: "Explanation:",
    verification: "Your verification:",
    newRequest: "You can submit a new request:",
    appeal: (date) => `You can challenge this decision until ${date}:`,
    remedies: "[Preliminary note] Information on out-of-court dispute settlement and on legal remedies will follow.",
    unknownType: "document",
    footer: "This message was sent automatically. Replies to this email are not delivered.",
  },
  de: {
    subject: {
      verification_verified: "Dein Konto auf Revier ist verifiziert",
      verification_rejected: "Dein Antrag auf Verifizierung bei Revier wurde abgelehnt",
      verification_revoked: "Deine Verifizierung auf Revier wurde widerrufen",
    },
    greeting: "Hallo,",
    body: {
      verification_verified: (type) => `dein Dokument (${type}) wurde geprüft. Dein Konto ist jetzt verifiziert, und deine Anzeigen zeigen das Badge „verifiziert“.`,
      verification_rejected: (type) => `dein Antrag auf Verifizierung (${type}) wurde abgelehnt.`,
      verification_revoked: (type) => `deine Verifizierung (${type}) wurde widerrufen. Das Badge „verifiziert“ wird nicht mehr angezeigt.`,
    },
    verifiedRetention: "Dein Dokument wird 30 Tage nach der Entscheidung gelöscht.",
    reasonLabel: "Grund:",
    reasonText: "Begründung:",
    verification: "Deine Verifizierung:",
    newRequest: "Du kannst einen neuen Antrag stellen:",
    appeal: (date) => `Du kannst diese Entscheidung bis zum ${date} anfechten:`,
    remedies: "[Vorläufiger Hinweis] Angaben zur außergerichtlichen Streitbeilegung und zu Rechtsbehelfen folgen.",
    unknownType: "Dokument",
    footer: "Diese Nachricht wurde automatisch versendet. Antworten auf diese E-Mail kommen nicht an.",
  },
  cs: {
    subject: {
      verification_verified: "Váš účet na Revier je ověřený",
      verification_rejected: "Vaše žádost o ověření na Revier byla zamítnuta",
      verification_revoked: "Vaše ověření na Revier bylo odvoláno",
    },
    greeting: "Dobrý den,",
    body: {
      verification_verified: (type) => `váš doklad (${type}) byl zkontrolován. Váš účet je nyní ověřený a vaše inzeráty zobrazují odznak „ověřený“.`,
      verification_rejected: (type) => `vaše žádost o ověření (${type}) byla zamítnuta.`,
      verification_revoked: (type) => `vaše ověření (${type}) bylo odvoláno. Odznak „ověřený“ se již nezobrazuje.`,
    },
    verifiedRetention: "Váš doklad bude smazán 30 dní po rozhodnutí.",
    reasonLabel: "Důvod:",
    reasonText: "Odůvodnění:",
    verification: "Vaše ověření:",
    newRequest: "Můžete podat novou žádost:",
    appeal: (date) => `Proti tomuto rozhodnutí se můžete ohradit do ${date}:`,
    remedies: "[Předběžné upozornění] Informace o mimosoudním řešení sporů a o opravných prostředcích budou doplněny.",
    unknownType: "doklad",
    footer: "Tato zpráva byla odeslána automaticky. Odpovědi na tento e-mail nebudou doručeny.",
  },
  pl: {
    subject: {
      verification_verified: "Twoje konto w Revier jest zweryfikowane",
      verification_rejected: "Twój wniosek o weryfikację w Revier został odrzucony",
      verification_revoked: "Twoja weryfikacja w Revier została cofnięta",
    },
    greeting: "Dzień dobry,",
    body: {
      verification_verified: (type) => `Twój dokument (${type}) został sprawdzony. Twoje konto jest teraz zweryfikowane, a Twoje ogłoszenia pokazują odznakę „zweryfikowany”.`,
      verification_rejected: (type) => `Twój wniosek o weryfikację (${type}) został odrzucony.`,
      verification_revoked: (type) => `Twoja weryfikacja (${type}) została cofnięta. Odznaka „zweryfikowany” nie jest już wyświetlana.`,
    },
    verifiedRetention: "Twój dokument zostanie usunięty 30 dni po decyzji.",
    reasonLabel: "Powód:",
    reasonText: "Uzasadnienie:",
    verification: "Twoja weryfikacja:",
    newRequest: "Możesz złożyć nowy wniosek:",
    appeal: (date) => `Możesz zakwestionować tę decyzję do ${date}:`,
    remedies: "[Wstępna informacja] Informacje o pozasądowym rozstrzyganiu sporów i o środkach prawnych zostaną uzupełnione.",
    unknownType: "dokument",
    footer: "Ta wiadomość została wysłana automatycznie. Odpowiedzi na tego e-maila nie są dostarczane.",
  },
};

export type AccountDetails = {
  document_type?: string | null;
  code?: string | null;
  reason?: string | null;
  decided_at?: string | null;
  appeal_until?: string | null;
  target_type?: string | null;
  outcome?: string | null;
  listing_title?: string | null;
  status?: string | null;
  decision_action?: string | null;
  listing_id?: string | null;
  deletes_at?: string | null;
};

function formatDate(iso: string | null | undefined, lang: Language): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(lang, { dateStyle: "long", timeZone: "Europe/Berlin" }).format(date);
}

function label(labels: Readonly<Record<string, string>>, code: string | null | undefined): string | null {
  return code && Object.hasOwn(labels, code) ? labels[code] : null;
}

/** Dienstmail je Art. `null` ohne Details (Quelle fehlt): dann keine Mail. */
export function composeAccountMail(
  lang: Language,
  site: string,
  kind: AccountKind,
  details: AccountDetails | null,
): { subject: string; text: string } | null {
  if (!details) return null;
  if (!isVerificationKind(kind)) return composeTrustMail(lang, site, kind, details);
  const t = ACCOUNT_TEXTS[lang];
  const type = label(DOCUMENT_TYPES[lang], details.document_type) ?? t.unknownType;
  const verification = `${site}/${lang}/${ACCOUNT_VERIFICATION}`;
  const lines = [t.greeting, "", t.body[kind](type), ""];
  if (kind === "verification_verified") {
    lines.push(t.verifiedRetention, "", t.verification, verification, "");
  } else {
    const reason = label(kind === "verification_rejected" ? VERIFICATION_REASONS[lang] : REVOKE_REASONS[lang], details.code);
    if (reason) lines.push(`${t.reasonLabel} ${reason}`);
    const note = details.reason ? clean(details.reason, 1000) : "";
    if (note) lines.push(`${t.reasonText} ${note}`);
    if (lines[lines.length - 1] !== "") lines.push("");
    lines.push(t.newRequest, verification, "");
    const until = formatDate(details.appeal_until, lang);
    if (until) lines.push(t.appeal(until), `${site}/${lang}/${ACCOUNT_DECISIONS}`, "");
    lines.push(t.remedies, "");
  }
  lines.push(t.footer);
  return { subject: t.subject[kind], text: lines.join("\n") };
}

// ---------------------------------------------------------------------------------------------------------------
// Sperre, Verwarnung, Meldungsergebnis, Beschwerde (Commit 9)
// ---------------------------------------------------------------------------------------------------------------

export type AccountCode = "scam" | "illegal" | "weapons" | "harassment" | "spam" | "other";
export type ReportOutcome = "no_action" | "content_removed" | "point_removed" | "account_warned" | "account_blocked" | "target_gone";
export type ReportTarget = "listing" | "profile" | "message";
export type DecisionAction =
  | "listing_rejected"
  | "listing_draft"
  | "listing_removed"
  | "listing_point_removed"
  | "profile_blocked"
  | "profile_warned"
  | "verification_rejected"
  | "verification_revoked"
  | "report_handled";

/** Moderation.accountCodes aus web/messages (private.account_action_codes). */
export const ACCOUNT_CODES: Record<Language, Record<AccountCode, string>> = {
  en: {
    scam: "Fraud or attempted fraud",
    illegal: "Illegal content",
    weapons: "Weapons or ammunition offered",
    harassment: "Harassment or insults",
    spam: "Spam or misleading advertising",
    other: "Other reason",
  },
  de: {
    scam: "Betrug oder Betrugsversuch",
    illegal: "Rechtswidrige Inhalte",
    weapons: "Waffen oder Munition angeboten",
    harassment: "Belästigung oder Beleidigung",
    spam: "Spam oder irreführende Werbung",
    other: "Anderer Grund",
  },
  cs: {
    scam: "Podvod nebo pokus o podvod",
    illegal: "Protiprávní obsah",
    weapons: "Nabídka zbraní nebo střeliva",
    harassment: "Obtěžování nebo urážky",
    spam: "Spam nebo klamavá reklama",
    other: "Jiný důvod",
  },
  pl: {
    scam: "Oszustwo lub próba oszustwa",
    illegal: "Treści niezgodne z prawem",
    weapons: "Oferowanie broni lub amunicji",
    harassment: "Nękanie lub obrażanie",
    spam: "Spam lub wprowadzająca w błąd reklama",
    other: "Inny powód",
  },
};

/** Report.outcomes aus web/messages (Check reports.outcome). */
export const REPORT_OUTCOMES: Record<Language, Record<ReportOutcome, string>> = {
  en: {
    no_action: "No action taken",
    content_removed: "Content removed",
    point_removed: "Map point removed",
    account_warned: "Account warned",
    account_blocked: "Account blocked",
    target_gone: "Content no longer available",
  },
  de: {
    no_action: "Keine Maßnahme",
    content_removed: "Inhalt entfernt",
    point_removed: "Kartenpunkt entfernt",
    account_warned: "Konto verwarnt",
    account_blocked: "Konto gesperrt",
    target_gone: "Inhalt nicht mehr vorhanden",
  },
  cs: {
    no_action: "Bez opatření",
    content_removed: "Obsah odstraněn",
    point_removed: "Bod na mapě odstraněn",
    account_warned: "Účet napomenut",
    account_blocked: "Účet zablokován",
    target_gone: "Obsah již není k dispozici",
  },
  pl: {
    no_action: "Brak działań",
    content_removed: "Treść usunięta",
    point_removed: "Punkt na mapie usunięty",
    account_warned: "Konto upomniane",
    account_blocked: "Konto zablokowane",
    target_gone: "Treść już niedostępna",
  },
};

/** Nur in Mails, im Fall des Satzes „deine Meldung zu …“ (keine Web-Kopie). */
export const REPORT_TARGETS: Record<Language, Record<ReportTarget, string>> = {
  en: { listing: "a listing", profile: "a profile", message: "a message" },
  de: { listing: "einer Anzeige", profile: "einem Profil", message: "einer Nachricht" },
  cs: { listing: "inzerátu", profile: "profilu", message: "zprávy" },
  pl: { listing: "ogłoszenia", profile: "profilu", message: "wiadomości" },
};

/** Decisions.actions aus web/messages (Audit-Arten mit „_“ statt „.“). */
export const DECISION_ACTIONS: Record<Language, Record<DecisionAction, string>> = {
  en: {
    listing_rejected: "Listing rejected",
    listing_draft: "Changes requested",
    listing_removed: "Listing removed",
    listing_point_removed: "Map point removed",
    profile_blocked: "Account blocked",
    profile_warned: "Warning",
    verification_rejected: "Verification rejected",
    verification_revoked: "Verification revoked",
    report_handled: "Decision on your report",
  },
  de: {
    listing_rejected: "Anzeige abgelehnt",
    listing_draft: "Änderungen angefragt",
    listing_removed: "Anzeige entfernt",
    listing_point_removed: "Kartenpunkt entfernt",
    profile_blocked: "Konto gesperrt",
    profile_warned: "Verwarnung",
    verification_rejected: "Verifizierung abgelehnt",
    verification_revoked: "Verifizierung widerrufen",
    report_handled: "Entscheidung zu deiner Meldung",
  },
  cs: {
    listing_rejected: "Inzerát zamítnut",
    listing_draft: "Požadovány úpravy",
    listing_removed: "Inzerát odstraněn",
    listing_point_removed: "Bod na mapě odstraněn",
    profile_blocked: "Účet zablokován",
    profile_warned: "Napomenutí",
    verification_rejected: "Ověření zamítnuto",
    verification_revoked: "Ověření odvoláno",
    report_handled: "Rozhodnutí o vašem nahlášení",
  },
  pl: {
    listing_rejected: "Ogłoszenie odrzucone",
    listing_draft: "Prośba o poprawki",
    listing_removed: "Ogłoszenie usunięte",
    listing_point_removed: "Punkt na mapie usunięty",
    profile_blocked: "Konto zablokowane",
    profile_warned: "Upomnienie",
    verification_rejected: "Weryfikacja odrzucona",
    verification_revoked: "Weryfikacja cofnięta",
    report_handled: "Decyzja w sprawie Twojego zgłoszenia",
  },
};

type TrustTexts = {
  subject: Record<TrustKind, string>;
  blocked: string;
  unblocked: string;
  warned: string;
  guidelines: string;
  report: (target: string) => string;
  reportTitle: (title: string) => string;
  result: string;
  reports: string;
  appeal: { upheld: (action: string) => string; reversed: (action: string) => string };
  decisions: string;
  draft: (title: string, date: string) => string;
  draftEdit: string;
  untitled: string;
};

export const TRUST_TEXTS: Record<Language, TrustTexts> = {
  en: {
    subject: {
      account_blocked: "Your account on Revier has been blocked",
      account_unblocked: "Your account on Revier has been unblocked",
      account_warned: "A warning for your account on Revier",
      report_resolved: "Your report on Revier has been reviewed",
      appeal_decided: "Decision on your challenge on Revier",
      draft_expiry_notice: "Your draft on Revier will be deleted soon",
    },
    blocked:
      "your account has been blocked. You can no longer publish listings or write messages. You can still sign in, download your data, delete your account and challenge this decision.",
    unblocked: "your account has been unblocked. You can use Revier as usual again.",
    warned: "the team has issued a warning for your account. Please follow the content guidelines.",
    guidelines: "Content guidelines:",
    report: (target) => `your report about ${target} has been reviewed.`,
    reportTitle: (title) => `Listing: “${title}”`,
    result: "Result:",
    reports: "Your reports:",
    appeal: {
      upheld: (action) => `your challenge against the decision “${action}” has been reviewed. The decision stands.`,
      reversed: (action) => `your challenge against the decision “${action}” has been reviewed. The decision has been reversed.`,
    },
    decisions: "Your decisions:",
    draft: (title, date) => `your draft “${title}” has not been edited for a long time and will be deleted on ${date}. If you want to keep it, edit it before then:`,
    draftEdit: "Edit draft:",
    untitled: "Untitled",
  },
  de: {
    subject: {
      account_blocked: "Dein Konto auf Revier wurde gesperrt",
      account_unblocked: "Dein Konto auf Revier ist wieder entsperrt",
      account_warned: "Eine Verwarnung für dein Konto auf Revier",
      report_resolved: "Deine Meldung auf Revier wurde geprüft",
      appeal_decided: "Entscheidung über deine Beschwerde auf Revier",
      draft_expiry_notice: "Dein Entwurf auf Revier wird bald gelöscht",
    },
    blocked:
      "dein Konto wurde gesperrt. Du kannst keine Anzeigen mehr veröffentlichen und keine Nachrichten schreiben. Anmelden, deine Daten herunterladen, dein Konto löschen und diese Entscheidung anfechten kannst du weiterhin.",
    unblocked: "dein Konto wurde entsperrt. Du kannst Revier wieder wie gewohnt nutzen.",
    warned: "das Team hat dein Konto verwarnt. Bitte beachte die Richtlinien für Inhalte.",
    guidelines: "Richtlinien:",
    report: (target) => `deine Meldung zu ${target} wurde geprüft.`,
    reportTitle: (title) => `Anzeige: „${title}“`,
    result: "Ergebnis:",
    reports: "Meine Meldungen:",
    appeal: {
      upheld: (action) => `deine Beschwerde gegen die Entscheidung „${action}“ wurde geprüft. Die Entscheidung bleibt bestehen.`,
      reversed: (action) => `deine Beschwerde gegen die Entscheidung „${action}“ wurde geprüft. Die Entscheidung wurde aufgehoben.`,
    },
    decisions: "Meine Entscheidungen:",
    draft: (title, date) => `dein Entwurf „${title}“ wurde lange nicht bearbeitet und wird am ${date} gelöscht. Wenn du ihn behalten möchtest, bearbeite ihn vorher:`,
    draftEdit: "Entwurf bearbeiten:",
    untitled: "Ohne Titel",
  },
  cs: {
    subject: {
      account_blocked: "Váš účet na Revier byl zablokován",
      account_unblocked: "Váš účet na Revier byl odblokován",
      account_warned: "Napomenutí pro váš účet na Revier",
      report_resolved: "Vaše nahlášení na Revier bylo prověřeno",
      appeal_decided: "Rozhodnutí o vaší stížnosti na Revier",
      draft_expiry_notice: "Váš koncept na Revier bude brzy smazán",
    },
    blocked:
      "váš účet byl zablokován. Nemůžete již zveřejňovat inzeráty ani psát zprávy. Přihlásit se, stáhnout svá data, smazat účet a ohradit se proti tomuto rozhodnutí můžete i nadále.",
    unblocked: "váš účet byl odblokován. Revier můžete opět používat jako obvykle.",
    warned: "tým vám udělil napomenutí. Dodržujte prosím pravidla obsahu.",
    guidelines: "Pravidla obsahu:",
    report: (target) => `vaše nahlášení týkající se ${target} bylo prověřeno.`,
    reportTitle: (title) => `Inzerát: „${title}“`,
    result: "Výsledek:",
    reports: "Moje nahlášení:",
    appeal: {
      upheld: (action) => `vaše stížnost proti rozhodnutí „${action}“ byla prověřena. Rozhodnutí zůstává v platnosti.`,
      reversed: (action) => `vaše stížnost proti rozhodnutí „${action}“ byla prověřena. Rozhodnutí bylo zrušeno.`,
    },
    decisions: "Moje rozhodnutí:",
    draft: (title, date) => `váš koncept „${title}“ nebyl dlouho upravován a dne ${date} bude smazán. Pokud si ho chcete ponechat, upravte ho předtím:`,
    draftEdit: "Upravit koncept:",
    untitled: "Bez názvu",
  },
  pl: {
    subject: {
      account_blocked: "Twoje konto w Revier zostało zablokowane",
      account_unblocked: "Twoje konto w Revier zostało odblokowane",
      account_warned: "Upomnienie dla Twojego konta w Revier",
      report_resolved: "Twoje zgłoszenie w Revier zostało sprawdzone",
      appeal_decided: "Decyzja w sprawie Twojej skargi w Revier",
      draft_expiry_notice: "Twój szkic w Revier zostanie wkrótce usunięty",
    },
    blocked:
      "Twoje konto zostało zablokowane. Nie możesz już publikować ogłoszeń ani pisać wiadomości. Nadal możesz się zalogować, pobrać swoje dane, usunąć konto i zakwestionować tę decyzję.",
    unblocked: "Twoje konto zostało odblokowane. Możesz znów korzystać z Revier jak zwykle.",
    warned: "zespół udzielił upomnienia dla Twojego konta. Przestrzegaj zasad dotyczących treści.",
    guidelines: "Zasady treści:",
    report: (target) => `Twoje zgłoszenie dotyczące ${target} zostało sprawdzone.`,
    reportTitle: (title) => `Ogłoszenie: „${title}”`,
    result: "Wynik:",
    reports: "Moje zgłoszenia:",
    appeal: {
      upheld: (action) => `Twoja skarga na decyzję „${action}” została rozpatrzona. Decyzja pozostaje w mocy.`,
      reversed: (action) => `Twoja skarga na decyzję „${action}” została rozpatrzona. Decyzja została uchylona.`,
    },
    decisions: "Moje decyzje:",
    draft: (title, date) => `Twój szkic „${title}” nie był długo edytowany i zostanie usunięty ${date}. Jeśli chcesz go zachować, edytuj go wcześniej:`,
    draftEdit: "Edytuj szkic:",
    untitled: "Bez tytułu",
  },
};

function composeTrustMail(lang: Language, site: string, kind: TrustKind, details: AccountDetails): { subject: string; text: string } | null {
  const a = ACCOUNT_TEXTS[lang];
  const t = TRUST_TEXTS[lang];
  const lines = [a.greeting, ""];
  const decisions = `${site}/${lang}/${ACCOUNT_DECISIONS}`;
  const note = details.reason ? clean(details.reason, 1000) : "";
  const reasonLines = () => {
    const code = label(ACCOUNT_CODES[lang], details.code);
    if (code) lines.push(`${a.reasonLabel} ${code}`);
    if (note) lines.push(`${a.reasonText} ${note}`);
    if (lines[lines.length - 1] !== "") lines.push("");
  };
  const appealLines = () => {
    const until = formatDate(details.appeal_until, lang);
    if (until) lines.push(a.appeal(until), decisions, "");
    lines.push(a.remedies, "");
  };
  switch (kind) {
    case "account_blocked":
      lines.push(t.blocked, "");
      reasonLines();
      appealLines();
      break;
    case "account_unblocked":
      lines.push(t.unblocked, "");
      if (note) lines.push(`${a.reasonText} ${note}`, "");
      break;
    case "account_warned":
      lines.push(t.warned, "");
      reasonLines();
      lines.push(t.guidelines, `${site}/${lang}/${GUIDELINES}`, "");
      appealLines();
      break;
    case "report_resolved": {
      const target = label(REPORT_TARGETS[lang], details.target_type);
      const outcome = label(REPORT_OUTCOMES[lang], details.outcome);
      if (!target || !outcome) return null;
      lines.push(t.report(target), "");
      const title = details.listing_title ? clean(details.listing_title) : "";
      if (title) lines.push(t.reportTitle(title));
      lines.push(`${t.result} ${outcome}`, "", t.reports, `${site}/${lang}/${ACCOUNT_REPORTS}`, "");
      appealLines();
      break;
    }
    case "appeal_decided": {
      const action = label(DECISION_ACTIONS[lang], details.decision_action?.replace(".", "_"));
      if (!action || (details.status !== "upheld" && details.status !== "reversed")) return null;
      lines.push(t.appeal[details.status](action), "");
      if (note) lines.push(`${a.reasonText} ${note}`, "");
      lines.push(t.decisions, decisions, "");
      if (details.status === "upheld") lines.push(a.remedies, "");
      break;
    }
    case "draft_expiry_notice": {
      const date = formatDate(details.deletes_at, lang);
      const id = details.listing_id && UUID.test(details.listing_id) ? details.listing_id : null;
      if (!date || !id) return null;
      const title = (details.listing_title ? clean(details.listing_title) : "") || t.untitled;
      lines.push(t.draft(title, date), "", t.draftEdit, `${site}/${lang}/${ACCOUNT_LISTINGS_PATH}/${id}/edit`, "");
      break;
    }
  }
  lines.push(a.footer);
  return { subject: t.subject[kind], text: lines.join("\n") };
}
