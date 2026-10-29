import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixture, SKIPPED } from "./context";
import { anonClient, exactCount, rest, serviceClient, userClient } from "./helpers";

// PLZ und Ort je Anzeige über die echte API (ADR 012, Review Plan M3 PLZ 1–2): nie öffentlich,
// auch nicht über Embedding, Filter oder Zählungen; öffentlich ist nur postal_prefix.

const f = fixture();

describe.skipIf(!f)("Ort der Anzeige: listing_places per PostgREST", () => {
  const fx = f ?? SKIPPED;
  const { a, b } = fx.users;
  const postalCode = "01067";
  const placeName = "Dresden-Altstadt";

  beforeAll(async () => {
    // Als Server, damit die freigegebene Anzeige von B aktiv bleibt.
    const res = await serviceClient(fx).from("listing_places").insert({ listing_id: fx.ids.activeB, postal_code: postalCode, place_name: placeName });
    expect(res.error).toBeNull();
  });

  afterAll(async () => {
    await serviceClient(fx).from("listing_places").delete().eq("listing_id", fx.ids.activeB);
    await serviceClient(fx).from("listings").update({ postal_prefix: null }).eq("id", fx.ids.activeB);
  });

  it("anon sieht nur das Präfix, Embedding von listing_places verrät nichts", async () => {
    const listing = await anonClient(fx).from("listings").select("id, postal_prefix").eq("id", fx.ids.activeB).single<{ postal_prefix: string }>();
    expect(listing.data?.postal_prefix).toBe("01");
    const embedded = await rest(fx, `listings?select=id,listing_places(*)&id=eq.${fx.ids.activeB}`);
    const text = await embedded.text();
    expect(text).not.toContain(postalCode);
    expect(text).not.toContain(placeName);
    const direct = await rest(fx, "listing_places?select=*");
    expect(direct.ok).toBe(false);
  });

  it("Fremde sehen nichts, auch nicht über Filter oder Zählungen", async () => {
    const embedded = await rest(fx, `listings?select=id,listing_places(*)&id=eq.${fx.ids.activeB}`, { token: a.token });
    const text = await embedded.text();
    expect(text).not.toContain(postalCode);
    expect(text).not.toContain(placeName);
    expect(await exactCount(fx, `listing_places?postal_code=eq.${postalCode}`, a.token)).toBe(0);
    expect(await exactCount(fx, `listings?listing_places.postal_code=eq.${postalCode}&select=id,listing_places!inner(listing_id)`, a.token)).toBe(0);
  });

  it("der Besitzer liest seinen Ort", async () => {
    const own = await userClient(fx, b).from("listing_places").select("postal_code, place_name").eq("listing_id", fx.ids.activeB).single();
    expect(own.data).toEqual({ postal_code: postalCode, place_name: placeName });
  });

  it("RPC: fremde und unbekannte Anzeigen geben dieselbe Antwort, ohne Werte", async () => {
    const args = { p_region_id: fx.ids.district, p_postal_code: "01069", p_place_name: "Dresden" };
    const foreign = await userClient(fx, a).rpc("set_listing_location", { p_listing_id: fx.ids.activeB, ...args });
    const unknown = await userClient(fx, a).rpc("set_listing_location", { p_listing_id: crypto.randomUUID(), ...args });
    expect(foreign.error?.code).toBe("42501");
    expect(unknown.error).toEqual(foreign.error);
    expect(JSON.stringify(foreign.error)).not.toContain("01069");
  });

  it("Formatfehler nennt nur den Feldcode", async () => {
    const res = await userClient(fx, a).rpc("set_listing_location", {
      p_listing_id: fx.ids.draftA, p_region_id: fx.ids.district, p_postal_code: "1067", p_place_name: "Dresden",
    });
    expect(res.error?.code).toBe("23514");
    expect(res.error?.hint).toBe("place.postal_code.format");
    expect(JSON.stringify(res.error)).not.toContain("1067");
  });
});
