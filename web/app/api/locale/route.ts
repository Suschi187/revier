import { routing, type AppLocale } from "@/i18n/routing";
import { switchLocaleHref } from "@/lib/public/locale-switch";

// Sprachwechsel ohne JavaScript (QA M5, M10a): Steht die Sprachwahl im Kopf nicht im ersten HTML (gestreamt, ohne
// JavaScript verborgen), zeigt ihr Platzhalter Links hierher. Das Ziel kommt aus dem Referer, nur dessen Pfad und
// Query zählen; die Antwort leitet immer auf einen eigenen Pfad. Ohne Referer (z. B. no-referrer) zur Startseite.

const HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex",
};

function isLocale(value: string | null): value is AppLocale {
  return routing.locales.includes(value as AppLocale);
}

export function GET(request: Request): Response {
  const to = new URL(request.url).searchParams.get("to");
  const target: AppLocale = isLocale(to) ? to : routing.defaultLocale;
  let location = `/${target}`;
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      const from = new URL(referer);
      location = switchLocaleHref(from.pathname, from.search, target);
    } catch {
      // Ungültiger Referer: Startseite der Zielsprache.
    }
  }
  return new Response(null, { status: 303, headers: { ...HEADERS, Location: location } });
}
