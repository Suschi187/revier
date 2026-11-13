// Einmaliges Nachberechnen der mittleren Größe (Migration 20261113140000) für Fotos, die vorher verarbeitet wurden.
// Kein Teil der Edge Function. Aufruf von Hand; den Service-Role-Schlüssel nur in der Shell setzen, nie im Repo:
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… deno run --allow-env --allow-net backfill_medium.ts
// Bereits vorhandene Dateien werden übersprungen, der Lauf ist also wiederholbar. Logs nur mit Foto-id.
import { createClient } from "@supabase/supabase-js";
import { mediumFromProcessed } from "./pipeline.ts";

const PAGE = 500;
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const photos = admin.storage.from("listing-photos");
const counts = { created: 0, existing: 0, failed: 0 };

async function exists(path: string): Promise<boolean> {
  const slash = path.lastIndexOf("/");
  const name = path.slice(slash + 1);
  const { data, error } = await photos.list(path.slice(0, slash), { search: name, limit: 10 });
  if (error) throw error;
  return data.some((entry) => entry.name === name);
}

for (let from = 0; ; from += PAGE) {
  const { data, error } = await admin
    .from("listing_photos")
    .select("id, storage_path, medium_path")
    .not("processed_at", "is", null)
    .not("medium_path", "is", null)
    .order("id")
    .range(from, from + PAGE - 1);
  if (error) throw error;
  if (!data.length) break;
  for (const photo of data as { id: string; storage_path: string; medium_path: string }[]) {
    try {
      if (await exists(photo.medium_path)) {
        counts.existing++;
        continue;
      }
      const { data: blob, error: downloadError } = await photos.download(photo.storage_path);
      if (downloadError || !blob) throw new Error("download failed");
      const medium = mediumFromProcessed(new Uint8Array(await blob.arrayBuffer()));
      const { error: uploadError } = await photos.upload(photo.medium_path, medium, {
        contentType: "image/jpeg", upsert: false, cacheControl: "31536000",
      });
      if (uploadError) throw new Error("upload failed");
      counts.created++;
    } catch {
      counts.failed++;
      console.log(JSON.stringify({ photo: photo.id, result: "failed" }));
    }
  }
}
console.log(JSON.stringify(counts));
