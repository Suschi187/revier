import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import GlobalError from "@/app/global-error";
import LocaleError from "@/app/[locale]/error";
import { routing } from "@/i18n/routing";
import cs from "@/messages/cs.json";
import de from "@/messages/de.json";
import en from "@/messages/en.json";
import pl from "@/messages/pl.json";
import { GLOBAL_ERROR_TEXTS } from "./global-error-texts";
import { LAYOUT_CLIENT_NAMESPACES, pickMessages, type Messages } from "./pick";

const messages = { de, en, cs, pl } as const;
const error = Object.assign(new Error("geheim: SELECT * FROM auth.users"), { digest: "4711" });

describe("Fehlerseiten (M10)", () => {
  it("Spiegel der globalen Fehlerseite stimmt mit den Message-Dateien überein", () => {
    for (const locale of routing.locales) {
      expect(GLOBAL_ERROR_TEXTS[locale]).toEqual({ ...messages[locale].ServerError, backHome: messages[locale].NotFound.backHome });
    }
  });

  it("globale Fehlerseite: alle Sprachen, Fehlernummer, keine Fehlermeldung", () => {
    const html = renderToStaticMarkup(createElement(GlobalError, { error, retry: () => {} }));
    expect(html).toMatch(/^<html lang="de"/);
    for (const locale of routing.locales) {
      expect(html).toContain(`lang="${locale}"`);
      expect(html).toContain(GLOBAL_ERROR_TEXTS[locale].title);
    }
    expect(html).toContain("Fehlernummer: 4711");
    expect(html).not.toContain("geheim");
  });

  it("Fehlerseite unter [locale] mit den Texten aus dem Layout, ohne Fehlermeldung", () => {
    for (const locale of routing.locales) {
      const html = renderToStaticMarkup(
        createElement(
          NextIntlClientProvider,
          // Kinder als drittes Argument (react/no-children-prop); der Typ verlangt sie trotzdem in den Props.
          { locale, messages: pickMessages(messages[locale] as Messages, LAYOUT_CLIENT_NAMESPACES) } as ComponentProps<typeof NextIntlClientProvider>,
          createElement(LocaleError, { error, retry: () => {} }),
        ),
      );
      expect(html).toContain(messages[locale].ServerError.title);
      expect(html).toContain(messages[locale].ServerError.digest.replace("{digest}", "4711"));
      expect(html).toContain(messages[locale].NotFound.backHome);
      expect(html).not.toContain("geheim");
    }
  });
});
