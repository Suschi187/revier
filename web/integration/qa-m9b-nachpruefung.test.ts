import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixture, SKIPPED } from "./context";
import { acceptLegal, createSignedInUser, deleteUsers, JPEG, serviceClient } from "./helpers";
import { enrollTotp, localRows, localSql, makeAdmin } from "./totp";

// QA M9b – Nachprüfung (docs/QA-REPORT.md). Edge Function verification-document gegen den echten Stack (F6):
// Rechte (ohne JWT, anon-Key, Nutzer, Admin mit aal1, eigenes Konto), gleiche 404 für unbekannt, zurückgezogen und
// gelöschte Datei, Methoden und Eingaben, Header (no-store, sandbox, PDF als Download), 415 für falsche Bytes, Audit
// je Abruf, Logs ohne IDs und Pfade. Dazu Kontolöschung nach dem Abruf (Dokument weg, kein Rest).

const f = fixture();
const PDF = new TextEncoder().encode("%PDF-1.4\n%QA\n");

describe.skipIf(!f)("QA M9b Nachprüfung: verification-document", () => {
  const fx = f ?? SKIPPED;
  const service = serviceClient(fx);
  const users: string[] = [];
  const paths: string[] = [];
  let owner: Awaited<ReturnType<typeof createSignedInUser>>;
  let mod: Awaited<ReturnType<typeof createSignedInUser>>;
  let modToken = "";
  let lazy: Awaited<ReturnType<typeof createSignedInUser>>;
  const docs: Record<"jpeg" | "pdf" | "html", { id: string; path: string }> = {} as never;
  let since = "";

  const call = (token: string | null, body: unknown = {}, method = "POST") =>
    fetch(`${fx.url}/functions/v1/verification-document`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), apikey: fx.publishableKey, "Content-Type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify(body),
    });
  const viewed = (id: string) => localRows<{ n: number }>(`select count(*)::int as n from public.audit_log
    where action = 'verification.document_viewed' and target_id = '${id}'`)[0].n;

  async function submitted(user: typeof owner, type: "jagdschein" | "jagdkarte" | "revierbescheinigung", bytes: Uint8Array, contentType: string) {
    const begun = (await user.client.rpc("begin_verification", { p_document_type: type })).data as { id: string; path: string };
    expect((await user.client.storage.from("verification-docs").upload(begun.path, bytes, { contentType })).error).toBeNull();
    expect((await user.client.rpc("submit_verification", { p_id: begun.id })).error).toBeNull();
    paths.push(begun.path);
    return begun;
  }

  beforeAll(async () => {
    since = new Date().toISOString();
    const [o, p, h] = await Promise.all(["qa9n-o", "qa9n-p", "qa9n-h"].map((l) => createSignedInUser(fx, l)));
    [mod, lazy] = await Promise.all([createSignedInUser(fx, "qa9n-mod"), createSignedInUser(fx, "qa9n-aal1")]);
    owner = o;
    users.push(o.id, p.id, h.id, mod.id, lazy.id);
    for (const u of [o, p, h]) await acceptLegal(u.client);
    makeAdmin(mod.id);
    makeAdmin(lazy.id);
    modToken = (await enrollTotp(mod.client)).accessToken;
    docs.jpeg = await submitted(o, "jagdschein", JPEG, "image/jpeg");
    docs.pdf = await submitted(p, "jagdkarte", PDF, "application/pdf");
    docs.html = await submitted(h, "revierbescheinigung", new TextEncoder().encode("<html><script>x</script></html>"), "image/png");
  });

  afterAll(async () => {
    if (paths.length) await service.storage.from("verification-docs").remove(paths);
    localSql(`delete from private.account_deletions where user_id in (${users.map((u) => `'${u}'`).join(",")})`);
    await deleteUsers(fx, users);
  });

  it("Rechte: ohne JWT 400/401, anon-Key, Nutzer und Admin mit aal1 403, ohne Audit", async () => {
    const before = viewed(docs.jpeg.id);
    // Nur mit apikey (publishable) lässt das lokale Gateway den Aufruf durch; die Function lehnt ohne Token mit 400 ab.
    expect([400, 401]).toContain((await call(null, { id: docs.jpeg.id })).status);
    expect((await fetch(`${fx.url}/functions/v1/verification-document`, { method: "POST", body: "{}" })).status).toBe(401);
    expect((await call(fx.publishableKey, { id: docs.jpeg.id })).status).toBe(403);
    expect((await call(owner.token, { id: docs.jpeg.id })).status).toBe(403);
    expect((await call(lazy.token, { id: docs.jpeg.id })).status).toBe(403);
    expect(viewed(docs.jpeg.id)).toBe(before);
  });

  it("Eingaben und Methoden: GET 405, fehlende oder ungültige ID 400; unbekannt, zurückgezogen und Datei weg: gleiche 404", async () => {
    expect((await call(modToken, undefined, "GET")).status).toBe(405);
    expect((await call(modToken, {})).status).toBe(400);
    expect((await call(modToken, { id: "1 or 1=1" })).status).toBe(400);
    const unknown = await call(modToken, { id: crypto.randomUUID() });
    const unknownBody = await unknown.text();
    expect(unknown.status).toBe(404);
    // Antrag ohne Datei: Datei per Storage-API gelöscht, Zeile hat noch den Pfad
    const other = await createSignedInUser(fx, "qa9n-gone");
    users.push(other.id);
    await acceptLegal(other.client);
    const gone = await submitted(other, "jagdschein", JPEG, "image/jpeg");
    await service.storage.from("verification-docs").remove([gone.path]);
    const missing = await call(modToken, { id: gone.id });
    expect(missing.status).toBe(404);
    expect(await missing.text()).toBe(unknownBody);
    expect(missing.headers.get("cache-control")).toBe("private, no-store");
  });

  it("Bild inline, PDF als Download, falsche Bytes 415; Header ohne Cache, mit sandbox; je Abruf ein Audit", async () => {
    const before = viewed(docs.jpeg.id);
    const image = await call(modToken, { id: docs.jpeg.id });
    expect(image.status).toBe(200);
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(JPEG);
    expect(image.headers.get("content-type")).toBe("image/jpeg");
    expect(image.headers.get("content-disposition")).toBe("inline");
    expect(image.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(image.headers.get("x-content-type-options")).toBe("nosniff");
    expect(image.headers.get("referrer-policy")).toBe("no-referrer");
    await call(modToken, { id: docs.jpeg.id });
    expect(viewed(docs.jpeg.id)).toBe(before + 2);

    const pdf = await call(modToken, { id: docs.pdf.id });
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(pdf.headers.get("content-disposition")).toMatch(/^attachment;/);

    const html = await call(modToken, { id: docs.html.id });
    expect(html.status).toBe(415);
    expect(html.headers.get("content-type")).toMatch(/json/);
    expect(await html.text()).not.toContain("script");
    // Auch der Versuch mit falschen Bytes ist auditiert (Admin hat den Abruf ausgelöst)
    expect(viewed(docs.html.id)).toBe(1);
  });

  it("Eigenes Konto: Admin mit eigenem Antrag bekommt 403 und kein Audit", async () => {
    await acceptLegal(mod.client);
    const own = await submitted({ ...mod, token: modToken }, "jagdschein", JPEG, "image/jpeg");
    expect((await call(modToken, { id: own.id })).status).toBe(403);
    expect(viewed(own.id)).toBe(0);
  });

  it("Admins signieren und laden auch direkt nach dem Audit nicht über die Storage-API", async () => {
    expect((await mod.client.rpc("admin_open_verification_document", { p_id: docs.pdf.id })).error).toBeNull();
    const bucket = mod.client.storage.from("verification-docs");
    expect((await bucket.createSignedUrl(docs.pdf.path, 60)).data).toBeNull();
    expect((await bucket.download(docs.pdf.path)).data).toBeNull();
  });

  it("Logs der Edge Runtime ohne Antrags-ID, Pfad und Nutzer-ID", () => {
    const logs = execFileSync("sh", ["-c", `docker logs --since ${since} supabase_edge_runtime_revier 2>&1`], { encoding: "utf8" });
    const lines = logs.split("\n").filter((l) => l.includes("verification-document"));
    expect(lines.length).toBeGreaterThan(0);
    for (const needle of [docs.jpeg.id, docs.pdf.id, docs.html.id, owner.id, mod.id, docs.jpeg.path]) expect(logs).not.toContain(needle);
  });
});
