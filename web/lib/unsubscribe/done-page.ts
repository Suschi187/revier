import { routing, type AppLocale } from "@/i18n/routing";
import cs from "@/messages/cs.json";
import de from "@/messages/de.json";
import en from "@/messages/en.json";
import pl from "@/messages/pl.json";

// Antwort von POST /api/unsubscribe (ADR 018, RFC 8058): immer 200 mit diesem Body, gleich für gültige und ungültige
// Token (kein Orakel), ohne Redirect. Mail-Clients (One-Click) ignorieren den Body, ein Mensch sieht nach dem
// Formular der Bestätigungsseite (auch ohne JavaScript) eine lokalisierte Bestätigung. Ohne Skripte und
// Drittressourcen, mit Wegen zu den Einstellungen sowie zu Impressum und Datenschutz.

const MESSAGES = { de, en, cs, pl } satisfies Record<AppLocale, unknown>;

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** CSP der Seite: nur Inline-Stil, keine Skripte, keine Formulare, keine Einbettung. */
export const DONE_CSP = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export function unsubscribeDoneHtml(locale: AppLocale): string {
  const lang = routing.locales.includes(locale) ? locale : routing.defaultLocale;
  const m = MESSAGES[lang];
  const u = m.Unsubscribe;
  const settings = [
    [`/${lang}/account/searches`, u.searches],
    [`/${lang}/account/profile`, u.profile],
  ];
  const legal = [
    [`/${lang}/imprint`, m.Legal.imprint.title],
    [`/${lang}/privacy`, m.Legal.privacy.title],
  ];
  const list = (links: string[][]) => links.map(([href, label]) => `<li><a href="${href}">${escape(label)}</a></li>`).join("");
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="referrer" content="no-referrer">
<title>${escape(u.metaTitle)} | ${escape(m.Metadata.siteName)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:48rem;margin:0 auto;padding:3rem 1rem;color:#1c1917;line-height:1.5}a{color:inherit}footer ul{display:flex;flex-wrap:wrap;gap:1rem;list-style:none;padding:0}</style>
</head>
<body>
<main>
<p><a href="/${lang}">${escape(m.Metadata.siteName)}</a></p>
<h1>${escape(u.title)}</h1>
<p role="status">${escape(u.done)}</p>
<p>${escape(u.settings)}</p>
<ul>${list(settings)}</ul>
</main>
<footer><ul>${list(legal)}</ul></footer>
</body>
</html>`;
}
