// ADR 015: Regions-Slugs und Wildarten-Codes für Proxy und Filter ohne DB-Aufruf je Anfrage.
// Quelle sind die Referenzdaten der lokalen Datenbank (Migrationen), gelesen mit URL und anon-Key aus .env.local.
// Ein Integrationstest (web/integration/reference-data.test.ts) gleicht die Datei mit der DB ab.
import { writeFileSync } from "node:fs";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error("Fehlt: NEXT_PUBLIC_SUPABASE_URL oder NEXT_PUBLIC_SUPABASE_ANON_KEY (siehe web/.env.example).");
  process.exit(1);
}

async function rows(path) {
  const response = await fetch(`${url}/rest/v1/${path}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.json();
}

const regions = await rows("regions?select=id,code,slug,level,country,parent_id&order=code");
const species = await rows("game_species?select=code&order=code");
const byId = new Map(regions.map((r) => [r.id, r]));
const states = {};
for (const r of regions.filter((r) => r.level === "state")) states[r.slug] = { code: r.code, country: r.country, districts: {} };
for (const r of regions.filter((r) => r.level === "district")) states[byId.get(r.parent_id).slug].districts[r.slug] = r.code;

const data = { states, species: species.map((s) => s.code) };
writeFileSync(new URL("../lib/public/reference-data.json", import.meta.url), JSON.stringify(data, null, 1) + "\n");
console.log(`${Object.keys(states).length} Bundesländer, ${regions.length - Object.keys(states).length} Kreise, ${species.length} Wildarten`);
