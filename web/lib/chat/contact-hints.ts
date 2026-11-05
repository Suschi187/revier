// Hinweise vor dem Senden (ADR 017, SPEC 7.8): Kontaktdaten sind erlaubt, der Chat warnt nur. Muster bewusst
// einfach; Fälle in supabase/tests/fixtures/chat_rules.json („hints“, auch für iOS). Läuft nur im Browser.

const EMAIL = /[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}/i;
const IBAN = /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,3})?\b/i;
// Mindestens 7 Ziffern, getrennt höchstens durch Leerzeichen, Bindestrich, Schrägstrich, Klammern oder Punkt.
const PHONE = /(?:\+|\b00)?\(?\d[\d\s\-/().]{5,}\d/g;
const DECIMAL_COORDS = /-?\d{1,2}[.,]\d{3,}\s*[,;]\s*-?\d{1,3}[.,]\d{3,}/;
const DMS_COORDS = /\d{1,3}\s*°\s*\d{1,2}\s*['′]/;
const MAP_LINK = /(google\.[a-z.]+\/maps|maps\.app\.goo\.gl|goo\.gl\/maps|openstreetmap\.org|osm\.org|maps\.apple\.com|what3words\.com|w3w\.co)/i;

function hasPhone(text: string): boolean {
  for (const match of text.matchAll(PHONE)) {
    const digits = match[0].replace(/\D/g, "");
    // Datumsangaben und Preise haben Punkte zwischen kurzen Gruppen; Telefonnummern mindestens 7 Ziffern.
    if (digits.length >= 7 && digits.length <= 15 && !/^\d{1,2}\.\d{1,2}\.\d{2,4}$/.test(match[0].trim())) return true;
  }
  return false;
}

export type ContactHints = { contact: boolean; location: boolean };

export function contactHints(text: string): ContactHints {
  const location = DECIMAL_COORDS.test(text) || DMS_COORDS.test(text) || MAP_LINK.test(text);
  // Koordinaten und Links (Kartenlinks enthalten Zahlen mit Schrägstrichen) zählen nicht als Telefonnummer.
  const rest = text.replace(/https?:\/\/\S+/gi, " ").replace(new RegExp(DECIMAL_COORDS.source, "g"), " ");
  const contact = EMAIL.test(text) || IBAN.test(text) || hasPhone(rest);
  return { contact, location };
}
