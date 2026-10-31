import { routing, type AppLocale } from "@/i18n/routing";
import { LISTING_KINDS, type ListingKind } from "@/lib/validation/listing";
import { KIND_WORDS, PAGE_WORDS, STATIC_SECTIONS } from "./sections";

// Ein Parser für alle öffentlichen URLs (ADR 015, Review B2): Proxy, Seiten, Sprachumschalter, hreflang,
// Sitemap und safeNextPath. Rein und ohne Referenzdaten, damit er auch im Browser läuft; ob ein Regions-Slug
// existiert, prüft `lib/public/regions.ts`.

export type PublicRoute =
  | { route: "home" }
  | { route: "kind"; kind: ListingKind }
  | { route: "state"; kind: ListingKind; state: string }
  | { route: "district"; kind: ListingKind; state: string; district: string }
  | { route: "search" }
  | { route: "listing"; id: string }
  | { route: "provider"; id: string };

export type ParsedPath =
  | { type: "public"; locale: AppLocale; page: PublicRoute }
  /** Statische Seite (Konto, Admin, Login, Rechtstexte …): nicht Sache des Parsers. */
  | { type: "static"; locale: AppLocale }
  /** Unter einem Sprachpräfix, aber keine bekannte Form: 404. */
  | { type: "unknown"; locale: AppLocale }
  /** Ohne gültiges Sprachpräfix: next-intl leitet um. */
  | { type: "other" };

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// Nur Kleinbuchstaben: eine UUID hat genau eine URL (Großschreibung → 404).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function kindFromWord(word: string, locale: AppLocale): ListingKind | null {
  return LISTING_KINDS.find((kind) => KIND_WORDS[kind][locale] === word) ?? null;
}

function pageFromWord(word: string, locale: AppLocale): keyof typeof PAGE_WORDS | null {
  return (Object.keys(PAGE_WORDS) as (keyof typeof PAGE_WORDS)[]).find((page) => PAGE_WORDS[page][locale] === word) ?? null;
}

function isLocale(value: string | undefined): value is AppLocale {
  return routing.locales.includes(value as AppLocale);
}

/** Zerlegt einen kanonischen Pfad (ohne Query). Ein abschließender Schrägstrich ist keine eigene Form. */
export function parsePath(pathname: string): ParsedPath {
  const segments = pathname.split("/").slice(1);
  const [first, second, ...rest] = segments;
  if (!isLocale(first)) return { type: "other" };
  const locale = first;
  if (segments.length === 1) return { type: "public", locale, page: { route: "home" } };
  if (!second) return { type: "unknown", locale };
  if ((STATIC_SECTIONS as readonly string[]).includes(second)) return { type: "static", locale };
  if (rest.some((segment) => !SLUG_RE.test(segment))) return { type: "unknown", locale };

  const kind = kindFromWord(second, locale);
  if (kind) {
    if (rest.length === 0) return { type: "public", locale, page: { route: "kind", kind } };
    if (rest.length === 1) return { type: "public", locale, page: { route: "state", kind, state: rest[0] } };
    if (rest.length === 2) return { type: "public", locale, page: { route: "district", kind, state: rest[0], district: rest[1] } };
    return { type: "unknown", locale };
  }
  const page = pageFromWord(second, locale);
  if (page === "search" && rest.length === 0) return { type: "public", locale, page: { route: "search" } };
  if ((page === "listing" || page === "provider") && rest.length === 1 && UUID_RE.test(rest[0])) {
    return { type: "public", locale, page: { route: page, id: rest[0] } };
  }
  return { type: "unknown", locale };
}

/** Pfad einer öffentlichen Seite in einer Sprache (Gegenstück zu parsePath). */
export function publicPath(page: PublicRoute, locale: AppLocale): string {
  switch (page.route) {
    case "home":
      return `/${locale}`;
    case "kind":
      return `/${locale}/${KIND_WORDS[page.kind][locale]}`;
    case "state":
      return `/${locale}/${KIND_WORDS[page.kind][locale]}/${page.state}`;
    case "district":
      return `/${locale}/${KIND_WORDS[page.kind][locale]}/${page.state}/${page.district}`;
    case "search":
      return `/${locale}/${PAGE_WORDS.search[locale]}`;
    case "listing":
    case "provider":
      return `/${locale}/${PAGE_WORDS[page.route][locale]}/${page.id}`;
  }
}

/** Gleicher Inhalt in allen Sprachen: Pfade je Sprache für hreflang, Sitemap und Sprachumschalter. */
export function publicPaths(page: PublicRoute): Record<AppLocale, string> {
  return Object.fromEntries(routing.locales.map((locale) => [locale, publicPath(page, locale)])) as Record<AppLocale, string>;
}

/** Seiten, deren Query-String sprachunabhängige Filter trägt (bleibt beim Sprachwechsel erhalten). */
export function hasFilterQuery(page: PublicRoute): boolean {
  return page.route === "kind" || page.route === "state" || page.route === "district" || page.route === "search";
}
