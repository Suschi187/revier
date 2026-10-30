import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "./i18n/routing";
import { canonicalPath, isAdminPath, isProtectedPath, localeFromPath } from "./lib/auth/paths";
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
  // Geschützte Bereiche nur unter ihrer kanonischen Form ausliefern, sonst greifen die Prüfungen unten
  // nicht (`/de/%61dmin` rendert dank next-intl `/de/admin`).
  if (canonical !== pathname && isProtectedPath(canonical)) {
    return NextResponse.redirect(new URL(canonical + search, request.url), 308);
  }
  const protectedPath = isProtectedPath(pathname);

  if (!hasAuthCookie(request)) {
    return protectedPath ? loginRedirect(request) : intl(request);
  }

  const session = await refreshSession(request);
  if (protectedPath && !session.userId) return session.apply(loginRedirect(request));
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
  // (QA M0 F6). Neue öffentliche Dateien gehören deshalb nach public/static/.
  matcher:
    "/((?!_next/|_vercel/|api/|static/|favicon\\.ico$|robots\\.txt$|sitemap\\.xml$|manifest\\.webmanifest$).*)",
};
