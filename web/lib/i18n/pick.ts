/** Übersetzungen als verschachteltes Objekt, wie in `messages/<locale>.json`. */
export type Messages = { [key: string]: unknown };

/**
 * Teilmenge der Übersetzungen für den Browser (M10a, Performance der Listenseite): nur die Namensräume, die Client-
 * Komponenten lesen, statt aller rund 70 KB je Seite. Pfade mit Punkt (`Auth.login`) wählen einen Unterbaum.
 * Fehlt ein Pfad, wirft die Funktion, damit ein Tippfehler im Build auffällt statt als roher Schlüssel im Browser.
 */
export function pickMessages(messages: Messages, paths: readonly string[]): Messages {
  const out: Messages = {};
  for (const path of paths) {
    const parts = path.split(".");
    let source: unknown = messages;
    for (const part of parts) {
      if (typeof source !== "object" || source === null || !(part in source)) throw new Error(`Unbekannter Namensraum: ${path}`);
      source = (source as Messages)[part];
    }
    let target = out;
    parts.slice(0, -1).forEach((part) => {
      const next = target[part];
      target = typeof next === "object" && next !== null ? (next as Messages) : (target[part] = {});
    });
    target[parts[parts.length - 1]] = source;
  }
  return out;
}

/** Was das Layout an den Browser gibt: die Sprachwahl im Kopf und die Texte der Fehlerseite (`[locale]/error.tsx`, unter 1 KB). Alles andere über `ClientMessages`. */
export const LAYOUT_CLIENT_NAMESPACES = ["LocaleSwitcher", "ServerError", "NotFound.backHome"] as const;
