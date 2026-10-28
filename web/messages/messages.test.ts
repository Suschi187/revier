import { describe, expect, it } from "vitest";
import { routing, type AppLocale } from "@/i18n/routing";
import cs from "./cs.json";
import de from "./de.json";
import en from "./en.json";
import pl from "./pl.json";

const messages: Record<AppLocale, object> = { de, en, cs, pl };

function flatEntries(obj: object, prefix = ""): [string, unknown][] {
  return Object.entries(obj).flatMap(([key, value]) =>
    typeof value === "object" && value !== null
      ? flatEntries(value, `${prefix}${key}.`)
      : [[`${prefix}${key}`, value] as [string, unknown]],
  );
}

const keysOf = (obj: object) => flatEntries(obj).map(([key]) => key).sort();

describe("Message-Dateien", () => {
  it("decken alle Locales ab", () => {
    expect(Object.keys(messages).sort()).toEqual([...routing.locales].sort());
  });

  it.each(routing.locales)("%s hat dieselben Keys wie en", (locale) => {
    expect(keysOf(messages[locale])).toEqual(keysOf(en));
  });

  it.each(routing.locales)("%s hat keine leeren Texte", (locale) => {
    const empty = flatEntries(messages[locale])
      .filter(([, value]) => typeof value !== "string" || value.trim() === "")
      .map(([key]) => key);
    expect(empty).toEqual([]);
  });
});
