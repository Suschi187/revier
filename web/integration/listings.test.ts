import { afterAll, describe, expect, it } from "vitest";
import { fixture, SKIPPED } from "./context";
import { createSignedInUser, deleteUsers, rest, serviceClient, userClient } from "./helpers";

// Regeln für Anzeigen über die echte API (Plan M3 5.2 „Integration“, ADR 013): Kein Client-Weg führt am
// Guard vorbei (PATCH, POST, Upsert mit merge-duplicates, supabase-js upsert), die Bereitschaftsprüfung am
// Ende der Transaktion kommt als Fehler mit Feldcodes beim Client an, Fortsetzen nur ohne Änderung.

const f = fixture();

describe.skipIf(!f)("Anzeigen: Regeln über PostgREST", () => {
  const fx = f ?? SKIPPED;
  const { a, b } = fx.users;
  const admin = serviceClient(fx);
  const created: string[] = [];
  const users: string[] = [];

  afterAll(async () => {
    if (created.length) await admin.from("listings").delete().in("id", created);
    await deleteUsers(fx, users);
  });

  async function draft(fields: Record<string, unknown> = {}) {
    const res = await userClient(fx, a)
      .from("listings")
      .insert({ kind: "helper", direction: "offer", title: "Helfer gesucht", content_language: "de", region_id: fx.ids.district, ...fields })
      .select("id, status")
      .single<{ id: string; status: string }>();
    expect(res.error).toBeNull();
    created.push(res.data!.id);
    return res.data!.id;
  }

  async function ready(id: string) {
    const update = await userClient(fx, a)
      .from("listings")
      .update({ description: "Wir suchen Hilfe beim Ansitzbau im Frühjahr, zwei Wochenenden.", attributes: { tasks: ["Ansitzbau"] } })
      .eq("id", id)
      .select("id");
    expect(update.error).toBeNull();
    const place = await userClient(fx, a).rpc("set_listing_location", {
      p_listing_id: id, p_region_id: fx.ids.district, p_postal_code: "01067", p_place_name: "Dresden",
    });
    expect(place.error).toBeNull();
  }

  const status = async (id: string) =>
    (await admin.from("listings").select("status").eq("id", id).single<{ status: string }>()).data?.status;

  it("kein Weg zu active: POST, PATCH, Upsert mit merge-duplicates, supabase-js upsert", async () => {
    const post = await rest(fx, "listings", {
      token: a.token, method: "POST",
      body: { kind: "helper", direction: "offer", title: "Direkt aktiv", content_language: "de", region_id: fx.ids.district, status: "active" },
    });
    expect(post.status).toBe(403);
    expect(((await post.json()) as { code: string }).code).toBe("42501");

    const id = await draft();
    const patch = await userClient(fx, a).from("listings").update({ status: "active" }).eq("id", id).select("id");
    expect(patch.error?.code).toBe("42501");

    // Upsert über die id einer fremden, aktiven Anzeige und über die eigene: Spaltenrecht auf id fehlt.
    const merge = await rest(fx, "listings?on_conflict=id", {
      token: a.token, method: "POST", headers: { Prefer: "resolution=merge-duplicates" },
      body: { id: fx.ids.activeB, kind: "helper", direction: "offer", title: "Übernommen", content_language: "de", region_id: fx.ids.district, status: "active" },
    });
    expect(merge.ok).toBe(false);
    const upsert = await userClient(fx, a)
      .from("listings")
      .upsert({ id, kind: "helper", direction: "offer", title: "Upsert aktiv", content_language: "de", region_id: fx.ids.district, status: "active" });
    expect(upsert.error).not.toBeNull();

    expect(await status(id)).toBe("draft");
    expect(await status(fx.ids.activeB)).toBe("active");
  });

  it("Absenden ohne Pflichtfelder: 23514 mit Feldcodes, erst am Ende der Transaktion geprüft", async () => {
    const id = await draft();
    const submit = await userClient(fx, a).from("listings").update({ status: "pending_review" }).eq("id", id).select("id");
    expect(submit.error?.code).toBe("23514");
    expect(JSON.parse(submit.error!.hint!)).toEqual({
      fields: ["description.length", "place.postal_code.required", "place.place_name.required", "attributes.tasks"],
    });
    expect(await status(id)).toBe("draft");

    await ready(id);
    const ok = await userClient(fx, a).from("listings").update({ status: "pending_review" }).eq("id", id).select("status").single();
    expect(ok.error).toBeNull();
    expect(ok.data).toEqual({ status: "pending_review" });
  });

  it("falsche Attribute und PLZ eines anderen Kreises: Feldcodes ohne Werte", async () => {
    const id = await draft();
    const bad = await userClient(fx, a).from("listings").update({ attributes: { tasks: [], foo: 1 } }).eq("id", id).select("id");
    expect(bad.error?.code).toBe("23514");
    expect(JSON.parse(bad.error!.hint!)).toEqual({ fields: ["attributes.unknown"] });

    await ready(id);
    // 80331 (München) passt nicht zum Kreis der Fixtures (Dresden)
    const place = await userClient(fx, a).rpc("set_listing_location", {
      p_listing_id: id, p_region_id: fx.ids.district, p_postal_code: "80331", p_place_name: "München",
    });
    expect(place.error).toBeNull(); // Entwurf: nur Format geprüft
    const submit = await userClient(fx, a).from("listings").update({ status: "pending_review" }).eq("id", id).select("id");
    expect(JSON.parse(submit.error!.hint!)).toEqual({ fields: ["place.postal_code.region_mismatch"] });
    expect(JSON.stringify(submit.error)).not.toContain("80331");
  });

  it("Fortsetzen nur ohne Änderung seit der Freigabe", async () => {
    const id = await draft();
    await ready(id);
    await userClient(fx, a).from("listings").update({ status: "pending_review" }).eq("id", id);
    // Freigabe durch den Server (die Admin-Freigabe mit 2FA prüft pgTAP)
    expect((await admin.from("listings").update({ status: "active", expires_at: new Date(Date.now() + 86_400_000).toISOString() }).eq("id", id)).error).toBeNull();

    await userClient(fx, a).from("listings").update({ status: "paused" }).eq("id", id);
    await userClient(fx, a).from("listings").update({ status: "active" }).eq("id", id);
    expect(await status(id)).toBe("active");

    await userClient(fx, a).from("listings").update({ status: "paused" }).eq("id", id);
    await admin.from("listings").update({ title: "Vom Server geändert" }).eq("id", id);
    const resume = await userClient(fx, a).from("listings").update({ status: "active" }).eq("id", id).select("status").single();
    expect(resume.data).toEqual({ status: "pending_review" });
  });

  it("Hinweis auf Waffenbegriffe: eigene Anzeige ja, fremde nein; Absenden bleibt möglich", async () => {
    const id = await draft({ title: "Helfer, Munition wird gestellt" });
    const own = await userClient(fx, a).rpc("listing_content_hints", { p_listing_id: id });
    expect(own.data).toEqual([{ field: "title", term: "Munition", language: "de", category: "ammunition" }]);
    const foreign = await userClient(fx, b).rpc("listing_content_hints", { p_listing_id: id });
    expect(foreign.data).toEqual([]);
    await ready(id);
    const submit = await userClient(fx, a).from("listings").update({ status: "pending_review" }).eq("id", id).select("id");
    expect(submit.error).toBeNull();
  });

  it("ohne Zustimmung zu den Rechtstexten: RV001 beim Anlegen", async () => {
    const d = await createSignedInUser(fx, "nolegal");
    users.push(d.id);
    const res = await d.client
      .from("listings")
      .insert({ kind: "helper", direction: "offer", title: "Ohne Zustimmung", content_language: "de", region_id: fx.ids.district });
    expect(res.error?.code).toBe("RV001");
  });
});
