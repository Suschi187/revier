// Mailtexte in vier Sprachen (ADR 017): Begriffe laut docs/GLOSSARY.md, Rückfall de. Bewusst ohne Nachrichtentext
// (kann Kontaktdaten oder Lageangaben enthalten) und ohne Tracking. Nur Klartext.

export type Language = "de" | "en" | "cs" | "pl";

type Texts = {
  subject: string;
  greeting: string;
  intro: string;
  item: (sender: string, listing: string | null) => string;
  unknownSender: string;
  open: string;
  settings: string;
  footer: string;
};

export const TEXTS: Record<Language, Texts> = {
  de: {
    subject: "Neue Nachrichten auf Revier",
    greeting: "Hallo,",
    intro: "du hast neue Nachrichten:",
    item: (sender, listing) => (listing ? `${sender} zu „${listing}“` : sender),
    unknownSender: "Ein Konto, das nicht mehr verfügbar ist",
    open: "Zur Unterhaltung:",
    settings: "Benachrichtigungen per E-Mail kannst du in deinem Profil abbestellen:",
    footer: "Diese Nachricht wurde automatisch versendet. Antworten auf diese E-Mail kommen nicht an.",
  },
  en: {
    subject: "New messages on Revier",
    greeting: "Hello,",
    intro: "you have new messages:",
    item: (sender, listing) => (listing ? `${sender} about “${listing}”` : sender),
    unknownSender: "An account that is no longer available",
    open: "Open the conversation:",
    settings: "You can turn off email notifications in your profile:",
    footer: "This message was sent automatically. Replies to this email are not delivered.",
  },
  cs: {
    subject: "Nové zprávy na Revier",
    greeting: "Dobrý den,",
    intro: "máte nové zprávy:",
    item: (sender, listing) => (listing ? `${sender} k inzerátu „${listing}“` : sender),
    unknownSender: "Účet, který již není k dispozici",
    open: "Otevřít konverzaci:",
    settings: "Upozornění e-mailem můžete vypnout ve svém profilu:",
    footer: "Tato zpráva byla odeslána automaticky. Odpovědi na tento e-mail nebudou doručeny.",
  },
  pl: {
    subject: "Nowe wiadomości w Revier",
    greeting: "Dzień dobry,",
    intro: "masz nowe wiadomości:",
    item: (sender, listing) => (listing ? `${sender} w sprawie „${listing}”` : sender),
    unknownSender: "Konto, które nie jest już dostępne",
    open: "Otwórz rozmowę:",
    settings: "Powiadomienia e-mail możesz wyłączyć w swoim profilu:",
    footer: "Ta wiadomość została wysłana automatycznie. Odpowiedzi na tego e-maila nie są dostarczane.",
  },
};

export function language(value: unknown): Language {
  return value === "en" || value === "cs" || value === "pl" ? value : "de";
}

export type Conversation = { conversation_id: string; sender_name: string | null; listing_title: string | null };

/** Steuerzeichen aus Nutzerinhalten entfernen (Klartext-Mail, keine Header). */
function clean(value: string): string {
  // Steuerzeichen sind hier genau das Ziel der Regel (Zeilenumbrüche, Bidi), kein Versehen.
  // deno-lint-ignore no-control-regex
  return value.replace(/[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g, " ").trim().slice(0, 120);
}

export function composeMail(lang: Language, siteUrl: string, conversations: Conversation[]): { subject: string; text: string } {
  const t = TEXTS[lang];
  const lines = [t.greeting, "", t.intro, ""];
  for (const c of conversations) {
    const sender = c.sender_name ? clean(c.sender_name) : t.unknownSender;
    lines.push(`- ${t.item(sender, c.listing_title ? clean(c.listing_title) : null)}`);
    lines.push(`  ${t.open} ${siteUrl}/${lang}/account/messages/${c.conversation_id}`);
  }
  lines.push("", t.settings, `${siteUrl}/${lang}/account/profile`, "", t.footer);
  return { subject: t.subject, text: lines.join("\n") };
}
