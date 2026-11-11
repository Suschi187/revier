// Ablauf der Account-Löschung (ADR 019, Review B1, A1, A2), ohne Netzwerk: Abhängigkeiten werden übergeben, damit
// die Deno-Tests Reihenfolge, Wiederholung und Fehlerfälle mit Mocks prüfen. Je geclaimter Zeile:
//   Storage 1 → prepare → deleteUser (404 = Erfolg) → finalize → Storage 2 → complete.
// Jeder Schritt ist idempotent; bei einem Fehler gibt `fail` den Lease frei, der Backoff kommt aus dem Claim.
// Antworten und Logs nur als Zähler: keine UUIDs, keine Adressen.

export type Claim = { user_id: string; claim_id: string; attempts: number };
export type StorageObject = { bucket_id: string; name: string };
export type RpcError = { code?: string } | null;

export type Deps = {
  claim(secret: string, limit: number): Promise<{ data: Claim[] | null; error: RpcError }>;
  objects(claimId: string, userId: string): Promise<{ data: StorageObject[] | null; error: RpcError }>;
  step(name: "prepare" | "finalize" | "complete" | "fail", claimId: string, userId: string): Promise<{ error: RpcError }>;
  remove(bucket: string, names: string[]): Promise<{ error: unknown }>;
  /** `notFound`: Das Konto existiert schon nicht mehr (früherer, abgebrochener Lauf). */
  deleteUser(userId: string): Promise<{ error: unknown; notFound: boolean }>;
  now(): number;
};

export const CLAIM_LIMIT = 5;
/** Zeitbudget je Lauf; der Lease (5 Minuten) bleibt deutlich darüber. */
export const TIME_BUDGET_MS = 40_000;
/** Höchstens so viele Seiten à 1000 Objekte je Durchlauf, sonst Fehler und Wiederholung. */
const MAX_STORAGE_PAGES = 50;

class StepError extends Error {}

async function purgeStorage(deps: Deps, claim: Claim): Promise<number> {
  let removed = 0;
  for (let page = 0; page < MAX_STORAGE_PAGES; page++) {
    const { data, error } = await deps.objects(claim.claim_id, claim.user_id);
    if (error || !data) throw new StepError("objects");
    // Gegenprobe: Erst eine leere Liste beendet den Durchlauf.
    if (data.length === 0) return removed;
    const byBucket = new Map<string, string[]>();
    for (const o of data) byBucket.set(o.bucket_id, [...(byBucket.get(o.bucket_id) ?? []), o.name]);
    for (const [bucket, names] of byBucket) {
      const result = await deps.remove(bucket, names);
      if (result.error) throw new StepError("remove");
      removed += names.length;
    }
  }
  throw new StepError("storage_pages");
}

async function step(deps: Deps, name: "prepare" | "finalize" | "complete", claim: Claim): Promise<void> {
  const { error } = await deps.step(name, claim.claim_id, claim.user_id);
  if (error) throw new StepError(name);
}

/** Führt die Löschung für eine Zeile vollständig aus; wirft bei einem fehlgeschlagenen Schritt. */
export async function deleteAccount(deps: Deps, claim: Claim): Promise<number> {
  let removed = await purgeStorage(deps, claim);
  await step(deps, "prepare", claim);
  const deleted = await deps.deleteUser(claim.user_id);
  if (deleted.error && !deleted.notFound) throw new StepError("delete_user");
  await step(deps, "finalize", claim);
  // Durchlauf 2 fängt späte Uploads ab (process-listing-photo, Review A2).
  removed += await purgeStorage(deps, claim);
  await step(deps, "complete", claim);
  return removed;
}

export type Result = { status: number; body: Record<string, number | string> };

export async function handle(method: string, secret: string, deps: Deps): Promise<Result> {
  if (method !== "POST") return { status: 405, body: { error: "method" } };
  const started = deps.now();
  const { data, error } = await deps.claim(secret, CLAIM_LIMIT);
  if (error) {
    const unauthorized = error.code === "42501";
    return { status: unauthorized ? 403 : 500, body: { error: unauthorized ? "forbidden" : "claim_failed" } };
  }
  const claims = data ?? [];
  let done = 0;
  let failed = 0;
  let deferred = 0;
  let objects = 0;
  for (const claim of claims) {
    // Über dem Zeitbudget: Lease freigeben, der nächste Lauf holt nach (zählt als Versuch, Backoff aus dem Claim).
    if (deps.now() - started > TIME_BUDGET_MS) {
      await deps.step("fail", claim.claim_id, claim.user_id);
      deferred++;
      continue;
    }
    try {
      objects += await deleteAccount(deps, claim);
      done++;
    } catch {
      failed++;
      await deps.step("fail", claim.claim_id, claim.user_id);
    }
  }
  return { status: 200, body: { claimed: claims.length, done, failed, deferred, objects } };
}
