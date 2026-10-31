import { describe, expect, it } from "vitest";
import fixtures from "../../supabase/tests/fixtures/search_filters.json";
import { fixture, SKIPPED } from "./context";
import { anonClient, serviceClient } from "./helpers";

// Filterformat v1 (ADR 015): Die RPC urteilt über jede Fixture wie Zod (web/lib/search/filters.test.ts).
// Aufgerufen als anon über PostgREST, wie Web und iOS es tun.

const f = fixture();

describe.skipIf(!f)("Suche: Filterprüfung der RPC", () => {
  const fx = f ?? SKIPPED;

  it.each(fixtures.cases)("$name → $error", async (c) => {
    const { data, error } = await anonClient(fx).rpc("search_listings", { p_filters: c.filters, p_limit: 1 });
    if (c.error === null) {
      expect(error).toBeNull();
      expect(data).toHaveProperty("items");
    } else {
      expect(error?.code).toBe("22023");
      expect(error?.hint).toBe(c.error);
    }
  });

  it("liefert keine PLZ, keinen Ort und keinen Punkt", async () => {
    const { data, error } = await anonClient(fx).rpc("search_listings", { p_filters: { v: 1 }, p_limit: 50 });
    expect(error).toBeNull();
    for (const item of (data as { items: Record<string, unknown>[] }).items) {
      expect(Object.keys(item)).not.toEqual(expect.arrayContaining(["postal_code"]));
      expect(item).not.toHaveProperty("place_name");
      expect(item).not.toHaveProperty("display_location");
    }
  });
});

describe.skipIf(!f)("Suche, Zustand und Anbieter über PostgREST", () => {
  const fx = f ?? SKIPPED;
  const { c } = fx.users;

  it("Freigegebene Anzeige ist auffindbar, nach dem Pausieren nicht mehr und dann „gone“", async () => {
    const service = serviceClient(fx);
    const title = `Integration Suche ${Date.now()}`;
    const { data: row, error } = await service
      .from("listings")
      .insert({ owner_id: c.id, kind: "helper", direction: "wanted", title, content_language: "de", region_id: fx.ids.district,
                status: "active", expires_at: new Date(Date.now() + 86_400_000).toISOString() })
      .select("id")
      .single<{ id: string }>();
    expect(error).toBeNull();
    try {
      const anon = anonClient(fx);
      const hit = await anon.rpc("search_listings", { p_filters: { v: 1, q: title }, p_limit: 5 });
      expect((hit.data as { items: { id: string }[] }).items.map((i) => i.id)).toEqual([row!.id]);
      expect((await anon.rpc("public_page_state", { p_kind: "listing", p_id: row!.id })).data).toBe("public");
      expect((await anon.rpc("public_page_state", { p_kind: "provider", p_id: c.id })).data).toBe("public");
      const own = await anon.rpc("provider_listings", { p_owner: c.id });
      expect((own.data as { items: { id: string }[] }).items.map((i) => i.id)).toContain(row!.id);

      await service.from("listings").update({ status: "paused" }).eq("id", row!.id);
      const miss = await anon.rpc("search_listings", { p_filters: { v: 1, q: title }, p_limit: 5 });
      expect((miss.data as { items: unknown[] }).items).toEqual([]);
      expect((await anon.rpc("public_page_state", { p_kind: "listing", p_id: row!.id })).data).toBe("gone");
    } finally {
      await service.from("listings").delete().eq("id", row!.id);
    }
  });

  it("Cache-Zähler ist für anon lesbar", async () => {
    const { data, error } = await anonClient(fx).rpc("public_cache_epoch");
    expect(error).toBeNull();
    expect(typeof data).toBe("number");
  });
});
