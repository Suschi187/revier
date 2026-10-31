import { describe, expect, it } from "vitest";
import fixtures from "../../supabase/tests/fixtures/search_filters.json";
import { fixture, SKIPPED } from "./context";
import { anonClient } from "./helpers";

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
