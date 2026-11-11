// Inventar aller Cookies und Browser-Speicher (ADR 021): eine Quelle für die Seite „Cookie-Einstellungen“, den
// Guard-Test und das E2E-Inventar (Akzeptanz b). Muster sind verankert (Review A10). Jede neue Abhängigkeit, die im
// Browser speichert, braucht hier einen Eintrag; Texte stehen unter `Cookies.entries.<id>` in den Message-Dateien.

export type ConsentCategory = "necessary" | "optional";
export type StorageKind = "cookie" | "localStorage" | "sessionStorage" | "indexedDB" | "cache";

export type InventoryEntry = {
  id: string;
  /** Verankertes Muster für den Namen; `null` bei Diensten ohne Speicher (Karte). */
  pattern: RegExp | null;
  kind: StorageKind | null;
  category: ConsentCategory;
  /** Höchste Laufzeit in Sekunden (`null`: Sitzung oder kein Speicher); das E2E prüft das Ablaufdatum dagegen. */
  maxAgeSeconds: number | null;
};

export const CONSENT_INVENTORY: readonly InventoryEntry[] = [
  {
    // @supabase/ssr, ADR 010: Laufzeit 400 Tage (Standard der Bibliothek), gelöscht beim Abmelden.
    id: "session",
    pattern: /^sb-[a-z0-9]+-auth-token(\.\d+)?$/,
    kind: "cookie",
    category: "necessary",
    maxAgeSeconds: 400 * 24 * 60 * 60,
  },
  {
    // PKCE-Verifier (auth-js ≥ 2.117): fester Schlüssel, ein Slot je Anmeldevorgang (`-flow-<32 hex>`) und der Index
    // der offenen Vorgänge (`-flows`). Entfernt nach dem Austausch des Codes, spätestens beim Abmelden; nach einer
    // Anmeldung per E-Mail-Code bleiben sie bis zum Abmelden liegen (gefunden im E2E, M9a).
    id: "pkce",
    pattern: /^sb-[a-z0-9]+-auth-token(?:-flow-[0-9a-f]{32}|-flows)?-code-verifier$/,
    kind: "cookie",
    category: "necessary",
    maxAgeSeconds: 400 * 24 * 60 * 60,
  },
  // Selbst gehostete Karte (ADR 016): eigener Dienst ohne Speicher im Browser, Kacheln nicht im Cache Storage.
  { id: "map", pattern: null, kind: null, category: "necessary", maxAgeSeconds: null },
];

/** Passender Eintrag für einen gefundenen Speicher, sonst `null` (dann gehört er ins Inventar oder weg). */
export function inventoryEntryFor(kind: StorageKind, name: string): InventoryEntry | null {
  return CONSENT_INVENTORY.find((e) => e.kind === kind && e.pattern !== null && e.pattern.test(name)) ?? null;
}

/** Ein Banner ist erst nötig, sobald ein Eintrag optional ist (ADR 021, Vertrag `revier_consent`). */
export function consentRequired(inventory: readonly InventoryEntry[] = CONSENT_INVENTORY): boolean {
  return inventory.some((e) => e.category === "optional");
}
