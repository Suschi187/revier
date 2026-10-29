import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "./i18n/routing";
import { isProtectedPath, localeFromPath } from "./lib/auth/paths";
import { hasAuthCookie, refreshSession } from "./lib/supabase/proxy";

const intl = createMiddleware(routing);

function loginRedirect(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const url = new URL(`/${localeFromPath(pathname)}/login`, request.url);
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

// ADR 010: Session erneuern (nur mit Supabase-Cookie, anonymer Traffic bleibt schnell), dann
// Sprachrouting. Der Schutz hier ist nur optimistisch; autoritativ prüft das Layout auf dem Server.
export default async function proxy(request: NextRequest) {
  const protectedPath = isProtectedPath(request.nextUrl.pathname);

  if (!hasAuthCookie(request)) {
    return protectedPath ? loginRedirect(request) : intl(request);
  }

  const session = await refreshSession(request);
  if (protectedPath && !session.userId) return session.apply(loginRedirect(request));
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
