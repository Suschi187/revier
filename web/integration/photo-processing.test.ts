import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixture, SKIPPED } from "./context";
import { serviceClient, userClient } from "./helpers";
import type { TestUser } from "./types";
// Dieselben Fixtures wie die Deno-Tests der Function: echte JPEGs mit GPS, XMP, Kommentar und ZIP-Anhang.
import {
  COMMENT, contains, encode, gpsRationalBytes, quadrants, withMetadata, XMP_MARKER, ZIP_SIGNATURE,
} from "../../supabase/functions/process-listing-photo/tests/fixtures.ts";
import { isCleanJpeg } from "../../supabase/functions/process-listing-photo/jpeg_header.ts";

// Edge Function process-listing-photo gegen die lokale Supabase mit Edge Runtime (ADR 011, Plan M3 Commit 5).

const f = fixture();
const ascii = (text: string) => new TextEncoder().encode(text);

describe.skipIf(!f)("Fotoverarbeitung: Edge Function", () => {
  const fx = f ?? SKIPPED;
  const { a, b, c } = fx.users;
  const admin = serviceClient(fx);
  const created: string[] = [];
  let activeStatusRestore = false;

  async function invoke(user: TestUser | null, body: unknown) {
    const headers: Record<string, string> = { apikey: fx.publishableKey, "Content-Type": "application/json" };
    if (user) headers.Authorization = `Bearer ${user.token}`;
    const res = await fetch(`${fx.url}/functions/v1/process-listing-photo`, { method: "POST", headers, body: JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }

  const drafts: string[] = [];

  /** Eigener Entwurf je Foto, damit die Grenze von 8 Fotos je Anzeige nicht stört. */
  async function newDraft(user: TestUser) {
    const res = await userClient(fx, user)
      .from("listings")
      .insert({ kind: "helper", direction: "offer", title: "Fototest", content_language: "de", region_id: fx.ids.district })
      .select("id")
      .single<{ id: string }>();
    expect(res.error).toBeNull();
    drafts.push(res.data!.id);
    return res.data!.id;
  }

  async function registerPhoto(user: TestUser) {
    const row = await userClient(fx, user)
      .from("listing_photos")
      .insert({ listing_id: await newDraft(user), sort_order: 0 })
      .select("id, upload_path, storage_path, thumb_path")
      .single<{ id: string; upload_path: string; storage_path: string; thumb_path: string }>();
    expect(row.error).toBeNull();
    created.push(row.data!.id);
    return row.data!;
  }

  async function upload(user: TestUser, path: string, bytes: Uint8Array) {
    const res = await userClient(fx, user).storage.from("listing-uploads").upload(path, bytes, { contentType: "image/jpeg" });
    expect(res.error).toBeNull();
  }

  async function inputExists(path: string) {
    const [folder, listing, name] = path.split("/");
    const list = await admin.storage.from("listing-uploads").list(`${folder}/${listing}`, { search: name });
    return (list.data ?? []).some((o) => o.name === name);
  }

  beforeAll(() => {
    expect(fx.url).toBeTruthy();
  });

  afterAll(async () => {
    if (created.length) {
      const rows = await admin.from("listing_photos").select("upload_path, storage_path, thumb_path").in("id", created);
      for (const row of rows.data ?? []) {
        await admin.storage.from("listing-uploads").remove([row.upload_path]);
        await admin.storage.from("listing-photos").remove([row.storage_path, row.thumb_path]);
      }
      await admin.from("listing_photos").delete().in("id", created);
    }
    if (drafts.length) await admin.from("listings").delete().in("id", drafts);
    if (activeStatusRestore) await admin.from("listings").update({ status: "active" }).eq("id", fx.ids.activeB);
  });

  it("entfernt GPS, EXIF, XMP, Kommentar und Anhang, wendet die Orientierung an und löscht den Eingang", async () => {
    const photo = await registerPhoto(a);
    const input = withMetadata(encode(quadrants(800, 600)), 6);
    expect(contains(input, gpsRationalBytes())).toBe(true);
    await upload(a, photo.upload_path, input);

    const res = await invoke(a, { photo_id: photo.id });
    expect(res).toEqual({ status: 200, body: { status: "processed", width: 600, height: 800 } });

    const row = await admin.from("listing_photos").select("processed_at, width, height, processing_attempts").eq("id", photo.id).single();
    expect(row.data).toMatchObject({ width: 600, height: 800, processing_attempts: 1 });
    expect(row.data?.processed_at).toBeTruthy();
    expect(await inputExists(photo.upload_path)).toBe(false);

    for (const path of [photo.storage_path, photo.thumb_path]) {
      const file = await userClient(fx, a).storage.from("listing-photos").download(path);
      expect(file.error).toBeNull();
      const bytes = new Uint8Array(await file.data!.arrayBuffer());
      expect(isCleanJpeg(bytes)).toBe(true);
      for (const needle of [ascii("Exif"), ascii("http://ns.adobe.com"), ascii(XMP_MARKER), ascii(COMMENT), ZIP_SIGNATURE, gpsRationalBytes()]) {
        expect(contains(bytes, needle)).toBe(false);
      }
    }

    // Wiederholter Aufruf: idempotent, kein weiterer Versuch
    expect((await invoke(a, { photo_id: photo.id })).body).toEqual({ status: "processed" });
  });

  it("fremde und unbekannte Fotos bekommen dieselbe Antwort; ohne Token oder mit falschem Body abgewiesen", async () => {
    const photo = await registerPhoto(a);
    await upload(a, photo.upload_path, encode(quadrants(64, 64)));
    const foreign = await invoke(c, { photo_id: photo.id });
    const unknown = await invoke(c, { photo_id: crypto.randomUUID() });
    expect(foreign).toEqual({ status: 404, body: { error: "not_found" } });
    expect(unknown).toEqual(foreign);
    expect(await inputExists(photo.upload_path)).toBe(true);
    expect((await invoke(null, { photo_id: photo.id })).status).toBe(401);
    expect(await invoke(a, { photo_id: "kein-uuid" })).toEqual({ status: 400, body: { error: "bad_request" } });
  });

  it("noch nicht hochgeladen: 409 ohne Versuch", async () => {
    const photo = await registerPhoto(a);
    expect(await invoke(a, { photo_id: photo.id })).toEqual({ status: 409, body: { error: "not_uploaded" } });
    const row = await admin.from("listing_photos").select("processing_attempts").eq("id", photo.id).single();
    expect(row.data?.processing_attempts).toBe(0);
  });

  it("kaputte und fremde Formate: 422, Eingang gelöscht, Foto bleibt unverarbeitet", async () => {
    const corrupt = await registerPhoto(a);
    await upload(a, corrupt.upload_path, new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 1, 2, 3]));
    expect(await invoke(a, { photo_id: corrupt.id })).toEqual({ status: 422, body: { error: "corrupt" } });
    expect(await inputExists(corrupt.upload_path)).toBe(false);

    const png = await registerPhoto(a);
    await upload(a, png.upload_path, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]));
    expect(await invoke(a, { photo_id: png.id })).toEqual({ status: 422, body: { error: "unsupported" } });
    const row = await admin.from("listing_photos").select("processed_at").eq("id", png.id).single();
    expect(row.data?.processed_at).toBeNull();
  });

  it("der Eingang nimmt kein PNG mehr an", async () => {
    const photo = await registerPhoto(a);
    const res = await userClient(fx, a).storage.from("listing-uploads").upload(photo.upload_path, new Uint8Array([0x89, 0x50]), { contentType: "image/png" });
    expect(res.error).not.toBeNull();
  });

  it("nach 3 Versuchen: 429, der Eingang bleibt für den Aufräumjob", async () => {
    const photo = await registerPhoto(a);
    await upload(a, photo.upload_path, encode(quadrants(64, 64)));
    await admin.from("listing_photos").update({ processing_attempts: 3 }).eq("id", photo.id);
    expect(await invoke(a, { photo_id: photo.id })).toEqual({ status: 429, body: { error: "attempts_exhausted" } });
    expect(await inputExists(photo.upload_path)).toBe(true);
  });

  it("neues Foto an freigegebener Anzeige: nach der Verarbeitung zurück in die Prüfung", async () => {
    // Zeile und Upload als Server, damit nur die Function den Status ändert.
    const row = await admin.from("listing_photos").insert({ listing_id: fx.ids.activeB, sort_order: 7 })
      .select("id, upload_path").single<{ id: string; upload_path: string }>();
    created.push(row.data!.id);
    activeStatusRestore = true;
    await admin.storage.from("listing-uploads").upload(row.data!.upload_path, encode(quadrants(64, 64)), { contentType: "image/jpeg" });
    const before = await admin.from("listings").select("status").eq("id", fx.ids.activeB).single();
    expect(before.data?.status).toBe("active");
    expect((await invoke(b, { photo_id: row.data!.id })).status).toBe(200);
    const after = await admin.from("listings").select("status").eq("id", fx.ids.activeB).single();
    expect(after.data?.status).toBe("pending_review");
  });
});
