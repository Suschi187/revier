import { afterAll, describe, expect, it } from "vitest";
import fixtures from "../../supabase/tests/fixtures/listing_rules.json";
import { fixture, SKIPPED } from "./context";
import { serviceClient, userClient } from "./helpers";
import { fieldsFromHint } from "@/lib/validation/listing";

// Dieselben Fälle wie web/lib/validation/listing.test.ts, hier gegen die Datenbank (ADR 013): Zod und DB
// müssen für jede Fixture dieselben Feldcodes liefern.

const f = fixture();

describe.skipIf(!f)("Anzeigenregeln: DB und Zod urteilen gleich", () => {
  const fx = f ?? SKIPPED;
  const { a } = fx.users;
  const created: string[] = [];

  afterAll(async () => {
    if (created.length) await serviceClient(fx).from("listings").delete().in("id", created);
  });

  async function draft(kind: string, direction = "offer") {
    const res = await userClient(fx, a)
      .from("listings")
      .insert({ kind, direction, title: "Paritätstest", content_language: "de", region_id: fx.ids.district })
      .select("id")
      .single<{ id: string }>();
    expect(res.error).toBeNull();
    created.push(res.data!.id);
    return res.data!.id;
  }

  it.each(fixtures.readiness)("Bereitschaft: $name", async (fx_) => {
    const client = userClient(fx, a);
    const id = await draft(fx_.listing.kind, fx_.listing.direction);
    const update = await client
      .from("listings")
      .update({ description: fx_.listing.description, area_hectares: fx_.listing.area_hectares, attributes: fx_.listing.attributes })
      .eq("id", id)
      .select("id");
    expect(update.error).toBeNull();
    if (fx_.species) expect((await client.from("listing_species").insert({ listing_id: id, species_code: "roe_deer" })).error).toBeNull();
    if (fx_.place) {
      const place = await client.rpc("set_listing_location", {
        p_listing_id: id, p_region_id: fx.ids.district, p_postal_code: fx_.place.postal_code, p_place_name: fx_.place.place_name,
      });
      expect(place.error).toBeNull();
    }
    const submit = await client.from("listings").update({ status: "pending_review" }).eq("id", id).select("id");
    if (fx_.expected.length === 0) expect(submit.error).toBeNull();
    else {
      expect(submit.error?.code).toBe("23514");
      expect(fieldsFromHint(submit.error?.hint)).toEqual(fx_.expected);
    }
  });

  it.each(fixtures.attributes)("Attribute: $kind $attributes", async (fx_) => {
    const id = await draft(fx_.kind);
    const res = await userClient(fx, a).from("listings").update({ attributes: fx_.attributes }).eq("id", id).select("id");
    if (fx_.expected === null) expect(res.error).toBeNull();
    else expect(fieldsFromHint(res.error?.hint)).toEqual([fx_.expected]);
  });
});
