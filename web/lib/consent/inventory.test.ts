import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONSENT_INVENTORY, consentRequired, inventoryEntryFor } from "./inventory";

const root = join(__dirname, "..", "..");
const LOCALES = ["en", "de", "cs", "pl"] as const;

describe("Cookie-Inventar (ADR 021)", () => {
  it("Guard: ein optionaler Eintrag braucht einen eingebundenen Banner", () => {
    const banner = join(root, "components", "consent", "ConsentBanner.tsx");
    const layout = readFileSync(join(root, "app", "[locale]", "layout.tsx"), "utf8");
    if (consentRequired()) {
      expect(existsSync(banner), "components/consent/ConsentBanner.tsx fehlt").toBe(true);
      expect(layout, "Banner nicht im Root-Layout eingebunden").toContain("<ConsentBanner");
    } else {
      expect(CONSENT_INVENTORY.every((e) => e.category === "necessary")).toBe(true);
    }
  });

  it("erkennt optionale Einträge", () => {
    expect(consentRequired([{ id: "x", pattern: /^x$/, kind: "cookie", category: "optional", maxAgeSeconds: 1 }])).toBe(true);
  });

  it("Muster sind verankert (Review A10)", () => {
    for (const entry of CONSENT_INVENTORY) {
      if (entry.pattern === null) {
        expect(entry.kind, entry.id).toBeNull();
        continue;
      }
      expect(entry.pattern.source.startsWith("^"), entry.id).toBe(true);
      expect(entry.pattern.source.endsWith("$"), entry.id).toBe(true);
      expect(entry.pattern.flags, entry.id).toBe("");
    }
  });

  it("ordnet Supabase-Cookies zu und sonst nichts", () => {
    expect(inventoryEntryFor("cookie", "sb-127-auth-token")?.id).toBe("session");
    expect(inventoryEntryFor("cookie", "sb-abcdefghijklmnopqrst-auth-token.1")?.id).toBe("session");
    expect(inventoryEntryFor("cookie", "sb-127-auth-token-code-verifier")?.id).toBe("pkce");
    expect(inventoryEntryFor("cookie", "sb-127-auth-token-flow-c57cdc668b766aaae921c69092375b2b-code-verifier")?.id).toBe("pkce");
    expect(inventoryEntryFor("cookie", "sb-127-auth-token-flows-code-verifier")?.id).toBe("pkce");
    expect(inventoryEntryFor("cookie", "sb-127-auth-token-flow-xyz-code-verifier")).toBeNull();
    expect(inventoryEntryFor("cookie", "NEXT_LOCALE")).toBeNull();
    expect(inventoryEntryFor("cookie", "xsb-127-auth-token")).toBeNull();
    expect(inventoryEntryFor("cookie", "sb-127-auth-token.x")).toBeNull();
    expect(inventoryEntryFor("localStorage", "sb-127-auth-token")).toBeNull();
  });

  it("jeder Eintrag hat Texte in allen Sprachen", () => {
    for (const locale of LOCALES) {
      const messages = JSON.parse(readFileSync(join(root, "messages", `${locale}.json`), "utf8"));
      for (const entry of CONSENT_INVENTORY) {
        const text = messages.Cookies.entries[entry.id];
        for (const key of ["name", "purpose", "provider", "duration"]) expect(text?.[key], `${locale} ${entry.id}.${key}`).toBeTruthy();
      }
    }
  });

  it("kein Sprach-Cookie (QA M0 F7)", () => {
    expect(readFileSync(join(root, "i18n", "routing.ts"), "utf8")).toMatch(/localeCookie:\s*false/);
  });
});
