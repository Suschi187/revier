import type { AppLocale } from "@/i18n/routing";
import type { ListingKind } from "@/lib/validation/listing";

// URL-Wörter je Sprache (ADR 015, Glossar „URL-Wörter“, cs/pl ungeprüft). Teil des URL-Vertrags:
// Änderungen brauchen Redirects. Nur Kleinbuchstaben, Ziffern und Bindestriche.

export const KIND_WORDS: Record<ListingKind, Record<AppLocale, string>> = {
  lease: { de: "jagdpacht", en: "hunting-lease", cs: "pronajem-honitby", pl: "dzierzawa-obwodu" },
  permit: { de: "begehungsschein", en: "hunting-permit", cs: "povolenka-k-lovu", pl: "zezwolenie-na-polowanie" },
  driven_hunt: { de: "gesellschaftsjagd", en: "driven-hunt", cs: "spolecny-hon", pl: "polowanie-zbiorowe" },
  trophy_hunt: { de: "trophaeenjagd", en: "trophy-hunt", cs: "trofejovy-lov", pl: "polowanie-trofeowe" },
  helper: { de: "jagdhelfer", en: "hunting-helper", cs: "pomocnik-pri-lovu", pl: "pomocnik-mysliwego" },
};

export const PAGE_WORDS = {
  search: { de: "suche", en: "search", cs: "hledani", pl: "szukaj" },
  listing: { de: "anzeige", en: "listing", cs: "inzerat", pl: "ogloszenie" },
  provider: { de: "anbieter", en: "provider", cs: "inzerent", pl: "oglaszajacy" },
} as const satisfies Record<string, Record<AppLocale, string>>;

export type PageWord = keyof typeof PAGE_WORDS;

/**
 * Statische Ordner unter app/[locale] (gehen in Next vor). Der Proxy lässt sie unberührt; ein Vitest gleicht
 * die Liste mit dem Dateisystem ab, damit kein URL-Wort mit einer neuen Seite kollidiert.
 */
export const STATIC_SECTIONS = [
  "account",
  "admin",
  "auth",
  "forbidden",
  "imprint",
  "login",
  "missing",
  "privacy",
  "terms",
  "welcome",
] as const;

/**
 * Gültige Pfade je statischem Bereich (QA M5 F8, N3), `:id` steht für eine UUID; "" ist der Bereich selbst. Alles
 * andere ergibt 404 aus dem Proxy: Unter cacheComponents setzt Next den Status nach dem Streaming-Start nicht
 * mehr, im Produktions-Build käme sonst 200 mit der 404-Seite. Ein Vitest gleicht mit den page.tsx/route.ts ab.
 */
export const STATIC_ROUTES: Record<(typeof STATIC_SECTIONS)[number], readonly string[]> = {
  account: ["", "favorites", "listings", "listings/new", "listings/:id/edit", "profile"],
  admin: ["", "admins", "audit", "listings", "listings/:id", "mfa"],
  auth: ["apple", "callback", "confirm"],
  forbidden: [""],
  imprint: [""],
  login: [""],
  missing: [""],
  privacy: [""],
  terms: [""],
  welcome: [""],
};

/** Ziel des Proxy-Rewrites für 404; direkt aufgerufen ergibt es ebenfalls 404. */
export const STATUS_SECTIONS = ["missing"] as const;
