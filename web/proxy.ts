import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

export default createMiddleware(routing);

export const config = {
  // Alles außer Next-Interna, API-Routen, öffentlichen Dateien unter /static/ und den
  // Metadaten-Dateien im Root. Jeder andere Pfad ohne Sprachpräfix wird umgeleitet
  // (z. B. /foo.png → /de/foo.png → 404), statt als ungültige Locale gerendert zu werden
  // (QA M0 F6). Neue öffentliche Dateien gehören deshalb nach public/static/.
  matcher:
    "/((?!_next/|_vercel/|api/|static/|favicon\\.ico$|robots\\.txt$|sitemap\\.xml$|manifest\\.webmanifest$).*)",
};
