import { getVerifiedUser } from "@/lib/services/auth";
import { fetchDocument } from "@/lib/services/admin-verifications";

// Verifizierungsdokument für Admins (ADR 020, QA M9b F6): reicht die Antwort der Edge Function verification-document
// durch. Rechte (aal2, nie das eigene Konto) und das Audit je Abruf prüft die DB; die Function prüft die ersten Bytes.
// Gleiche 404 für fremd und unbekannt, nie gecacht, Inhalt in einer Sandbox.

const HEADERS = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PASSED = ["content-type", "content-disposition", "content-security-policy"];

export async function GET(_request: Request, ctx: RouteContext<"/api/admin/verifications/[id]/document">): Promise<Response> {
  const { id } = await ctx.params;
  if (!UUID.test(id) || !(await getVerifiedUser())) return new Response(null, { status: 404, headers: HEADERS });
  const upstream = await fetchDocument(id);
  if (!upstream) return new Response(null, { status: 404, headers: HEADERS });
  if (!upstream.ok) {
    const status = upstream.status === 415 ? 415 : upstream.status === 403 ? 403 : 404;
    return new Response(null, { status, headers: HEADERS });
  }
  const headers: Record<string, string> = { ...HEADERS };
  for (const name of PASSED) {
    const value = upstream.headers.get(name);
    if (value) headers[name] = value;
  }
  return new Response(upstream.body, { status: 200, headers });
}
