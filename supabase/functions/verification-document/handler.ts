// Verifizierungsdokument für Admins (ADR 020, Review B3, QA M9b F6), ohne Netzwerk: index.ts setzt RPC und Download
// ein, die Tests Mocks. Admins haben keinen Lesezugriff über die Storage-API; jeder Abruf läuft hier durch:
//   1. admin_open_verification_document mit dem JWT des Admins (aal2, nie das eigene Konto, schreibt das Audit),
//   2. Download mit service_role, 3. Prüfung der ersten Bytes (JPEG, PNG, PDF), 4. Antwort ohne Cache.
// Logs nur Ergebnis und Dauer, keine Pfade, IDs oder Inhalte.

export type Mime = "image/jpeg" | "image/png" | "application/pdf";
export type RpcError = { code?: string } | null;

export type Deps = {
  open(token: string, id: string): Promise<{ data: string | null; error: RpcError }>;
  download(path: string): Promise<Uint8Array | null>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const BASE = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'none'; sandbox",
};

export function sniff(bytes: Uint8Array): Mime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-") return "application/pdf";
  return null;
}

function fail(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: BASE });
}

export async function handle(request: Request, deps: Deps): Promise<{ response: Response; result: string }> {
  if (request.method !== "POST") return { response: fail(405, "method"), result: "method" };
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  let id = "";
  try {
    id = String(((await request.json()) as { id?: unknown }).id ?? "");
  } catch {
    // leerer oder ungültiger Body
  }
  if (!token || !UUID.test(id)) return { response: fail(400, "bad_request"), result: "bad_request" };
  const { data: path, error } = await deps.open(token, id);
  if (error) {
    // Nicht vorhanden und fremd gleich (kein Orakel); keine Rechte 403.
    if (error.code === "42501") return { response: fail(403, "forbidden"), result: "forbidden" };
    if (error.code === "P0002") return { response: fail(404, "not_found"), result: "not_found" };
    return { response: fail(500, "internal"), result: "internal" };
  }
  if (!path) return { response: fail(404, "not_found"), result: "not_found" };
  const bytes = await deps.download(path);
  if (!bytes) return { response: fail(404, "not_found"), result: "missing" };
  const mime = sniff(bytes.slice(0, 16));
  // Inhalt passt zu keinem erlaubten Typ: nicht ausliefern, nur markieren (Review A6).
  if (!mime) return { response: fail(415, "mismatch"), result: "mismatch" };
  const disposition = mime === "application/pdf" ? 'attachment; filename="dokument.pdf"' : "inline";
  return {
    response: new Response(bytes, { status: 200, headers: { ...BASE, "Content-Type": mime, "Content-Disposition": disposition } }),
    result: "ok",
  };
}
