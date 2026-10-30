import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import path from "node:path";

// Aufräumen nach E2E-Läufen: Testkonten samt Dateien löschen, damit pgTAP-Zählungen ohne Reset stimmen
// (QA M2 F6, QA M3 F4). Nur gegen die lokale Supabase (127.0.0.1/localhost).

/** Lokale Supabase wie integration/env.ts (dort import.meta, das Playwright hier nicht lädt); nur 127.0.0.1/localhost. */
function readLocal(): { url: string; serviceKey: string } | null {
  try {
    const out = execFileSync("supabase", ["status", "-o", "env"], {
      cwd: path.resolve(process.cwd(), ".."), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 30_000,
    });
    const env = Object.fromEntries(
      out.split("\n").flatMap((line) => {
        const m = /^([A-Z0-9_]+)="?(.*?)"?$/.exec(line.trim());
        return m ? [[m[1], m[2]]] : [];
      }),
    );
    const url = env.API_URL;
    const serviceKey = env.SERVICE_ROLE_KEY || env.SECRET_KEY;
    if (!url || !serviceKey || !["127.0.0.1", "localhost"].includes(new URL(url).hostname)) return null;
    return { url, serviceKey };
  } catch {
    return null;
  }
}
export const local = readLocal();

export function admin() {
  if (!local) throw new Error("Lokale Supabase nicht erreichbar (supabase start im Repo-Root).");
  return createClient(local.url, local.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Löscht die Konten mit diesen E-Mail-Adressen samt Fotos, Eingang und Audit-Einträgen. */
export async function deleteTestUsers(emails: string[]): Promise<void> {
  if (!local || emails.length === 0) return;
  const client = admin();
  const { data } = await client.auth.admin.listUsers({ perPage: 1000 });
  const ids = (data?.users ?? []).filter((u) => u.email && emails.includes(u.email)).map((u) => u.id);
  for (const id of ids) {
    for (const bucket of ["listing-photos", "listing-uploads"]) {
      const { data: folders } = await client.storage.from(bucket).list(id);
      for (const folder of folders ?? []) {
        const { data: files } = await client.storage.from(bucket).list(`${id}/${folder.name}`);
        const paths = (files ?? []).map((f) => `${id}/${folder.name}/${f.name}`);
        if (paths.length) await client.storage.from(bucket).remove(paths);
      }
    }
    await client.from("audit_log").delete().eq("target_id", id);
    await client.auth.admin.deleteUser(id);
    // Die Kaskade auf Rollen erzeugt per Trigger neue Audit-Zeilen (ADR 014); auch die entfernen.
    await client.from("audit_log").delete().eq("target_id", id);
  }
}
