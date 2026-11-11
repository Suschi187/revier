import { ownPhotoUrl } from "@/lib/services/account";
import { getSessionUser } from "@/lib/services/auth";
import { localeFromAcceptLanguage } from "@/lib/unsubscribe/token";

// Foto-Link aus dem Datenexport (ADR 019): verlangt Login und Eigentum, leitet auf eine 60-Sekunden-URL weiter.
// Fremde, unbekannte und unverarbeitete Fotos ergeben dieselbe 404. Nie gecacht, kein Referer.

const HEADERS = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function GET(request: Request, ctx: RouteContext<"/api/account/photos/[id]">): Promise<Response> {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return new Response(null, { status: 404, headers: HEADERS });
  if (!(await getSessionUser())) {
    const locale = localeFromAcceptLanguage(request.headers.get("accept-language"));
    return new Response(null, { status: 303, headers: { ...HEADERS, Location: `/${locale}/login?next=${encodeURIComponent(`/${locale}/account/data`)}` } });
  }
  const url = await ownPhotoUrl(id);
  if (!url) return new Response(null, { status: 404, headers: HEADERS });
  return new Response(null, { status: 303, headers: { ...HEADERS, Location: url } });
}
