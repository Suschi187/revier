import { describe, expect, it } from "vitest";
import data from "../lib/public/reference-data.json";
import { fixture, SKIPPED } from "./context";
import { anonClient } from "./helpers";

// ADR 015: Der Proxy prüft Regions-Slugs gegen lib/public/reference-data.json. Die Datei muss den Daten der
// Migrationen entsprechen (neu erzeugen mit `npm run gen:reference`).

const f = fixture();

describe.skipIf(!f)("Referenzdaten für URLs entsprechen der DB", () => {
  const fx = f ?? SKIPPED;

  it("Bundesländer, Kreise und Wildarten", async () => {
    const anon = anonClient(fx);
    const { data: regions } = await anon.from("regions").select("id, code, slug, level, country, parent_id").order("code");
    const { data: species } = await anon.from("game_species").select("code").order("code");
    const rows = regions ?? [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    const states: Record<string, { code: string; country: string; districts: Record<string, string> }> = {};
    for (const r of rows.filter((r) => r.level === "state")) states[r.slug] = { code: r.code, country: r.country, districts: {} };
    for (const r of rows.filter((r) => r.level === "district")) states[byId.get(r.parent_id)!.slug].districts[r.slug] = r.code;
    expect(data.states).toEqual(states);
    expect(data.species).toEqual((species ?? []).map((s) => s.code));
  });
});
