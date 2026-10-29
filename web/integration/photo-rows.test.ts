import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fixture, SKIPPED } from "./context";
import { acceptLegal, anonClient, createSignedInUser, deleteUsers, jpeg, rest, serviceClient, userClient } from "./helpers";
import type { TestUser } from "./types";

// Fotozeilen, Eingang und Tageslimit über die echte API (ADR 011, Migration listing_photo_processing,
// QA M3 Zwischenstand). Ergänzt storage.test.ts um Spaltenrechte per PostgREST, Wege zum Original
// (copy/move/Signed Upload URL) und das Tageslimit (Löschen + Neuanlegen, parallel, Bulk).

const f = fixture();

describe.skipIf(!f)("Fotos: Spaltenrechte und Sichtbarkeit per PostgREST", () => {
  const fx = f ?? SKIPPED;
  const { a, c } = fx.users;
  let photoId = "";
  let hiddenId = "";

  beforeAll(async () => {
    const row = await userClient(fx, a).from("listing_photos").insert({ listing_id: fx.ids.draftA, sort_order: 5 }).select("id").single<{ id: string }>();
    photoId = row.data!.id;
    // Unverarbeitete Zeile an der freigegebenen Anzeige von B, wie sie zwischen Upload und Verarbeitung existiert.
    const hidden = await serviceClient(fx).from("listing_photos").insert({ listing_id: fx.ids.activeB, sort_order: 7 }).select("id").single<{ id: string }>();
    hiddenId = hidden.data!.id;
  });

  afterAll(async () => {
    await serviceClient(fx).from("listing_photos").delete().in("id", [photoId, hiddenId].filter(Boolean));
  });

  it("Insert mit Server-Spalten wird abgelehnt (processed_at, width, height, Pfade, id)", async () => {
    const extra: Record<string, unknown>[] = [
      { processed_at: new Date().toISOString() },
      { width: 10, height: 10 },
      { storage_path: `${a.id}/${fx.ids.draftA}/x.jpg` },
      { upload_path: `${a.id}/${fx.ids.draftA}/x` },
      { thumb_path: `${a.id}/${fx.ids.draftA}/x_thumb.jpg` },
      { id: crypto.randomUUID() },
    ];
    for (const columns of extra) {
      const res = await userClient(fx, a).from("listing_photos").insert({ listing_id: fx.ids.draftA, sort_order: 6, ...columns });
      expect(res.error?.code, JSON.stringify(columns)).toBe("42501");
    }
  });

  it("PATCH der Server-Spalten wird abgelehnt, Alt-Text und Reihenfolge gehen (Positivkontrolle)", async () => {
    for (const columns of [{ processed_at: new Date().toISOString() }, { width: 1 }, { storage_path: "x" }, { upload_path: "x" }, { thumb_path: "x" }, { listing_id: fx.ids.activeB }]) {
      const res = await userClient(fx, a).from("listing_photos").update(columns).eq("id", photoId);
      expect(res.error?.code, JSON.stringify(columns)).toBe("42501");
    }
    const ok = await userClient(fx, a).from("listing_photos").update({ alt_text: "Kanzel", sort_order: 4 }).eq("id", photoId).select("id");
    expect(ok.error).toBeNull();
    expect(ok.data).toHaveLength(1);
  });

  it("Upsert über die id einer fremden Fotozeile scheitert (merge-duplicates)", async () => {
    const res = await rest(fx, "listing_photos?on_conflict=id", {
      token: a.token,
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: { id: hiddenId, listing_id: fx.ids.draftA, sort_order: 0 },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    const { data } = await serviceClient(fx).from("listing_photos").select("listing_id").eq("id", hiddenId).single<{ listing_id: string }>();
    expect(data!.listing_id).toBe(fx.ids.activeB);
  });

  it("Unverarbeitete Fotozeilen einer freigegebenen Anzeige sehen weder anon noch C (direkt und per Embedding)", async () => {
    for (const client of [anonClient(fx), userClient(fx, c)]) {
      const direct = await client.from("listing_photos").select("id").eq("listing_id", fx.ids.activeB);
      expect(direct.data?.map((r) => r.id)).not.toContain(hiddenId);
      expect(direct.data?.length).toBeGreaterThan(0); // Positivkontrolle: verarbeitetes Foto sichtbar
      const embedded = await client.from("listings").select("id, listing_photos(id)").eq("id", fx.ids.activeB).single<{ listing_photos: { id: string }[] }>();
      expect(embedded.data!.listing_photos.map((p) => p.id)).not.toContain(hiddenId);
    }
  });
});

describe.skipIf(!f)("Fotos: kein Weg zum Original im Eingang", () => {
  const fx = f ?? SKIPPED;
  const { a, c } = fx.users;
  let photo: { id: string; upload_path: string; storage_path: string } | null = null;
  let second: { id: string; upload_path: string } | null = null;

  beforeAll(async () => {
    const client = userClient(fx, a);
    photo = (await client.from("listing_photos").insert({ listing_id: fx.ids.draftA, sort_order: 2 }).select("id, upload_path, storage_path").single()).data;
    second = (await client.from("listing_photos").insert({ listing_id: fx.ids.draftA, sort_order: 3 }).select("id, upload_path").single()).data;
    const up = await client.storage.from("listing-uploads").upload(photo!.upload_path, jpeg(4), { contentType: "image/jpeg" });
    expect(up.error).toBeNull();
  });

  afterAll(async () => {
    const admin = serviceClient(fx);
    await admin.storage.from("listing-uploads").remove([photo?.upload_path, second?.upload_path].filter(Boolean) as string[]);
    await admin.storage.from("listing-photos").remove([photo?.storage_path].filter(Boolean) as string[]);
    await admin.from("listing_photos").delete().in("id", [photo?.id, second?.id].filter(Boolean) as string[]);
  });

  it("Besitzer kopiert oder verschiebt das Original weder nach listing-photos noch innerhalb des Eingangs", async () => {
    const uploads = userClient(fx, a).storage.from("listing-uploads");
    expect((await uploads.copy(photo!.upload_path, photo!.storage_path, { destinationBucket: "listing-photos" })).error).not.toBeNull();
    expect((await uploads.move(photo!.upload_path, photo!.storage_path, { destinationBucket: "listing-photos" })).error).not.toBeNull();
    expect((await uploads.copy(photo!.upload_path, second!.upload_path)).error).not.toBeNull();
    expect((await uploads.move(photo!.upload_path, second!.upload_path)).error).not.toBeNull();
    const server = await serviceClient(fx).storage.from("listing-photos").list(`${a.id}/${fx.ids.draftA}`);
    expect(server.data?.map((e) => e.name)).not.toContain(photo!.storage_path.split("/").pop());
  });

  it("Signed Upload URL gibt es nicht für listing-photos; info/exists verraten das Original nicht", async () => {
    const photos = userClient(fx, a).storage.from("listing-photos");
    expect((await photos.createSignedUploadUrl(photo!.storage_path)).error).not.toBeNull();
    for (const user of [a, c]) {
      const uploads = userClient(fx, user).storage.from("listing-uploads");
      expect((await uploads.info(photo!.upload_path)).data).toBeNull();
      expect((await uploads.exists(photo!.upload_path)).data).toBe(false);
      expect((await uploads.createSignedUrls([photo!.upload_path], 60)).data?.every((e) => !e.signedUrl) ?? true).toBe(true);
    }
    const pub = await fetch(anonClient(fx).storage.from("listing-uploads").getPublicUrl(photo!.upload_path).data.publicUrl);
    expect(pub.status).toBeGreaterThanOrEqual(400);
  });

  it("Signed Upload URL im Eingang ist nur für den eigenen registrierten Pfad zu haben", async () => {
    const own = await userClient(fx, a).storage.from("listing-uploads").createSignedUploadUrl(second!.upload_path);
    expect(own.error).toBeNull(); // Positivkontrolle
    expect((await userClient(fx, c).storage.from("listing-uploads").createSignedUploadUrl(second!.upload_path)).error).not.toBeNull();
    expect((await userClient(fx, a).storage.from("listing-uploads").createSignedUploadUrl(`${a.id}/${fx.ids.draftA}/frei`)).error).not.toBeNull();
  });
});

describe.skipIf(!f)("Fotos: Tageslimit 100 (RV002)", () => {
  const fx = f ?? SKIPPED;
  let d: (TestUser & { client: SupabaseClient }) | null = null;
  const listings: string[] = [];

  beforeAll(async () => {
    d = await createSignedInUser(fx, "photolimit");
    await acceptLegal(d.client);
    for (let i = 0; i < 13; i++) {
      const res = await d.client
        .from("listings")
        .insert({ kind: "helper", direction: "wanted", title: `QA Limit ${i}`, content_language: "de", region_id: fx.ids.district })
        .select("id")
        .single<{ id: string }>();
      listings.push(res.data!.id);
    }
  }, 60_000);

  afterAll(async () => {
    if (d) await deleteUsers(fx, [d.id]);
  });

  // sort_order (0–7) ist je Anzeige eindeutig; freie Plätze fortlaufend vergeben, damit nur das Limit greift.
  const next = new Map<string, number>();
  const add = (listing: string, n = 1) => {
    const start = next.get(listing) ?? 0;
    next.set(listing, start + n);
    return d!.client.from("listing_photos").insert(Array.from({ length: n }, (_, i) => ({ listing_id: listing, sort_order: start + i }))).select("id");
  };

  it("Löschen und Neuanlegen, parallele Inserts und Bulk-Inserts umgehen das Limit nicht", async () => {
    // 11 × 8 + 4 = 92 angelegt
    for (let i = 0; i < 11; i++) expect((await add(listings[i], 8)).error).toBeNull();
    expect((await add(listings[11], 4)).error).toBeNull();
    // Alle Fotos der ersten Anzeige löschen: der Zähler bleibt bei 92
    expect((await d!.client.from("listing_photos").delete().eq("listing_id", listings[0])).error).toBeNull();
    next.set(listings[0], 0);
    expect((await add(listings[0], 3)).error).toBeNull(); // 95

    // 10 parallele Einzel-Inserts auf zwei Anzeigen mit genug Platz: genau 5 dürfen durch
    const results = await Promise.all([
      ...Array.from({ length: 5 }, () => add(listings[0])),
      ...Array.from({ length: 5 }, () => add(listings[12])),
    ]);
    const ok = results.filter((r) => !r.error).length;
    expect(ok).toBe(5);
    expect(results.filter((r) => r.error).every((r) => r.error!.code === "RV002")).toBe(true);

    // Über dem Limit: auch nach Löschen und als Bulk nichts mehr, und der Bulk legt nichts teilweise an
    expect((await d!.client.from("listing_photos").delete().eq("listing_id", listings[12])).error).toBeNull();
    next.set(listings[12], 0);
    expect((await add(listings[12])).error?.code).toBe("RV002");
    expect((await add(listings[12], 2)).error?.code).toBe("RV002");
    const left = await serviceClient(fx).from("listing_photos").select("id", { count: "exact", head: true }).eq("listing_id", listings[12]);
    expect(left.count).toBe(0);
  }, 60_000);
});
