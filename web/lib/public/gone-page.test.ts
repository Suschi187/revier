import { describe, expect, it } from "vitest";
import { routing } from "@/i18n/routing";
import { goneHtml } from "./gone-page";

describe("410-Seite des Proxys (ADR 015)", () => {
  it.each(routing.locales)("%s: lokalisiert, noindex, Wege zu Suche, Impressum und Datenschutz, ohne Skript", (locale) => {
    const html = goneHtml(locale);
    expect(html).toContain(`<html lang="${locale}">`);
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).toContain(`href="/${locale}/imprint"`);
    expect(html).toContain(`href="/${locale}/privacy"`);
    expect(html).toMatch(new RegExp(`href="/${locale}/[a-z]+"`));
    expect(html).not.toMatch(/<script/i);
  });
});
