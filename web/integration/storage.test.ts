import { request as httpRequest } from "node:http";
import { describe, expect, it } from "vitest";
import { fixture, SKIPPED } from "./context";
import { anonClient, jpeg, serviceClient, userClient } from "./helpers";
import type { Fixture } from "./types";

// Storage über die echte API (ADR 009, Auflage QA M1): Jagdschein-Bucket nur für Besitzer und
// Admins (CLAUDE.md), Fotos nur für sichtbare Anzeigen. Jede Ablehnung hat eine Positivkontrolle.

const f = fixture();

/** Roher HTTP-Aufruf ohne URL-Normalisierung, damit `..` und `%2e%2e` wirklich beim Server ankommen. */
function rawStorage(
  fx: Fixture,
  method: string,
  rawPath: string,
  token: string,
  body?: Uint8Array,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  const base = new URL(fx.url);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: base.hostname,
        port: base.port,
        method,
        path: `/storage/v1/${rawPath}`,
        headers: { apikey: fx.publishableKey, Authorization: `Bearer ${token}`, ...headers },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

/** Alle Objektnamen eines Ordners (Sicht des Servers, unabhängig von RLS). */
async function serverList(fx: Fixture, bucket: string, folder: string): Promise<string[]> {
  const { data, error } = await serviceClient(fx).storage.from(bucket).list(folder, { limit: 1000 });
  if (error) throw error;
  return (data ?? []).map((entry) => entry.name).sort();
}

async function bytesOf(blob: Blob | null): Promise<number[]> {
  return blob ? Array.from(new Uint8Array(await blob.arrayBuffer())) : [];
}

describe.skipIf(!f)("Storage: Jagdschein-Bucket verification-docs", () => {
  const fx = f ?? SKIPPED;
  const { a, c } = fx.users;
  const docs = (client = userClient(fx, c)) => client.storage.from("verification-docs");

  it("Positivkontrolle: A erzeugt eine Signed URL für den eigenen Jagdschein und lädt ihn", async () => {
    const { data, error } = await docs(userClient(fx, a)).createSignedUrl(fx.paths.docA, 60);
    expect(error).toBeNull();
    const response = await fetch(data!.signedUrl);
    expect(response.status).toBe(200);
    expect(await bytesOf(await response.blob())).toEqual(await bytesOf(jpeg(2)));
  });

  it("C und anon erhalten keine Signed URL für den Jagdschein von A (einzeln und mehrfach)", async () => {
    for (const bucket of [docs(), anonClient(fx).storage.from("verification-docs")]) {
      const single = await bucket.createSignedUrl(fx.paths.docA, 60);
      expect(single.data).toBeNull();
      expect(single.error).not.toBeNull();
      const many = await bucket.createSignedUrls([fx.paths.docA], 60);
      expect(many.data?.every((entry) => entry.signedUrl === null || entry.error) ?? true).toBe(true);
    }
  });

  it("C lädt, prüft und sieht den Jagdschein von A nicht (download, info, exists, public, authenticated)", async () => {
    expect((await docs().download(fx.paths.docA)).data).toBeNull();
    expect((await docs().info(fx.paths.docA)).data).toBeNull();
    expect((await docs().exists(fx.paths.docA)).data).toBe(false);
    for (const route of ["object/public", "object/authenticated", "object"]) {
      const response = await rawStorage(fx, "GET", `${route}/verification-docs/${fx.paths.docA}`, c.token);
      expect(response.status, route).toBeGreaterThanOrEqual(400);
    }
    expect(docs().getPublicUrl(fx.paths.docA).data.publicUrl).toContain("/public/");
    expect((await fetch(docs().getPublicUrl(fx.paths.docA).data.publicUrl)).status).toBeGreaterThanOrEqual(400);
  });

  it("list zeigt C weder den Ordner von A noch fremde Dateien im Wurzelordner", async () => {
    expect((await docs().list(a.id)).data).toEqual([]);
    expect((await docs().list("")).data).toEqual([]);
    expect((await docs().list(a.id, { search: "jagd" })).data).toEqual([]);
    expect((await anonClient(fx).storage.from("verification-docs").list(a.id)).data ?? []).toEqual([]);
    // Positivkontrolle
    const own = await docs(userClient(fx, a)).list(a.id);
    expect(own.data?.map((entry) => entry.name)).toEqual(["jagdschein.jpg"]);
  });

  it("C kann den Jagdschein von A weder überschreiben (Upsert) noch löschen, kopieren oder verschieben", async () => {
    const upsert = await docs().upload(fx.paths.docA, jpeg(9), { contentType: "image/jpeg", upsert: true });
    expect(upsert.error).not.toBeNull();
    const update = await docs().update(fx.paths.docA, jpeg(9), { contentType: "image/jpeg" });
    expect(update.error).not.toBeNull();
    const removed = await docs().remove([fx.paths.docA]);
    expect(removed.data ?? []).toEqual([]);
    expect((await docs().copy(fx.paths.docA, `${c.id}/kopie.jpg`)).error).not.toBeNull();
    expect((await docs().move(fx.paths.docA, `${c.id}/verschoben.jpg`)).error).not.toBeNull();
    const intoPhotos = await docs().copy(fx.paths.docA, `${c.id}/${fx.ids.activeB}/x.jpg`, { destinationBucket: "listing-photos" });
    expect(intoPhotos.error).not.toBeNull();

    // Unverändert beim Besitzer, nichts bei C
    const original = await docs(userClient(fx, a)).download(fx.paths.docA);
    expect(await bytesOf(original.data)).toEqual(await bytesOf(jpeg(2)));
    expect(await serverList(fx, "verification-docs", c.id)).toEqual([]);
  });

  it("Auch der Besitzer überschreibt einen eingereichten Jagdschein nicht (kein UPDATE im Bucket)", async () => {
    const upsert = await docs(userClient(fx, a)).upload(fx.paths.docA, jpeg(8), { contentType: "image/jpeg", upsert: true });
    expect(upsert.error).not.toBeNull();
    const original = await docs(userClient(fx, a)).download(fx.paths.docA);
    expect(await bytesOf(original.data)).toEqual(await bytesOf(jpeg(2)));
  });

  it("Pfadtricks beim Upload landen nie im Ordner von A", async () => {
    const tricks = [
      `${a.id}/untergeschoben.jpg`,
      `${a.id.toUpperCase()}/untergeschoben.jpg`,
      `${c.id}/../${a.id}/untergeschoben.jpg`,
      `${c.id}/%2e%2e/${a.id}/untergeschoben.jpg`,
      `${c.id}/..%2F${a.id}/untergeschoben.jpg`,
      `${c.id}%2F..%2F${a.id}%2Funtergeschoben.jpg`,
      `./${a.id}/untergeschoben.jpg`,
      `${c.id}/..\\${a.id}/untergeschoben.jpg`,
    ];
    const body = new Uint8Array(await jpeg(7).arrayBuffer());
    // Positivkontrolle: derselbe rohe Aufruf in den eigenen Ordner klappt.
    const own = await rawStorage(fx, "POST", `object/verification-docs/${c.id}/eigen.jpg`, c.token, body, { "Content-Type": "image/jpeg" });
    expect(own.status).toBe(200);
    for (const path of tricks) {
      const response = await rawStorage(fx, "POST", `object/verification-docs/${path}`, c.token, body, {
        "Content-Type": "image/jpeg",
        "x-upsert": "true",
      });
      expect(response.status, path).toBeGreaterThanOrEqual(400);
    }
    // list vergleicht Präfixe ohne Groß-/Kleinschreibung, deckt also auch die UUID in Großbuchstaben ab.
    expect(await serverList(fx, "verification-docs", a.id)).toEqual(["jagdschein.jpg"]);
    expect(await serverList(fx, "verification-docs", c.id)).toEqual(["eigen.jpg"]);
  });

  it("Pfadtricks beim Signieren und Lesen liefern den Jagdschein von A nicht", async () => {
    const tricks = [
      `${c.id}/../${fx.paths.docA}`,
      `${c.id}/%2e%2e/${fx.paths.docA}`,
      `${c.id}%2F..%2F${fx.paths.docA}`,
      `./${fx.paths.docA}`,
      fx.paths.docA.toUpperCase(),
    ];
    const signBody = new TextEncoder().encode('{"expiresIn":60}');
    // Positivkontrolle: C signiert die eigene Datei aus dem vorigen Test.
    const own = await rawStorage(fx, "POST", `object/sign/verification-docs/${c.id}/eigen.jpg`, c.token, signBody, { "Content-Type": "application/json" });
    expect(own.status).toBe(200);
    for (const path of tricks) {
      const sign = await rawStorage(fx, "POST", `object/sign/verification-docs/${path}`, c.token, signBody, {
        "Content-Type": "application/json",
      });
      expect(sign.status, `sign ${path}`).toBeGreaterThanOrEqual(400);
      const read = await rawStorage(fx, "GET", `object/authenticated/verification-docs/${path}`, c.token);
      expect(read.status, `read ${path}`).toBeGreaterThanOrEqual(400);
    }
  });
});

describe.skipIf(!f)("Storage: Anzeigenfotos listing-photos", () => {
  const fx = f ?? SKIPPED;
  const { a, b, c } = fx.users;
  const photos = (client = userClient(fx, c)) => client.storage.from("listing-photos");

  it("Positivkontrolle: Foto der freigegebenen Anzeige von B ist für anon und C signierbar", async () => {
    for (const bucket of [photos(), anonClient(fx).storage.from("listing-photos")]) {
      const { data, error } = await bucket.createSignedUrl(fx.paths.activePhotoB, 60);
      expect(error).toBeNull();
      expect((await fetch(data!.signedUrl)).status).toBe(200);
    }
  });

  it("Foto eines fremden Entwurfs: keine Signed URL, kein Download, kein Listing für C und anon", async () => {
    for (const bucket of [photos(), anonClient(fx).storage.from("listing-photos")]) {
      expect((await bucket.createSignedUrl(fx.paths.draftPhotoA, 60)).data).toBeNull();
      expect((await bucket.download(fx.paths.draftPhotoA)).data).toBeNull();
      expect((await bucket.list(`${a.id}/${fx.ids.draftA}`)).data ?? []).toEqual([]);
      expect((await bucket.list(a.id)).data ?? []).toEqual([]);
    }
    // Positivkontrolle: der Besitzer sieht sein Entwurfsfoto
    expect((await photos(userClient(fx, a)).createSignedUrl(fx.paths.draftPhotoA, 60)).error).toBeNull();
  });

  it("C kopiert oder verschiebt fremde Fotos nicht in den eigenen Ordner und überschreibt sie nicht", async () => {
    expect((await photos().copy(fx.paths.draftPhotoA, `${c.id}/${fx.ids.draftA}/1.jpg`)).error).not.toBeNull();
    expect((await photos().copy(fx.paths.activePhotoB, `${c.id}/${fx.ids.activeB}/1.jpg`)).error).not.toBeNull();
    expect((await photos().move(fx.paths.activePhotoB, `${c.id}/${fx.ids.activeB}/1.jpg`)).error).not.toBeNull();
    expect((await photos().upload(fx.paths.activePhotoB, jpeg(9), { contentType: "image/jpeg", upsert: true })).error).not.toBeNull();
    expect((await photos().remove([fx.paths.activePhotoB, fx.paths.draftPhotoA])).data ?? []).toEqual([]);

    expect(await serverList(fx, "listing-photos", `${b.id}/${fx.ids.activeB}`)).toEqual(["1.jpg"]);
    expect(await serverList(fx, "listing-photos", `${a.id}/${fx.ids.draftA}`)).toEqual(["1.jpg"]);
    expect(await serverList(fx, "listing-photos", c.id)).toEqual([]);
    const original = await photos(userClient(fx, b)).download(fx.paths.activePhotoB);
    expect(await bytesOf(original.data)).toEqual(await bytesOf(jpeg(3)));
  });

  it("Upload ohne registriertes Foto und in fremde Anzeigen wird abgelehnt", async () => {
    // eigener Ordner, aber fremde bzw. nicht registrierte Anzeige
    expect((await photos().upload(`${c.id}/${fx.ids.activeB}/2.jpg`, jpeg(), { contentType: "image/jpeg" })).error).not.toBeNull();
    expect((await photos().upload(`${a.id}/${fx.ids.draftA}/2.jpg`, jpeg(), { contentType: "image/jpeg" })).error).not.toBeNull();
    // Auch der Besitzer braucht zuerst die Zeile in listing_photos (Limit 8)
    expect((await photos(userClient(fx, a)).upload(`${a.id}/${fx.ids.draftA}/9.jpg`, jpeg(), { contentType: "image/jpeg" })).error).not.toBeNull();
    expect(await serverList(fx, "listing-photos", `${a.id}/${fx.ids.draftA}`)).toEqual(["1.jpg"]);
  });

  it("HTML statt Bild wird abgelehnt (MIME-Allowlist)", async () => {
    const html = new Blob(["<script>alert(1)</script>"], { type: "text/html" });
    const result = await photos(userClient(fx, a)).upload(fx.paths.draftPhotoA, html, { contentType: "text/html", upsert: true });
    expect(result.error).not.toBeNull();
  });
});

describe.skipIf(!f)("Storage: Buckets", () => {
  const fx = f ?? SKIPPED;
  const storage = () => userClient(fx, fx.users.c).storage;

  it("Nutzer legen keine Buckets an und schalten keine öffentlich", async () => {
    expect((await storage().createBucket("it-evil", { public: true })).error).not.toBeNull();
    expect((await storage().updateBucket("verification-docs", { public: true })).error).not.toBeNull();
    expect((await storage().emptyBucket("verification-docs")).error).not.toBeNull();
    expect((await storage().deleteBucket("listing-photos")).error).not.toBeNull();
    const bucket = await serviceClient(fx).storage.getBucket("verification-docs");
    expect(bucket.data?.public).toBe(false);
    expect((await serviceClient(fx).storage.getBucket("it-evil")).data).toBeNull();
  });
});
