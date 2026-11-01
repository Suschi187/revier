import { routing, type AppLocale } from "@/i18n/routing";
import cs from "@/messages/cs.json";
import de from "@/messages/de.json";
import en from "@/messages/en.json";
import pl from "@/messages/pl.json";
import { publicPath } from "./paths";

// 410 „nicht mehr verfügbar“ (ADR 015, Zustand `gone`). Next übernimmt den Status eines Rewrites nur, wenn die
// Seite ihn selbst setzt (forbidden(), notFound()); für 410 gibt es das nicht. Der Proxy antwortet deshalb mit
// dieser kleinen Seite selbst: lokalisiert, ohne Skripte, mit Wegen zu Suche, Impressum und Datenschutz.

const MESSAGES = { de, en, cs, pl } satisfies Record<AppLocale, unknown>;

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function goneHtml(locale: AppLocale): string {
  const m = MESSAGES[routing.locales.includes(locale) ? locale : routing.defaultLocale];
  const g = m.Public.gone;
  const links = [
    [publicPath({ route: "search" }, locale), g.toSearch],
    [`/${locale}/imprint`, m.Legal.imprint.title],
    [`/${locale}/privacy`, m.Legal.privacy.title],
  ];
  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escape(g.metaTitle)} | ${escape(m.Metadata.siteName)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:48rem;margin:0 auto;padding:3rem 1rem;color:#1c1917;line-height:1.5}a{color:inherit}ul{display:flex;flex-wrap:wrap;gap:1rem;list-style:none;padding:0}</style>
</head>
<body>
<main>
<p><a href="/${locale}">${escape(m.Metadata.siteName)}</a></p>
<h1>${escape(g.title)}</h1>
<p>${escape(g.text)}</p>
<ul>${links.map(([href, label]) => `<li><a href="${href}">${escape(label)}</a></li>`).join("")}</ul>
</main>
</body>
</html>`;
}
