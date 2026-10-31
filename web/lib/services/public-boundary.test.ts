import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ADR 015, Review A11: Öffentliche Daten kommen nur über den Anon-Client ohne Cookies, mit festen Spalten.
// Sonst sähe ein eingeloggter Besitzer seine Anzeige in der Prüfung auf der öffentlichen URL, und Session-
// Daten landeten in "use cache".

const ROOT = join(__dirname, "..", "..");
const PUBLIC_MODULES = [
  "lib/services/public-listings.ts",
  "lib/services/regions.ts",
  "app/api/photos/[id]/[variant]/route.ts",
];

describe("Öffentliche Service-Schicht", () => {
  it.each(PUBLIC_MODULES)("%s nutzt keinen Session-Client und keine geschützten Tabellen", (file) => {
    const source = readFileSync(join(ROOT, file), "utf8");
    expect(source).not.toMatch(/lib\/supabase\/server|createSupabaseServerClient|next\/headers/);
    expect(source).not.toMatch(/select\(\s*["'`]\*/);
    expect(source).not.toMatch(/listing_places|display_location/);
    expect(source).not.toMatch(/SERVICE_ROLE|service_role|serviceKey/i);
  });

  it("Cache-Profil publicListings verfällt nach höchstens 5 Minuten", () => {
    const config = readFileSync(join(ROOT, "next.config.ts"), "utf8");
    expect(config).toMatch(/publicListings:\s*\{\s*stale:\s*60,\s*revalidate:\s*60,\s*expire:\s*300\s*\}/);
  });
});
