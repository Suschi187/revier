// Dienstmails aus private.account_notifications (ADR 020, Review A11) in vier Sprachen, Begriffe laut
// docs/GLOSSARY.md, Rückfall de. Nur Klartext, Betreff fest je Sprache und Art, nie Admin-Identität, interne Notizen,
// Kontaktdaten Dritter oder Dokumentinhalte. Begründungen nur bereinigt im Text.
//
// In M9b Commit 7 die Verifizierung; Sperre, Verwarnung, Meldungsergebnis, Beschwerde und Entwürfe folgen mit ihren
// Commits. Dokumenttypen und Grund-Labels sind Kopien aus web/messages (Verification.*); die Fixture
// supabase/tests/fixtures/mail_labels.json prüft beide Seiten.
import { clean, type Language } from "../_shared/mail/text.ts";

export const ACCOUNT_VERIFICATION = "account/verification";
export const ACCOUNT_DECISIONS = "account/decisions";

export type AccountKind = "verification_verified" | "verification_rejected" | "verification_revoked";
export const ACCOUNT_KINDS: readonly AccountKind[] = ["verification_verified", "verification_rejected", "verification_revoked"];

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
  subject: Record<AccountKind, string>;
  greeting: string;
  body: Record<AccountKind, (type: string) => string>;
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
