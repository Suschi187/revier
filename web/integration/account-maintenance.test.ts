import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixture, SKIPPED } from "./context";
import { createSignedInUser, deleteUsers, serviceClient } from "./helpers";
import { localRows, localSql } from "./totp";

// M9a (ADR 019): Storage-Aufräumen über die echte Function account-maintenance und die Storage-API. Foto-Eingang und
// Dateien in listing-photos ohne Zeile nach 24 h weg; frische Dateien, Dateien mit Zeile und Dokumente bleiben.
// Das Alter wird per SQL auf storage.objects.created_at gesetzt (Löschen dort bleibt gesperrt).

const f = fixture();
const created: string[] = [];
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);

describe.skipIf(!f)("Storage-Aufräumen (account-maintenance)", () => {
  const fx = f ?? SKIPPED;
  const service = serviceClient(fx);
  let secret = "";

  beforeAll(() => {
    secret = localRows<{ s: string }>("select decrypted_secret as s from vault.decrypted_secrets where name = 'account_maintenance_secret'")[0].s;
  });
  afterAll(async () => {
    const ids = created.filter((id) => /^[0-9a-f-]{36}$/.test(id));
    const objects = ids.length === 0 ? [] : localRows<{ bucket_id: string; name: string }>(
      `select bucket_id, name from storage.objects where split_part(name, '/', 1) in (${ids.map((id) => `'${id}'`).join(",")})`);
    for (const bucket of new Set(objects.map((o) => o.bucket_id))) {
      await service.storage.from(bucket).remove(objects.filter((o) => o.bucket_id === bucket).map((o) => o.name));
    }
    await deleteUsers(fx, created);
  });

  const run = (header = secret) =>
    fetch(`${fx.url}/functions/v1/account-maintenance`, { method: "POST", headers: { "x-account-maintenance-secret": header } });

  it("ohne Geheimnis 403; danach nur alte Eingangsdateien und Fotos ohne Zeile weg", async () => {
    expect((await run("falsch")).status).toBe(403);

    const user = await createSignedInUser(fx, "maintenance");
    created.push(user.id);
    const region = (await service.from("regions").select("id").eq("code", "DE-14628").single()).data!.id as string;
    const listing = (await service.from("listings")
      .insert({ owner_id: user.id, kind: "helper", direction: "wanted", title: "Wartung", content_language: "de", region_id: region })
      .select("id").single()).data!.id as string;
    const kept = (await service.from("listing_photos").insert({ listing_id: listing, sort_order: 0 }).select("storage_path").single()).data!.storage_path as string;
    const files = {
      oldUpload: ["listing-uploads", `${user.id}/${listing}/old.jpg`],
      newUpload: ["listing-uploads", `${user.id}/${listing}/new.jpg`],
      oldOrphan: ["listing-photos", `${user.id}/${listing}/orphan.jpg`],
      kept: ["listing-photos", kept],
      doc: ["verification-docs", `${user.id}/doc.jpg`],
    } as const;
    for (const [bucket, path] of Object.values(files)) {
      const { error } = await service.storage.from(bucket).upload(path, JPEG, { contentType: "image/jpeg", upsert: true });
      expect(error, path).toBeNull();
    }
    const old = [files.oldUpload[1], files.oldOrphan[1], files.kept[1], files.doc[1]].map((p) => `'${p}'`).join(",");
    localSql(`update storage.objects set created_at = now() - interval '25 hours' where name in (${old})`);

    const response = await run();
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, number>;
    expect(body.upload_expired).toBeGreaterThanOrEqual(1);
    expect(body.photo_orphan).toBeGreaterThanOrEqual(1);

    const exists = async ([bucket, path]: readonly [string, string]) => !(await service.storage.from(bucket).download(path)).error;
    expect(await exists(files.oldUpload), "alte Eingangsdatei").toBe(false);
    expect(await exists(files.oldOrphan), "Foto ohne Zeile").toBe(false);
    expect(await exists(files.newUpload), "frische Eingangsdatei bleibt").toBe(true);
    expect(await exists(files.kept), "Foto mit Zeile bleibt").toBe(true);
    // Seit M9b (ADR 020): Ein Dokument ohne Antrag älter als 24 h wird ebenfalls entfernt.
    expect(await exists(files.doc), "Dokument ohne Antrag").toBe(false);
    expect(body.verification_orphan).toBeGreaterThanOrEqual(1);
  });
});
