import { inject } from "vitest";
import type { Fixture, TestUser } from "./types";

/** Fixture aus dem globalen Setup; `null`, wenn keine lokale Supabase läuft (Tests werden übersprungen). */
export function fixture(): Fixture | null {
  return inject("supabaseFixture");
}

const nobody: TestUser = { id: "", email: "", token: "" };

/**
 * Platzhalter für übersprungene Suiten: `describe.skipIf` führt den Suite-Callback zum Einsammeln
 * trotzdem aus, die Tests selbst laufen nicht.
 */
export const SKIPPED: Fixture = {
  url: "http://127.0.0.1:9",
  // Nicht leer: Testdateien bauen Clients schon beim Einsammeln, createClient wirft bei leerem Schlüssel,
  // statt die Datei überspringen zu lassen (QA M3 F10).
  publishableKey: "skipped",
  serviceKey: "skipped",
  users: { a: nobody, b: nobody, c: nobody },
  ids: { district: "", draftA: "", activeB: "", conversation: "", message: "", verificationA: "" },
  paths: { docA: "", draftPhotoA: "", activePhotoB: "" },
};
