import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixture, SKIPPED } from "./context";
import { createSignedInUser, deleteUsers, JPEG, serviceClient } from "./helpers";
import { enrollTotp, localSql, makeAdmin } from "./totp";

// M9b (ADR 020) gegen die echte Storage-API und echtes aal2: Upload nur auf den Pfad des eigenen Antrags, Löschen
// durch den Besitzer bis zur Einreichung (Review A6), Dokumente für Admins nur mit frischem Audit (Review B3).

const f = fixture();

describe.skipIf(!f)("Verifizierung über Storage-API und PostgREST", () => {
  const fx = f ?? SKIPPED;
  const service = serviceClient(fx);
  const users: string[] = [];
  let owner: Awaited<ReturnType<typeof createSignedInUser>>;
  let mod: Awaited<ReturnType<typeof createSignedInUser>>;
  let request: { id: string; path: string };

  beforeAll(async () => {
    [owner, mod] = await Promise.all([createSignedInUser(fx, "verif"), createSignedInUser(fx, "verifmod")]);
    users.push(owner.id, mod.id);
    localSql(`insert into public.legal_acceptances (user_id, document, version, source) values
      ('${owner.id}', 'terms', private.setting_text('legal_terms_version'), 'web'),
      ('${owner.id}', 'privacy', private.setting_text('legal_privacy_version'), 'web')`);
    makeAdmin(mod.id);
    await enrollTotp(mod.client);
    const begun = await owner.client.rpc("begin_verification", { p_document_type: "jagdschein" });
    expect(begun.error).toBeNull();
    request = begun.data as { id: string; path: string };
  });

  afterAll(async () => {
    await service.storage.from("verification-docs").remove([request.path]);
    await deleteUsers(fx, users);
  });

  const docs = () => owner.client.storage.from("verification-docs");

  it("Upload nur auf den Pfad des Antrags, ohne Upsert; Löschen vor der Einreichung", async () => {
    expect((await docs().upload(`${owner.id}/anders.jpg`, JPEG, { contentType: "image/jpeg" })).error).not.toBeNull();
    expect((await docs().upload(request.path, new TextEncoder().encode("x"), { contentType: "image/heic" })).error).not.toBeNull();
    expect((await docs().upload(request.path, JPEG, { contentType: "image/jpeg" })).error).toBeNull();
    expect((await docs().upload(request.path, JPEG, { contentType: "image/jpeg", upsert: true })).error).not.toBeNull();
    const removed = await docs().remove([request.path]);
    expect(removed.data?.map((o) => o.name)).toEqual([request.path]);
    expect((await docs().upload(request.path, JPEG, { contentType: "image/jpeg" })).error).toBeNull();
    expect((await owner.client.rpc("submit_verification", { p_id: request.id })).error).toBeNull();
    // Nach der Einreichung bleibt die Datei beim Besitzer liegen.
    expect((await docs().remove([request.path])).data ?? []).toEqual([]);
    expect((await service.storage.from("verification-docs").exists(request.path)).data).toBe(true);
  });

  it("Admin mit aal2 signiert nicht ohne frisches Audit, danach 60 s lang schon (Review B3)", async () => {
    const adminDocs = mod.client.storage.from("verification-docs");
    expect((await adminDocs.createSignedUrl(request.path, 60)).data).toBeNull();
    expect((await adminDocs.download(request.path)).data).toBeNull();

    const opened = await mod.client.rpc("admin_open_verification_document", { p_id: request.id });
    expect(opened.error).toBeNull();
    expect(opened.data).toBe(request.path);
    const signed = await adminDocs.createSignedUrl(request.path, 60);
    expect(signed.error).toBeNull();
    const response = await fetch(signed.data!.signedUrl);
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(JPEG);

    localSql(`update public.audit_log set created_at = now() - interval '3 minutes'
              where action = 'verification.document_viewed' and target_id = '${request.id}'`);
    expect((await adminDocs.createSignedUrl(request.path, 60)).data).toBeNull();
  });

  it("Entscheidung per RPC schaltet das Badge; der Besitzer sieht keinen Prüfer", async () => {
    expect((await mod.client.rpc("decide_verification", { p_id: request.id, p_decision: "verify" })).error).toBeNull();
    const profile = await owner.client.from("profiles").select("verification_status").eq("user_id", owner.id).single();
    expect(profile.data?.verification_status).toBe("verified");
    expect((await owner.client.from("verifications").select("reviewed_by")).error).not.toBeNull();
    expect((await owner.client.from("verifications").update({ status: "rejected" }).eq("id", request.id)).error).not.toBeNull();
  });
});
