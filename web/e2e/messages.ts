import { readFileSync } from "node:fs";
import path from "node:path";

// Texte für Proben in cs/pl direkt aus den Message-Dateien (M10a Schritt 5): Die Übersetzungen kommen per DeepL und
// ändern sich mit jedem Lauf; fest eingetragene Sätze in Tests würden dann veralten.

const cache = new Map<string, unknown>();

/** Text eines Schlüssels (`Chat.legalRequired`) mit einfachen Platzhaltern `{name}`, ohne ICU-Plural. */
export function msg(locale: string, key: string, values: Record<string, string> = {}): string {
  if (!cache.has(locale)) cache.set(locale, JSON.parse(readFileSync(path.resolve(process.cwd(), "messages", `${locale}.json`), "utf8")));
  let node = cache.get(locale) as Record<string, unknown> | string;
  for (const part of key.split(".")) node = (node as Record<string, unknown>)[part] as Record<string, unknown> | string;
  if (typeof node !== "string") throw new Error(`Kein Text: ${locale} ${key}`);
  return node.replace(/\{(\w+)\}/g, (all, name: string) => values[name] ?? all);
}
