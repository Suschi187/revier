// Storage-Aufräumen (ADR 019, Aufräumjobs M9a), ohne Netzwerk: Foto-Eingang nach Frist und Dateien in listing-photos
// ohne Zeile. Die Kandidaten liefert die RPC (Secret dort geprüft), gelöscht wird nur über die Storage-API.
// Seitenweise bis zur leeren Liste, mit Seiten- und Zeitbudget. Antworten und Logs nur als Zähler.

export type Candidate = { bucket_id: string; name: string; reason: string };
export type RpcError = { code?: string } | null;

export type Deps = {
  candidates(secret: string): Promise<{ data: Candidate[] | null; error: RpcError }>;
  remove(bucket: string, names: string[]): Promise<{ error: unknown }>;
  now(): number;
};

export const TIME_BUDGET_MS = 40_000;
export const MAX_PAGES = 20;

export type Result = { status: number; body: Record<string, number | string> };

export async function handle(method: string, secret: string, deps: Deps): Promise<Result> {
  if (method !== "POST") return { status: 405, body: { error: "method" } };
  const started = deps.now();
  const removed: Record<string, number> = { upload_expired: 0, photo_orphan: 0 };
  let failed = 0;
  for (let page = 0; page < MAX_PAGES && deps.now() - started <= TIME_BUDGET_MS; page++) {
    const { data, error } = await deps.candidates(secret);
    if (error) {
      const forbidden = error.code === "42501";
      if (page === 0) return { status: forbidden ? 403 : 500, body: { error: forbidden ? "forbidden" : "candidates_failed" } };
      break;
    }
    const batch = data ?? [];
    if (batch.length === 0) break;
    const byBucket = new Map<string, Candidate[]>();
    for (const c of batch) byBucket.set(c.bucket_id, [...(byBucket.get(c.bucket_id) ?? []), c]);
    let progress = false;
    for (const [bucket, items] of byBucket) {
      const result = await deps.remove(bucket, items.map((i) => i.name));
      if (result.error) {
        failed += items.length;
        continue;
      }
      progress = true;
      for (const i of items) removed[i.reason] = (removed[i.reason] ?? 0) + 1;
    }
    // Ohne Fortschritt käme dieselbe Seite wieder: nächster Lauf.
    if (!progress) break;
  }
  return { status: 200, body: { ...removed, failed } };
}
