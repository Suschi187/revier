import { describe, expect, it } from "vitest";
import links from "../../../supabase/tests/fixtures/mail_links.json";
import labels from "../../../supabase/tests/fixtures/mail_labels.json";
import prices from "../../../supabase/tests/fixtures/price_format.json";
import cs from "../../messages/cs.json";
import de from "../../messages/de.json";
import en from "../../messages/en.json";
import pl from "../../messages/pl.json";
import type { AppLocale } from "@/i18n/routing";
import type { Currency } from "@/lib/validation/price";
import { priceText } from "./format";
import { parsePath, publicPath } from "./paths";

// Mails der Edge Functions (ADR 018, Review A13): Links, Preisformat und Labels der Function stimmen mit dem Web
// überein. Die Function prüft dieselben Fixtures in Deno (send-search-notifications/tests/texts_test.ts).

const MESSAGES = { en, de, cs, pl } as const;

function listingsT(locale: AppLocale) {
  const listings = MESSAGES[locale].Listings as unknown as Record<string, Record<string, string>>;
  return (key: string) => {
    const [group, name] = key.split(".");
    return listings[group][name];
  };
}

describe("Mail-Links = Web-Routen", () => {
  it.each(links.listing)("Detailseite $lang", ({ lang, path }) => {
    const locale = lang as AppLocale;
    expect(publicPath({ route: "listing", id: links.listing_id }, locale)).toBe(path);
    expect(parsePath(path)).toEqual({ type: "public", locale, page: { route: "listing", id: links.listing_id } });
  });

  it("Abbestell-Seite und Konto-Seite der Suchaufträge sind Web-Routen (M8)", () => {
    expect(links.static_paths).toEqual(expect.arrayContaining(["account/searches", "unsubscribe"]));
  });

  it.each(links.static_paths)("statische Seite %s in allen Sprachen", (pattern) => {
    for (const locale of ["en", "de", "cs", "pl"] as const) {
      const path = `/${locale}/${pattern.replace(":id", links.listing_id)}`;
      expect(parsePath(path)).toEqual({ type: "static", locale });
    }
  });

  // In Mails verlinkt, im Web noch nicht vorhanden (seit M8 Commit 7 leer); kommen sie ins Web, nach static_paths verschieben.
  it.each(links.pending_static_paths as string[])("vorgemerkt: %s ist noch keine Web-Route", (pattern) => {
    expect(parsePath(`/de/${pattern}`).type).toBe("unknown");
  });
});

describe("Preisformat der Mails = Web", () => {
  it.each(prices.cases)("$name", (c) => {
    const locale = c.lang as AppLocale;
    const actual = priceText(
      { priceMinor: c.price_minor, currency: c.currency as Currency | null, priceUnit: c.price_unit },
      locale,
      listingsT(locale),
    );
    expect(actual).toBe(c.expected);
  });
});

describe("Labels der Mails = Web-Messages", () => {
  it.each(["en", "de", "cs", "pl"] as const)("%s", (locale) => {
    const messages = MESSAGES[locale];
    expect(labels.on_request[locale]).toBe(messages.Listings.preview.onRequest);
    expect(labels.price_units[locale]).toEqual(messages.Listings.priceUnits);
    expect(labels.reject_reasons[locale]).toEqual(messages.Moderation.reasons);
  });
});
