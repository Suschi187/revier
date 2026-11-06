// Mailtexte in vier Sprachen (ADR 017, ADR 018): Begriffe laut docs/GLOSSARY.md, Rückfall de. Bewusst ohne
// Nachrichtentext (kann Kontaktdaten oder Lageangaben enthalten) und ohne Tracking. Nur Klartext.
import { unsubscribePageUrl } from "../_shared/mail/site.ts";
import { clean, type Language } from "../_shared/mail/text.ts";

export { language, type Language } from "../_shared/mail/text.ts";

type Texts = {
  subject: string;
  greeting: string;
  intro: string;
  item: (sender: string, listing: string | null) => string;
  unknownSender: string;
  open: string;
  settings: string;
  unsubscribe: string;
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
    unsubscribe: "Nur die Benachrichtigungen zu Nachrichten abbestellen:",
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
    unsubscribe: "Unsubscribe from message notifications only:",
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
    unsubscribe: "Odhlásit odběr pouze upozornění na zprávy:",
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
    unsubscribe: "Wypisz się tylko z powiadomień o wiadomościach:",
    footer: "Ta wiadomość została wysłana automatycznie. Odpowiedzi na tego e-maila nie są dostarczane.",
  },
};

export type Conversation = { conversation_id: string; sender_name: string | null; listing_title: string | null };

/** Klartext mit Link auf die Bestätigungsseite fürs Abbestellen (B4); wirft bei ungültigem Token. */
export function composeMail(
  lang: Language,
  siteUrl: string,
  conversations: Conversation[],
  token: string,
): { subject: string; text: string } {
  const t = TEXTS[lang];
  const lines = [t.greeting, "", t.intro, ""];
  for (const c of conversations) {
    const sender = c.sender_name ? clean(c.sender_name) : t.unknownSender;
    lines.push(`- ${t.item(sender, c.listing_title ? clean(c.listing_title) : null)}`);
    lines.push(`  ${t.open} ${siteUrl}/${lang}/account/messages/${c.conversation_id}`);
  }
  lines.push("", t.settings, `${siteUrl}/${lang}/account/profile`, "", t.unsubscribe, unsubscribePageUrl(siteUrl, lang, token));
  lines.push("", t.footer);
  return { subject: t.subject, text: lines.join("\n") };
}
