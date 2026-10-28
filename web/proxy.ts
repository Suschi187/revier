import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

export default createMiddleware(routing);

export const config = {
  // Alles außer API, Next-Interna und Dateien mit Endung (z. B. favicon.ico).
  matcher: "/((?!api|_next|_vercel|.*\\..*).*)",
};
