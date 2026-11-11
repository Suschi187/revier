// delete-account (ADR 019): Reihenfolge der Schritte, Wiederholung, Secret, Methode und Zeitbudget mit Mocks. Gegen
// den echten Stack prüft web/integration/account-deletion.test.ts (Akzeptanz a).
import { type Claim, type Deps, handle, TIME_BUDGET_MS } from "../handler.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
function assertEquals(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}: ${a} ≠ ${e}`);
}

const U = { user_id: "u1", claim_id: "c1", attempts: 1 } satisfies Claim;

type Options = {
  claims?: Claim[];
  files?: string[][];
  deleteUser?: { error: unknown; notFound: boolean };
  failStep?: string;
  claimError?: { code?: string };
  clock?: number[];
};

function mock(options: Options = {}) {
  const calls: string[] = [];
  // Eine Seite je objects-Aufruf; danach leer.
  const files = [...(options.files ?? [["listing-photos:u1/a.jpg"]])];
  const clock = [...(options.clock ?? [])];
  const deps: Deps = {
    claim: (secret) => {
      calls.push(`claim:${secret}`);
      if (options.claimError) return Promise.resolve({ data: null, error: options.claimError });
      return Promise.resolve({ data: options.claims ?? [U], error: null });
    },
    objects: (_c, user) => {
      calls.push(`objects:${user}`);
      const current = files.shift() ?? [];
      return Promise.resolve({ data: current.map((f) => ({ bucket_id: f.split(":")[0], name: f.split(":")[1] })), error: null });
    },
    remove: (bucket, names) => {
      calls.push(`remove:${bucket}:${names.join(",")}`);
      return Promise.resolve({ error: null });
    },
    step: (name, _c, user) => {
      calls.push(`${name}:${user}`);
      return Promise.resolve({ error: options.failStep === name ? { code: "XX000" } : null });
    },
    deleteUser: (user) => {
      calls.push(`deleteUser:${user}`);
      return Promise.resolve(options.deleteUser ?? { error: null, notFound: false });
    },
    now: () => clock.shift() ?? 0,
  };
  return { deps, calls };
}

Deno.test("Reihenfolge: Storage 1 → prepare → deleteUser → finalize → Storage 2 → complete", async () => {
  // Durchlauf 1 findet eine Datei, Gegenprobe leer; Durchlauf 2 findet einen späten Upload.
  const { deps, calls } = mock({ files: [["listing-photos:u1/a.jpg", "listing-uploads:u1/b"], [], ["listing-uploads:u1/late"], []] });
  const result = await handle("POST", "s", deps);
  assertEquals(calls, [
    "claim:s", "objects:u1", "remove:listing-photos:u1/a.jpg", "remove:listing-uploads:u1/b", "objects:u1",
    "prepare:u1", "deleteUser:u1", "finalize:u1", "objects:u1", "remove:listing-uploads:u1/late", "objects:u1", "complete:u1",
  ], "Schritte");
  assertEquals(result, { status: 200, body: { claimed: 1, done: 1, failed: 0, deferred: 0, objects: 3 } }, "Antwort nur Zähler");
});

Deno.test("deleteUser 404 zählt als Erfolg (Wiederholung nach Abbruch)", async () => {
  const { deps, calls } = mock({ deleteUser: { error: { status: 404 }, notFound: true } });
  const result = await handle("POST", "s", deps);
  assert(calls.includes("finalize:u1") && calls.includes("complete:u1"), "weiter nach 404");
  assertEquals(result.body.done, 1, "erledigt");
});

Deno.test("Fehler bei deleteUser: Lease frei, kein finalize, kein complete", async () => {
  const { deps, calls } = mock({ deleteUser: { error: { status: 500 }, notFound: false } });
  const result = await handle("POST", "s", deps);
  assert(!calls.includes("finalize:u1") && !calls.includes("complete:u1"), "kein weiterer Schritt");
  assert(calls.at(-1) === "fail:u1", "fail am Ende");
  // Ein abgebrochener Lauf zählt seine Objekte nicht (der nächste Lauf findet nur noch Reste).
  assertEquals(result.body, { claimed: 1, done: 0, failed: 1, deferred: 0, objects: 0 }, "Zähler");
});

Deno.test("Fehler in finalize: kein complete, fail", async () => {
  const { deps, calls } = mock({ failStep: "finalize" });
  await handle("POST", "s", deps);
  assert(!calls.includes("complete:u1") && calls.at(-1) === "fail:u1", "fail statt complete");
});

Deno.test("Falsches Secret: 403 ohne weitere Schritte; anderer Claim-Fehler 500", async () => {
  const forbidden = mock({ claimError: { code: "42501" } });
  assertEquals(await handle("POST", "falsch", forbidden.deps), { status: 403, body: { error: "forbidden" } }, "403");
  assertEquals(forbidden.calls, ["claim:falsch"], "nur der Claim");
  const broken = mock({ claimError: { code: "XX000" } });
  assertEquals((await handle("POST", "s", broken.deps)).status, 500, "500");
});

Deno.test("Nur POST: 405 ohne Claim", async () => {
  for (const method of ["GET", "PUT", "DELETE"]) {
    const { deps, calls } = mock();
    assertEquals((await handle(method, "s", deps)).status, 405, method);
    assertEquals(calls, [], `kein Aufruf bei ${method}`);
  }
});

Deno.test("Zeitbudget: übrige Zeilen werden freigegeben statt bearbeitet", async () => {
  const V = { user_id: "u2", claim_id: "c2", attempts: 1 };
  // Start 0, U beginnt bei 0, V erst nach dem Budget.
  const { deps, calls } = mock({ claims: [U, V], clock: [0, 0, TIME_BUDGET_MS + 1] });
  const result = await handle("POST", "s", deps);
  assert(calls.includes("complete:u1") && calls.includes("fail:u2") && !calls.includes("prepare:u2"), "V verschoben");
  assertEquals(result.body.deferred, 1, "deferred");
});

Deno.test("Storage-Fehler: Abbruch vor prepare", async () => {
  const { deps, calls } = mock();
  deps.remove = () => Promise.resolve({ error: new Error("x") });
  await handle("POST", "s", deps);
  assert(!calls.includes("prepare:u1") && calls.at(-1) === "fail:u1", "kein prepare");
});
