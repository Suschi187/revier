// account-maintenance (ADR 019): Seiten bis leer, Zähler je Grund, Secret, Methode, Fehler ohne Endlosschleife.
import { type Candidate, type Deps, handle, MAX_PAGES } from "../handler.ts";

function assertEquals(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}: ${a} ≠ ${e}`);
}

function mock(pages: Candidate[][], options: { error?: { code?: string }; removeFails?: boolean } = {}) {
  const calls: string[] = [];
  const queue = [...pages];
  const deps: Deps = {
    candidates: (secret) => {
      calls.push(`candidates:${secret}`);
      if (options.error) return Promise.resolve({ data: null, error: options.error });
      return Promise.resolve({ data: queue.shift() ?? [], error: null });
    },
    remove: (bucket, names) => {
      calls.push(`remove:${bucket}:${names.join(",")}`);
      return Promise.resolve({ error: options.removeFails ? new Error("x") : null });
    },
    now: () => 0,
  };
  return { deps, calls };
}

const up = (n: string): Candidate => ({ bucket_id: "listing-uploads", name: n, reason: "upload_expired" });
const orphan = (n: string): Candidate => ({ bucket_id: "listing-photos", name: n, reason: "photo_orphan" });

Deno.test("Seiten bis zur leeren Liste, je Bucket ein remove, Zähler je Grund", async () => {
  const { deps, calls } = mock([[up("a"), orphan("b"), up("c")], [orphan("d")]]);
  const result = await handle("POST", "s", deps);
  assertEquals(calls, ["candidates:s", "remove:listing-uploads:a,c", "remove:listing-photos:b", "candidates:s", "remove:listing-photos:d", "candidates:s"], "Aufrufe");
  assertEquals(result, { status: 200, body: { upload_expired: 2, photo_orphan: 2, verification_expired: 0, verification_orphan: 0, failed: 0 } }, "Zähler");
});

Deno.test("Falsches Secret 403, anderer Fehler 500, nur POST", async () => {
  assertEquals((await handle("POST", "x", mock([], { error: { code: "42501" } }).deps)).status, 403, "403");
  assertEquals((await handle("POST", "x", mock([], { error: { code: "XX000" } }).deps)).status, 500, "500");
  const get = mock([[up("a")]]);
  assertEquals((await handle("GET", "s", get.deps)).status, 405, "405");
  assertEquals(get.calls, [], "kein Aufruf bei GET");
});

Deno.test("remove schlägt fehl: kein Endlosschleife, failed gezählt", async () => {
  const pages = Array.from({ length: MAX_PAGES + 5 }, () => [up("a")]);
  const { deps, calls } = mock(pages, { removeFails: true });
  const result = await handle("POST", "s", deps);
  assertEquals(calls.filter((c) => c.startsWith("candidates")).length, 1, "nach Fehlschlag Abbruch");
  assertEquals(result.body.failed, 1, "failed");
});
