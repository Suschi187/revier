// verification-document (ADR 020, QA M9b F6): Methode, Token, ID, Rechte über die RPC, Prüfung der ersten Bytes, Header.
import { type Deps, handle, sniff } from "../handler.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const ID = "3f2b8c1e-6a4d-4e7b-9c10-5d8e2f1a0b7c";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const PDF = new TextEncoder().encode("%PDF-1.7 x");

function deps(open: Awaited<ReturnType<Deps["open"]>>, bytes: Uint8Array | null, calls: string[] = []): Deps {
  return {
    open: (token, id) => {
      calls.push(`open:${token}:${id}`);
      return Promise.resolve(open);
    },
    download: (path) => {
      calls.push(`download:${path}`);
      return Promise.resolve(bytes);
    },
  };
}

const post = (body: unknown, token = "jwt") =>
  new Request("http://x/", { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body) });

Deno.test("Nur POST, Token und UUID Pflicht", async () => {
  const calls: string[] = [];
  assert((await handle(new Request("http://x/", { method: "GET" }), deps({ data: "p", error: null }, JPEG, calls))).response.status === 405, "405");
  assert((await handle(post({ id: ID }, ""), deps({ data: "p", error: null }, JPEG, calls))).response.status === 400, "ohne Token");
  assert((await handle(post({ id: "x" }), deps({ data: "p", error: null }, JPEG, calls))).response.status === 400, "ohne UUID");
  assert(calls.length === 0, "keine RPC vor der Prüfung");
});

Deno.test("Rechte und Existenz aus der RPC: 403, 404 gleich für fremd und unbekannt", async () => {
  assert((await handle(post({ id: ID }), deps({ data: null, error: { code: "42501" } }, JPEG))).response.status === 403, "403");
  const calls: string[] = [];
  assert((await handle(post({ id: ID }), deps({ data: null, error: { code: "P0002" } }, JPEG, calls))).response.status === 404, "404");
  assert(!calls.some((c) => c.startsWith("download")), "kein Download ohne Audit und Recht");
});

Deno.test("Bild inline, PDF als Download, abweichender Inhalt 415; immer no-store und Sandbox", async () => {
  const calls: string[] = [];
  const image = await handle(post({ id: ID }), deps({ data: "u/1", error: null }, JPEG, calls));
  assert(image.response.status === 200 && image.response.headers.get("content-type") === "image/jpeg", "JPEG");
  assert(image.response.headers.get("content-disposition") === "inline", "inline");
  assert(image.response.headers.get("cache-control") === "private, no-store", "no-store");
  assert(image.response.headers.get("content-security-policy")?.includes("sandbox") === true, "sandbox");
  assert(calls.join() === `open:jwt:${ID},download:u/1`, calls.join());
  const pdf = await handle(post({ id: ID }), deps({ data: "u/1", error: null }, PDF));
  assert(pdf.response.headers.get("content-disposition")?.startsWith("attachment") === true, "PDF als Download");
  const html = await handle(post({ id: ID }), deps({ data: "u/1", error: null }, new TextEncoder().encode("<html>")));
  assert(html.response.status === 415 && html.result === "mismatch", "415");
  const gone = await handle(post({ id: ID }), deps({ data: "u/1", error: null }, null));
  assert(gone.response.status === 404, "Datei fehlt");
});

Deno.test("sniff", () => {
  assert(sniff(JPEG) === "image/jpeg" && sniff(PDF) === "application/pdf", "erkannt");
  assert(sniff(new Uint8Array([0x89, 0x50, 0x4e, 0x47])) === "image/png", "PNG");
  assert(sniff(new Uint8Array([0, 0, 0, 0x18])) === null, "HEIC und andere nicht");
});
