import { localeFromAcceptLanguage, parseToken, readUnsubscribePost } from "@/lib/unsubscribe/token";
import { DONE_CSP, unsubscribeDoneHtml } from "@/lib/unsubscribe/done-page";
import { unsubscribeWithToken } from "@/lib/services/unsubscribe";

// One-Click-Abbestellen (ADR 018, RFC 8058, Review B4). Der Proxy lässt /api/ unberührt: kein Sprachrouting, kein
// Login, kein Session-Refresh, keine Cookies. Der Token ist die Berechtigung, daher keine Origin-/CSRF-Prüfung (eine
// Server Action ginge ohne JavaScript nicht: Mit no-referrer sendet der Browser `Origin: null`, Next lehnt ab).
// POST antwortet immer 200 mit gleichem Body je Sprache, ohne Redirect; GET ändert nichts und leitet auf die Seite.

const HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex",
  "X-Content-Type-Options": "nosniff",
};

export async function POST(request: Request): Promise<Response> {
  const { token, locale } = await readUnsubscribePost(request);
  if (token) await unsubscribeWithToken(token);
  return new Response(unsubscribeDoneHtml(locale), {
    status: 200,
    headers: { ...HEADERS, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": DONE_CSP },
  });
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const token = parseToken(url.searchParams.get("t"));
  const lang = localeFromAcceptLanguage(request.headers.get("accept-language"));
  const target = new URL(`/${lang}/unsubscribe`, url);
  if (token) target.searchParams.set("t", token);
  return new Response(null, { status: 303, headers: { ...HEADERS, Location: `${target.pathname}${target.search}` } });
}
