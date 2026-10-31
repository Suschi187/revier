import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "./i18n/routing";
import { canonicalPath, isAdminPath, isProtectedPath, localeFromPath } from "./lib/auth/paths";
import { parsePath } from "./lib/public/paths";
import { regionFromSlugs } from "./lib/public/regions";
import { STATUS_SECTIONS } from "./lib/public/sections";
import { publicEnv } from "./lib/env";
import { buildCsp } from "./lib/security/csp";
import { hasAuthCookie, refreshSession } from "./lib/supabase/proxy";

const intl = createMiddleware(routing);

function loginRedirect(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const url = new URL(`/${localeFromPath(pathname)}/login`, request.url);
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

/** 403 ohne Rolle (ADR 014): Die Seite `forbidden` ruft selbst forbidden() und liefert die lokalisierte 403-Seite. */
function forbiddenResponse(request: NextRequest): NextResponse {
  const url = new URL(`/${localeFromPath(request.nextUrl.pathname)}/forbidden`, request.url);
  const response = NextResponse.rewrite(url, { status: 403 });
  response.headers.set("X-Robots-Tag", "noindex");
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

/**
 * 404 für Pfade, die keine Seite sind (ADR 015, Review B2): Unter cacheComponents gibt es kein dynamicParams,
 * und nach dem Streaming-Start setzt notFound() keinen Status mehr. Die Seite `missing` rendert die 404.
 */
function notFoundResponse(request: NextRequest): NextResponse {
  const url = new URL(`/${localeFromPath(request.nextUrl.pathname)}/missing`, request.url);
  const response = NextResponse.rewrite(url, { status: 404 });
  response.headers.set("X-Robots-Tag", "noindex");
  return response;
}

/** Öffentliche Formen prüfen, ohne DB: unbekannte Wörter, Slugs und Formen sowie die Status-Seiten selbst. */
function isMissing(pathname: string): boolean {
  const parsed = parsePath(pathname);
  if (parsed.type === "unknown") return true;
  if (parsed.type === "static") return (STATUS_SECTIONS as readonly string[]).includes(pathname.split("/")[2]);
  if (parsed.type !== "public") return false;
  const page = parsed.page;
  if (page.route === "state") return !regionFromSlugs(page.state);
  if (page.route === "district") return !regionFromSlugs(page.state, page.district);
  return false;
}

/** Nonce-CSP für /admin (ADR 010/014): Next liest die Nonce aus dem CSP-Header des Requests. */
function withAdminCsp(request: NextRequest, respond: () => NextResponse): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp({
    supabaseUrl: publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    dev: process.env.NODE_ENV !== "production",
    https: publicEnv.NEXT_PUBLIC_SITE_URL.startsWith("https://"),
    nonce,
  });
  request.headers.set("x-nonce", nonce);
  request.headers.set("Content-Security-Policy", csp);
  const response = respond();
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Robots-Tag", "noindex");
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

// ADR 010: Session erneuern (nur mit Supabase-Cookie, anonymer Traffic bleibt schnell), dann
// Sprachrouting. Der Schutz hier ist nur optimistisch; autoritativ prüft jede Seite und Action selbst.
// Status und CSP für geschützte Bereiche entscheidet nur der Proxy: Mit cacheComponents ist die Hülle
// vorgerendert und der Status 200 gesendet, bevor die Seite forbidden() oder redirect() aufruft (QA M4 F1).
export default async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const canonical = canonicalPath(pathname);
  if (canonical === null) return new NextResponse(null, { status: 400 });
  // Jeden Pfad nur unter seiner kanonischen Form ausliefern, sonst greifen die Prüfungen unten nicht
  // (`/de/%61dmin` rendert dank next-intl `/de/admin`) und öffentliche Seiten bekämen doppelte URLs (ADR 015).
  if (canonical !== pathname) {
    return NextResponse.redirect(new URL(canonical + search, request.url), 308);
  }
  const protectedPath = isProtectedPath(pathname);
  const missing = isMissing(pathname);

  if (!hasAuthCookie(request)) {
    if (protectedPath) return loginRedirect(request);
    return missing ? notFoundResponse(request) : intl(request);
  }

  const session = await refreshSession(request);
  if (protectedPath && !session.userId) return session.apply(loginRedirect(request));
  if (missing) return session.apply(notFoundResponse(request));
  // Admin: Rolle per RPC (nicht per Claim, ADR 014); aal2 prüft die Seite und leitet zu /admin/mfa.
  if (isAdminPath(pathname)) {
    if (!(await session.hasAdminRole())) return session.apply(forbiddenResponse(request));
    return withAdminCsp(request, () => session.apply(intl(request)));
  }
  return session.apply(intl(request));
}

export const config = {
  // Alles außer Next-Interna, API-Routen, öffentlichen Dateien unter /static/ und den
  // Metadaten-Dateien im Root. Jeder andere Pfad ohne Sprachpräfix wird umgeleitet
  // (z. B. /foo.png → /de/foo.png → 404), statt als ungültige Locale gerendert zu werden
  // (QA M0 F6). Neue öffentliche Dateien gehören deshalb nach public/static/. Sitemaps je Sprache liegen
  // unter /sitemap/{id}.xml (ADR 015) und laufen ebenfalls nicht durch next-intl.
  matcher:
    "/((?!_next/|_vercel/|api/|static/|sitemap/|favicon\\.ico$|robots\\.txt$|sitemap\\.xml$|manifest\\.webmanifest$).*)",
};
