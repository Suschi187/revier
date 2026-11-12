// Mailtexte für Suchaufträge und Moderationsentscheidungen in vier Sprachen (ADR 018, Review A5, A8, A13). Begriffe
// laut docs/GLOSSARY.md, Rückfall de. Nur Klartext, Betreff fest je Sprache (bei Moderation je Entscheidung), keine
// Tracking-Pixel, keine Redirect-Links, nie Koordinaten, Kontaktdaten oder Anbieter. Nutzerinhalte (Titel, Namen,
// Begründung) nur bereinigt im Text.
//
// URL-Wörter, Preiseinheiten, „Auf Anfrage“ und die Labels der Ablehnungsgründe sind Kopien aus dem Web
// (web/lib/public/sections.ts, web/messages/*.json). Keine stille Kopie: die Fixtures in supabase/tests/fixtures/
// (mail_links.json, mail_labels.json, price_format.json) prüfen beide Seiten.
import { unsubscribePageUrl } from "../_shared/mail/site.ts";
import { clean, type Language } from "../_shared/mail/text.ts";
import { ACCOUNT_DECISIONS, ACCOUNT_TEXTS } from "./account_texts.ts";

export { language, type Language } from "../_shared/mail/text.ts";

// ---------------------------------------------------------------------------------------------------------------
// Aus dem Web übernommen (Fixtures)
// ---------------------------------------------------------------------------------------------------------------

/** PAGE_WORDS.listing aus web/lib/public/sections.ts. */
export const LISTING_WORD: Record<Language, string> = { de: "anzeige", en: "listing", cs: "inzerat", pl: "ogloszenie" };

export type Currency = "EUR" | "CHF" | "CZK" | "PLN";
export type PriceUnit = "total" | "per_year" | "per_hectare_year" | "per_day" | "per_animal" | "on_request";

/** Listings.priceUnits und Listings.preview.onRequest aus web/messages. */
export const PRICE_UNITS: Record<Language, Record<Exclude<PriceUnit, "on_request">, string>> = {
  en: { total: "total", per_year: "per year", per_hectare_year: "per hectare and year", per_day: "per day", per_animal: "per animal" },
  de: { total: "gesamt", per_year: "pro Jahr", per_hectare_year: "pro Hektar und Jahr", per_day: "pro Tag", per_animal: "pro Stück Wild" },
  cs: { total: "celkem", per_year: "za rok", per_hectare_year: "za hektar a rok", per_day: "za den", per_animal: "za kus zvěře" },
  pl: {
    total: "łącznie",
    per_year: "za rok",
    per_hectare_year: "za hektar rocznie",
    per_day: "za dzień",
    per_animal: "za sztukę zwierzyny",
  },
};

export const ON_REQUEST: Record<Language, string> = { en: "On request", de: "Auf Anfrage", cs: "Na dotaz", pl: "Na zapytanie" };

export type RejectCode =
  | "incomplete"
  | "wrong_category"
  | "weapons"
  | "prohibited_content"
  | "duplicate"
  | "contact_in_text"
  | "implausible"
  | "other";

/** Moderation.reasons aus web/messages (Codes laut Check in 20261030110000_moderation_fields.sql). */
export const REJECT_REASONS: Record<Language, Record<RejectCode, string>> = {
  en: {
    incomplete: "Information incomplete",
    wrong_category: "Wrong category",
    weapons: "Weapons or ammunition offered",
    prohibited_content: "Prohibited content",
    duplicate: "Duplicate listing",
    contact_in_text: "Contact details in the text",
    implausible: "Implausible information",
    other: "Other reason",
  },
  de: {
    incomplete: "Angaben unvollständig",
    wrong_category: "Falsche Kategorie",
    weapons: "Waffen oder Munition angeboten",
    prohibited_content: "Unzulässige Inhalte",
    duplicate: "Doppelte Anzeige",
    contact_in_text: "Kontaktdaten im Text",
    implausible: "Unplausible Angaben",
    other: "Anderer Grund",
  },
  cs: {
    incomplete: "Neúplné údaje",
    wrong_category: "Nesprávná kategorie",
    weapons: "Nabídka zbraní nebo střeliva",
    prohibited_content: "Nepovolený obsah",
    duplicate: "Duplicitní inzerát",
    contact_in_text: "Kontaktní údaje v textu",
    implausible: "Nevěrohodné údaje",
    other: "Jiný důvod",
  },
  pl: {
    incomplete: "Niekompletne informacje",
    wrong_category: "Niewłaściwa kategoria",
    weapons: "Oferowanie broni lub amunicji",
    prohibited_content: "Niedozwolone treści",
    duplicate: "Zduplikowane ogłoszenie",
    contact_in_text: "Dane kontaktowe w treści",
    implausible: "Niewiarygodne informacje",
    other: "Inny powód",
  },
};

// ---------------------------------------------------------------------------------------------------------------
// Preise und Links
// ---------------------------------------------------------------------------------------------------------------

const CURRENCIES: readonly string[] = ["EUR", "CHF", "CZK", "PLN"];

/**
 * Wie formatPrice in web/lib/validation/price.ts (2 Nachkommastellen, nur bei Cent-Betrag angezeigt), aber ohne
 * Gleitkomma: Intl bekommt den Betrag als Dezimal-String aus ganzzahliger Rechnung.
 */
export function formatPrice(minor: number, currency: Currency, lang: Language): string {
  const cents = minor % 100;
  const amount = `${(minor - cents) / 100}.${String(cents).padStart(2, "0")}`;
  const format = new Intl.NumberFormat(lang, { style: "currency", currency, minimumFractionDigits: cents ? 2 : 0 });
  // Intl.NumberFormat nimmt Dezimal-Strings exakt an (ECMA-402, StringNumericLiteral).
  return format.format(amount as Intl.StringNumericLiteral);
}

/** Wie priceText in web/lib/public/format.ts: „5.000 € pro Jahr“, „Auf Anfrage“ oder null ohne Preisangabe. */
export function priceText(
  priceMinor: number | null,
  currency: string | null,
  unit: string | null,
  lang: Language,
): string | null {
  if (unit === "on_request") return ON_REQUEST[lang];
  if (priceMinor === null || !Number.isSafeInteger(priceMinor) || priceMinor < 0) return null;
  if (!currency || !CURRENCIES.includes(currency) || !unit || !Object.hasOwn(PRICE_UNITS[lang], unit)) return null;
  return `${formatPrice(priceMinor, currency as Currency, lang)} ${PRICE_UNITS[lang][unit as Exclude<PriceUnit, "on_request">]}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Detailseite wie publicPath({ route: "listing", id }) im Web; null bei einer ungültigen ID (dann kein Link). */
export function listingUrl(site: string, lang: Language, id: string): string | null {
  return UUID.test(id) ? `${site}/${lang}/${LISTING_WORD[lang]}/${id}` : null;
}

export const ACCOUNT_SEARCHES = "account/searches";
export const ACCOUNT_LISTINGS = "account/listings";
export const IMPRINT = "imprint";

function formatDate(iso: string, lang: Language): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(lang, { dateStyle: "long", timeZone: "Europe/Berlin" }).format(date);
}

// ---------------------------------------------------------------------------------------------------------------
// Suchauftrags-Mail
// ---------------------------------------------------------------------------------------------------------------

export type SearchItem = {
  listing_id: string;
  title: string | null;
  kind: string | null;
  direction: string | null;
  district_code: string | null;
  district_name: string | null;
  state_code: string | null;
  state_name: string | null;
  price_minor: number | null;
  currency: string | null;
  price_unit: string | null;
};

export type SearchInfo = { id: string; name: string | null; expires_at: string | null; extendable: boolean | null };

type SearchTexts = {
  subject: string;
  greeting: string;
  intro: string;
  untitled: string;
  region: string;
  price: string;
  open: string;
  matches: string;
  unnamed: string;
  expires: (date: string) => string;
  manage: string;
  unsubscribe: string;
  footer: string;
};

export const SEARCH_TEXTS: Record<Language, SearchTexts> = {
  en: {
    subject: "New listings for your saved searches on Revier",
    greeting: "Hello,",
    intro: "new listings match your saved searches:",
    untitled: "Listing",
    region: "Region",
    price: "Price",
    open: "View:",
    matches: "Matching saved searches:",
    unnamed: "Saved search",
    expires: (date) => `ends on ${date}, extend it now:`,
    manage: "Manage your saved searches:",
    unsubscribe: "Stop emails for these saved searches:",
    footer: "This message was sent automatically. Replies to this email are not delivered.",
  },
  de: {
    subject: "Neue Anzeigen zu deinen Suchaufträgen auf Revier",
    greeting: "Hallo,",
    intro: "zu deinen Suchaufträgen gibt es neue Anzeigen:",
    untitled: "Anzeige",
    region: "Region",
    price: "Preis",
    open: "Ansehen:",
    matches: "Passende Suchaufträge:",
    unnamed: "Suchauftrag",
    expires: (date) => `läuft am ${date} ab, jetzt verlängern:`,
    manage: "Suchaufträge verwalten:",
    unsubscribe: "E-Mails zu diesen Suchaufträgen abbestellen:",
    footer: "Diese Nachricht wurde automatisch versendet. Antworten auf diese E-Mail kommen nicht an.",
  },
  cs: {
    subject: "Nové inzeráty k vašim uloženým hledáním na Revier",
    greeting: "Dobrý den,",
    intro: "k vašim uloženým hledáním jsou nové inzeráty:",
    untitled: "Inzerát",
    region: "Region",
    price: "Cena",
    open: "Zobrazit:",
    matches: "Odpovídající uložená hledání:",
    unnamed: "Uložené hledání",
    expires: (date) => `platí do ${date}, prodlužte ho nyní:`,
    manage: "Spravovat uložená hledání:",
    unsubscribe: "Odhlásit odběr e-mailů k těmto uloženým hledáním:",
    footer: "Tato zpráva byla odeslána automaticky. Odpovědi na tento e-mail nebudou doručeny.",
  },
  pl: {
    subject: "Nowe ogłoszenia dla Twoich zapisanych wyszukiwań w Revier",
    greeting: "Dzień dobry,",
    intro: "pojawiły się nowe ogłoszenia pasujące do Twoich zapisanych wyszukiwań:",
    untitled: "Ogłoszenie",
    region: "Region",
    price: "Cena",
    open: "Zobacz:",
    matches: "Pasujące zapisane wyszukiwania:",
    unnamed: "Zapisane wyszukiwanie",
    expires: (date) => `wygasa ${date}, przedłuż je teraz:`,
    manage: "Zarządzaj zapisanymi wyszukiwaniami:",
    unsubscribe: "Wypisz się z e-maili dla tych zapisanych wyszukiwań:",
    footer: "Ta wiadomość została wysłana automatycznie. Odpowiedzi na tego e-maila nie są dostarczane.",
  },
};

/** Suchauftrags-Mail (A5): je Anzeige Titel, Region, Preis, Link; dann die Aufträge, Verwalten und Abbestellen. */
export function composeSearchMail(
  lang: Language,
  site: string,
  items: SearchItem[],
  searches: SearchInfo[],
  token: string,
): { subject: string; text: string } {
  const t = SEARCH_TEXTS[lang];
  const manage = `${site}/${lang}/${ACCOUNT_SEARCHES}`;
  const lines = [t.greeting, "", t.intro, ""];
  for (const item of items) {
    const url = listingUrl(site, lang, item.listing_id);
    if (!url) continue;
    const title = item.title ? clean(item.title) : "";
    lines.push(`- ${title || t.untitled}`);
    const region = [item.district_name, item.state_name].filter((v): v is string => !!v).map((v) => clean(v)).join(", ");
    if (region) lines.push(`  ${t.region}: ${region}`);
    const price = priceText(item.price_minor, item.currency, item.price_unit, lang);
    if (price) lines.push(`  ${t.price}: ${price}`);
    lines.push(`  ${t.open} ${url}`, "");
  }
  if (searches.length) {
    lines.push(t.matches);
    for (const search of searches) {
      const name = search.name ? clean(search.name) : "";
      lines.push(`- ${name || t.unnamed}`);
      const date = search.extendable && search.expires_at ? formatDate(search.expires_at, lang) : null;
      if (date) lines.push(`  ${t.expires(date)} ${manage}`);
    }
    lines.push("");
  }
  lines.push(t.manage, manage, "", t.unsubscribe, unsubscribePageUrl(site, lang, token), "", t.footer);
  return { subject: t.subject, text: lines.join("\n") };
}

// ---------------------------------------------------------------------------------------------------------------
// Moderations-Mail (Dienstmail ohne Abbestellen, A8)
// ---------------------------------------------------------------------------------------------------------------

export type Decision = "approved" | "changes_requested" | "rejected" | "removed";

export const DECISIONS: readonly Decision[] = ["approved", "changes_requested", "rejected", "removed"];

export function isDecision(value: unknown): value is Decision {
  return typeof value === "string" && (DECISIONS as readonly string[]).includes(value);
}

type ModerationTexts = {
  subject: Record<Decision, string>;
  greeting: string;
  decision: Record<Decision, (title: string) => string>;
  untitled: string;
  reasonLabel: string;
  reasonText: string;
  view: string;
  dashboard: string;
  footer: string;
};

export const MODERATION_TEXTS: Record<Language, ModerationTexts> = {
  en: {
    subject: {
      approved: "Your listing on Revier has been approved",
      changes_requested: "Changes requested for your listing on Revier",
      rejected: "Your listing on Revier has been rejected",
      removed: "Your listing on Revier has been removed",
    },
    greeting: "Hello,",
    decision: {
      approved: (title) => `your listing “${title}” has been approved by moderation.`,
      changes_requested: (title) => `moderation has asked for changes to your listing “${title}”. It is a draft again.`,
      rejected: (title) => `your listing “${title}” has been rejected by moderation.`,
      removed: (title) => `your listing “${title}” has been removed by moderation and is no longer public.`,
    },
    untitled: "Untitled",
    reasonLabel: "Reason:",
    reasonText: "Note from moderation:",
    view: "View listing:",
    dashboard: "Your listings:",
    footer: "This message was sent automatically. Replies to this email are not delivered.",
  },
  de: {
    subject: {
      approved: "Deine Anzeige auf Revier ist freigegeben",
      changes_requested: "Änderungen an deiner Anzeige auf Revier angefragt",
      rejected: "Deine Anzeige auf Revier wurde abgelehnt",
      removed: "Deine Anzeige auf Revier wurde entfernt",
    },
    greeting: "Hallo,",
    decision: {
      approved: (title) => `deine Anzeige „${title}“ wurde von der Moderation freigegeben.`,
      changes_requested: (title) => `die Moderation bittet um Änderungen an deiner Anzeige „${title}“. Sie ist wieder ein Entwurf.`,
      rejected: (title) => `deine Anzeige „${title}“ wurde von der Moderation abgelehnt.`,
      removed: (title) => `deine Anzeige „${title}“ wurde von der Moderation entfernt und ist nicht mehr öffentlich.`,
    },
    untitled: "Ohne Titel",
    reasonLabel: "Grund:",
    reasonText: "Hinweis der Moderation:",
    view: "Zur Anzeige:",
    dashboard: "Meine Anzeigen:",
    footer: "Diese Nachricht wurde automatisch versendet. Antworten auf diese E-Mail kommen nicht an.",
  },
  cs: {
    subject: {
      approved: "Váš inzerát na Revier byl schválen",
      changes_requested: "K vašemu inzerátu na Revier jsou požadovány úpravy",
      rejected: "Váš inzerát na Revier byl zamítnut",
      removed: "Váš inzerát na Revier byl odstraněn",
    },
    greeting: "Dobrý den,",
    decision: {
      approved: (title) => `váš inzerát „${title}“ byl schválen moderací.`,
      changes_requested: (title) => `moderace žádá o úpravy vašeho inzerátu „${title}“. Inzerát je opět konceptem.`,
      rejected: (title) => `váš inzerát „${title}“ byl moderací zamítnut.`,
      removed: (title) => `váš inzerát „${title}“ byl moderací odstraněn a již není veřejný.`,
    },
    untitled: "Bez názvu",
    reasonLabel: "Důvod:",
    reasonText: "Poznámka moderace:",
    view: "Zobrazit inzerát:",
    dashboard: "Moje inzeráty:",
    footer: "Tato zpráva byla odeslána automaticky. Odpovědi na tento e-mail nebudou doručeny.",
  },
  pl: {
    subject: {
      approved: "Twoje ogłoszenie w Revier zostało zatwierdzone",
      changes_requested: "Prośba o poprawki w Twoim ogłoszeniu w Revier",
      rejected: "Twoje ogłoszenie w Revier zostało odrzucone",
      removed: "Twoje ogłoszenie w Revier zostało usunięte",
    },
    greeting: "Dzień dobry,",
    decision: {
      approved: (title) => `Twoje ogłoszenie „${title}” zostało zatwierdzone przez moderację.`,
      changes_requested: (title) => `moderacja prosi o poprawki w Twoim ogłoszeniu „${title}”. Jest ono ponownie szkicem.`,
      rejected: (title) => `Twoje ogłoszenie „${title}” zostało odrzucone przez moderację.`,
      removed: (title) => `Twoje ogłoszenie „${title}” zostało usunięte przez moderację i nie jest już publiczne.`,
    },
    untitled: "Bez tytułu",
    reasonLabel: "Powód:",
    reasonText: "Uwaga moderacji:",
    view: "Zobacz ogłoszenie:",
    dashboard: "Moje ogłoszenia:",
    footer: "Ta wiadomość została wysłana automatycznie. Odpowiedzi na tego e-maila nie są dostarczane.",
  },
};

export type ModerationClaim = {
  decision: Decision;
  reject_code: string | null;
  reason: string | null;
  listing_id: string;
  title: string | null;
  appeal_until?: string | null;
};

/** Moderations-Mail: Freigabe ohne Begründungsteil; sonst Grund-Label, Begründung bereinigt, Frist zum Anfechten. */
export function composeModerationMail(lang: Language, site: string, claim: ModerationClaim): { subject: string; text: string } {
  const t = MODERATION_TEXTS[lang];
  const title = (claim.title ? clean(claim.title) : "") || t.untitled;
  const lines = [t.greeting, "", t.decision[claim.decision](title), ""];
  if (claim.decision === "approved") {
    const url = listingUrl(site, lang, claim.listing_id);
    if (url) lines.push(t.view, url, "");
  } else {
    const codes = REJECT_REASONS[lang];
    if (claim.reject_code && Object.hasOwn(codes, claim.reject_code)) {
      lines.push(`${t.reasonLabel} ${codes[claim.reject_code as RejectCode]}`);
    }
    const reason = claim.reason ? clean(claim.reason, 1000) : "";
    if (reason) lines.push(`${t.reasonText} ${reason}`);
    if (lines[lines.length - 1] !== "") lines.push("");
  }
  lines.push(t.dashboard, `${site}/${lang}/${ACCOUNT_LISTINGS}`, "");
  // Begründung und Rechtsbehelf (DSA Art. 17, 20; ADR 020): Frist zum Anfechten mit Link, Hinweis auf
  // Streitbeilegung als markierter Platzhalter. Ersetzt den Kontakt-Platzhalter aus M8.
  if (claim.decision !== "approved") {
    const until = formatDate(claim.appeal_until ?? "", lang);
    if (until) lines.push(ACCOUNT_TEXTS[lang].appeal(until), `${site}/${lang}/${ACCOUNT_DECISIONS}`, "");
    lines.push(ACCOUNT_TEXTS[lang].remedies, "");
  }
  lines.push(t.footer);
  return { subject: t.subject[claim.decision], text: lines.join("\n") };
}
