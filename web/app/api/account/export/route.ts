import { routing, type AppLocale } from "@/i18n/routing";
import { publicEnv } from "@/lib/env";
import { exportMyData, withPhotoLinks } from "@/lib/services/account";
import { getVerifiedUser } from "@/lib/services/auth";
import { localeFromAcceptLanguage } from "@/lib/unsubscribe/token";

// Datenexport als JSON-Download (ADR 019, Review A5): nur POST, Origin = SITE_URL und Sec-Fetch-Site same-origin,
// dann getUser(). Funktioniert ohne JavaScript per Formular; Fehler und Limit per 303 zurück auf die Seite.
// Keine Inhalte in Logs, nie gecacht.

const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

function back(locale: AppLocale, error: string, retryAfter?: string | null): Response {
  const url = new URL(`/${locale}/account/data`, publicEnv.NEXT_PUBLIC_SITE_URL);
  url.searchParams.set("error", error);
  if (retryAfter) url.searchParams.set("retry", retryAfter);
  return new Response(null, { status: 303, headers: { ...NO_STORE, Location: url.pathname + url.search } });
}

export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  if (origin !== new URL(publicEnv.NEXT_PUBLIC_SITE_URL).origin || (site !== null && site !== "same-origin")) {
    return new Response(null, { status: 403, headers: NO_STORE });
  }
  const form = await request.formData().catch(() => null);
  const field = form?.get("locale");
  const locale = routing.locales.includes(field as AppLocale) ? (field as AppLocale) : localeFromAcceptLanguage(request.headers.get("accept-language"));
  const user = await getVerifiedUser();
  if (!user) {
    const next = `/${locale}/account/data`;
    return new Response(null, { status: 303, headers: { ...NO_STORE, Location: `/${locale}/login?next=${encodeURIComponent(next)}` } });
  }
  const result = await exportMyData();
  if (!result.ok) return back(locale, result.error, result.error === "rate_limited" ? result.retryAfter : null);
  const date = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(withPhotoLinks(result.data, publicEnv.NEXT_PUBLIC_SITE_URL), null, 2), {
    status: 200,
    headers: {
      ...NO_STORE,
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="revier-export-${date}.json"`,
    },
  });
}
