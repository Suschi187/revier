// Ablauf der Function mit Mock-RPC und Mock-Mailer (ADR 018, B2, B4, A8, H8): Methode, Geheimnis, Mailer, SITE_URL,
// Confirm bei Erfolg, Release bei Fehler (nur claim_ids), getrennte Schritte, Logs nur Zähler.
import type { Mail, Mailer } from "../../_shared/mail/mailer.ts";
import { handle, type Rpc } from "../handler.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const SITE = "https://revier.example";
const SECRET = "geheim-für-den-test";
const TOKEN_A = "a1".repeat(32);
const TOKEN_B = "b2".repeat(32);
const LISTING = "3f2b8c1e-6a4d-4e7b-9c10-5d8e2f1a0b7c";

type Call = { fn: string; args: Record<string, unknown> };

function mockRpc(responses: Record<string, { data?: unknown; error?: { code?: string } | null }>): { rpc: Rpc; calls: Call[] } {
  const calls: Call[] = [];
  const rpc: Rpc = (fn, args) => {
    calls.push({ fn, args });
    const r = responses[fn] ?? { data: 0 };
    return Promise.resolve({ data: r.data ?? null, error: r.error ?? null });
  };
  return { rpc, calls };
}

class MockMailer implements Mailer {
  sent: Mail[] = [];
  constructor(private readonly failFor: string[] = []) {}
  send(mail: Mail): Promise<void> {
    if (this.failFor.includes(mail.to)) return Promise.reject(new Error("smtp 550"));
    this.sent.push(mail);
    return Promise.resolve();
  }
}

function item(title: string) {
  return {
    listing_id: LISTING,
    title,
    kind: "lease",
    direction: "offer",
    district_code: "DE-12073",
    district_name: "Uckermark",
    state_code: "DE-BB",
    state_name: "Brandenburg",
    price_minor: null,
    currency: null,
    price_unit: "on_request",
  };
}

const searchClaim = {
  queue: { listings: 1, searches: 2, filters: 0, matches: 2, failed_searches: 0, dropped: 0 },
  recipients: [
    {
      claim_id: "c-ok",
      email: "ok@example.de",
      language: "cs",
      unsubscribe_token: TOKEN_A,
      items: [item("Honitba")],
      searches: [{ id: "s1", name: "Hledání", expires_at: "2026-12-01T00:00:00Z", extendable: false }],
    },
    {
      claim_id: "c-fail",
      email: "fail@example.de",
      language: "de",
      unsubscribe_token: TOKEN_B,
      items: [item("Revier")],
      searches: [],
    },
    { claim_id: "c-badtoken", email: "token@example.de", language: "de", unsubscribe_token: "x\r\nBcc: y@z.de", items: [item("T")], searches: [] },
    { claim_id: "c-empty", email: "empty@example.de", language: "de", unsubscribe_token: TOKEN_A, items: [], searches: [] },
  ],
};

const moderationClaim = [
  { claim_id: "m-ok", email: "owner@example.de", language: "en", decision: "rejected", reject_code: "weapons", reason: "Nein", listing_id: LISTING, title: "Pacht" },
  { claim_id: "m-fail", email: "fail@example.de", language: "pl", decision: "approved", reject_code: null, reason: null, listing_id: LISTING, title: "Pacht" },
  { claim_id: "m-unknown", email: "x@example.de", language: "de", decision: "deleted", reject_code: null, reason: null, listing_id: LISTING, title: "Pacht" },
];

const accountClaim = [
  {
    claim_id: "a-ok",
    kind: "verification_rejected",
    email: "verif@example.de",
    language: "de",
    details: { document_type: "jagdschein", code: "unreadable", reason: "Bitte schärfer", decided_at: "2026-11-12T10:00:00Z", appeal_until: "2027-05-14T10:00:00Z" },
  },
  { claim_id: "a-nodetails", kind: "verification_verified", email: "x@example.de", language: "en", details: null },
  { claim_id: "a-unknown", kind: "newsletter", email: "x@example.de", language: "en", details: {} },
];

function post(secret: string | null = SECRET): Request {
  return new Request("http://localhost/functions/v1/send-search-notifications", {
    method: "POST",
    headers: secret === null ? {} : { "x-search-notify-secret": secret },
  });
}

async function captureLogs<T>(fn: () => Promise<T>): Promise<{ result: T; logs: string[] }> {
  const logs: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
  try {
    return { result: await fn(), logs };
  } finally {
    console.log = original;
  }
}

Deno.test("Nur POST (405), ohne Mailer oder SITE_URL 503, falsches Geheimnis 401", async () => {
  const { rpc, calls } = mockRpc({ claim_search_notifications: { error: { code: "42501" } } });
  const mailer = new MockMailer();
  for (const method of ["GET", "PUT", "DELETE"]) {
    const response = await handle(new Request("http://localhost/", { method }), { rpc, mailer, siteUrl: SITE });
    assert(response.status === 405, method);
  }
  await captureLogs(async () => {
    assert((await handle(post(), { rpc, mailer: null, siteUrl: SITE })).status === 503, "ohne Mailer");
    assert((await handle(post(), { rpc, mailer, siteUrl: null })).status === 503, "ohne SITE_URL");
  });
  assert(calls.length === 0, "vor 401 und 503 kein RPC");
  const { result } = await captureLogs(() => handle(post("falsch"), { rpc, mailer, siteUrl: SITE }));
  assert(result.status === 401, "401");
  assert(JSON.stringify(await result.json()) === '{"error":"unauthorized"}', "ohne Details");
  assert(calls.length === 1 && calls[0].args.p_secret === "falsch", "Geheimnis an die RPC durchgereicht");
  assert(mailer.sent.length === 0, "nichts versendet");
});

Deno.test("Ohne Header geht ein leeres Geheimnis an die RPC (401 aus der DB)", async () => {
  const { rpc, calls } = mockRpc({ claim_search_notifications: { error: { code: "42501" } } });
  const { result } = await captureLogs(() => handle(post(null), { rpc, mailer: new MockMailer(), siteUrl: SITE }));
  assert(result.status === 401 && calls[0].args.p_secret === "", "leer");
});

Deno.test("Suchauftrags- und Moderations-Mails: Confirm bei Erfolg, Release bei Fehler, getrennte Schritte", async () => {
  const { rpc, calls } = mockRpc({
    claim_search_notifications: { data: searchClaim },
    claim_moderation_notifications: { data: moderationClaim },
    claim_account_notifications: { data: accountClaim },
  });
  const mailer = new MockMailer(["fail@example.de"]);
  const { result, logs } = await captureLogs(() => handle(post(), { rpc, mailer, siteUrl: SITE }));
  assert(result.status === 200, `Status ${result.status}`);
  const body = await result.json();
  assert(
    JSON.stringify(body) === JSON.stringify({
      search: { recipients: 4, sent: 1, failed: 2 },
      moderation: { recipients: 3, sent: 1, failed: 1 },
      account: { recipients: 3, sent: 1, failed: 0 },
    }),
    JSON.stringify(body),
  );

  const order = calls.map((c) => c.fn);
  assert(
    JSON.stringify(order) === JSON.stringify([
      "claim_search_notifications",
      "release_search_notifications",
      "confirm_search_notifications",
      "claim_moderation_notifications",
      "release_moderation_notifications",
      "confirm_moderation_notifications",
      "claim_account_notifications",
      "confirm_account_notifications",
    ]),
    order.join(),
  );
  const args = (fn: string) => calls.find((c) => c.fn === fn)!.args;
  assert(JSON.stringify(args("release_search_notifications")) === JSON.stringify({ p_secret: SECRET, p_claim_ids: ["c-fail", "c-badtoken"] }), "Release Suche");
  assert(JSON.stringify(args("confirm_search_notifications")) === JSON.stringify({ p_secret: SECRET, p_claim_ids: ["c-ok"] }), "Confirm Suche");
  assert(JSON.stringify(args("release_moderation_notifications")) === JSON.stringify({ p_secret: SECRET, p_claim_ids: ["m-fail"] }), "Release Moderation");
  assert(JSON.stringify(args("confirm_moderation_notifications")) === JSON.stringify({ p_secret: SECRET, p_claim_ids: ["m-ok"] }), "Confirm Moderation");

  // Header: Suchauftrags-Mail mit One-Click, Moderations-Mail ohne
  const [search, moderation] = mailer.sent;
  assert(search.to === "ok@example.de" && search.headers?.["List-Unsubscribe"] === `<${SITE}/api/unsubscribe?t=${TOKEN_A}>`, "List-Unsubscribe");
  assert(search.headers?.["List-Unsubscribe-Post"] === "List-Unsubscribe=One-Click", "Post-Header");
  assert(search.text.includes(`${SITE}/cs/unsubscribe?t=${TOKEN_A}`) && search.text.includes(`${SITE}/cs/inzerat/${LISTING}`), "Sprache des Empfängers");
  assert(moderation.to === "owner@example.de" && moderation.headers === undefined, "Moderation ohne List-Unsubscribe");
  assert(moderation.text.includes("Weapons or ammunition offered"), "Grund-Label");
  const account = mailer.sent[2];
  assert(account.to === "verif@example.de" && account.headers === undefined && account.text.includes("Dokument nicht lesbar"), "Dienstmail");
  assert(JSON.stringify(args("confirm_account_notifications")) === JSON.stringify({ p_secret: SECRET, p_claim_ids: ["a-ok"] }), "Confirm Dienstmails");

  // Logs: JSON mit fn/kind, nur Zähler
  const parsed = logs.map((line) => JSON.parse(line) as Record<string, unknown>);
  assert(parsed.length === 3, `drei Logzeilen: ${logs.length}`);
  for (const entry of parsed) {
    assert(entry.fn === "send-search-notifications", "fn");
    for (const [key, value] of Object.entries(entry)) {
      if (!["fn", "kind", "result"].includes(key)) assert(typeof value === "number", `nur Zahlen: ${key}`);
    }
  }
  assert(parsed[0].kind === "search" && parsed[0].queue_matches === 2 && parsed[0].skipped === 1, "Zähler Suche");
  assert(parsed[1].kind === "moderation" && parsed[1].skipped === 1, "Zähler Moderation");
  assert(parsed[2].kind === "account" && parsed[2].skipped === 2, "Zähler Dienstmails");
  const all = logs.join("\n");
  for (const secret of ["example.de", TOKEN_A, TOKEN_B, "Honitba", "Pacht", "Nein", "schärfer", SECRET, "c-ok", "m-ok", "a-ok"]) {
    assert(!all.includes(secret), `kein ${secret} im Log`);
  }
});

Deno.test("Ohne Fälliges keine Buchung; Fehler im Suchauftrags-Claim hält die Moderations-Mails nicht auf", async () => {
  const empty = mockRpc({
    claim_search_notifications: { data: { queue: {}, recipients: [] } },
    claim_moderation_notifications: { data: [] },
    claim_account_notifications: { data: [] },
  });
  const { result } = await captureLogs(() => handle(post(), { rpc: empty.rpc, mailer: new MockMailer(), siteUrl: SITE }));
  assert(result.status === 200, "200");
  assert(JSON.stringify(empty.calls.map((c) => c.fn)) === JSON.stringify(["claim_search_notifications", "claim_moderation_notifications", "claim_account_notifications"]),
    "nur Claims",
  );

  const broken = mockRpc({
    claim_search_notifications: { error: { code: "57014" } },
    claim_moderation_notifications: { data: [moderationClaim[0]] },
  });
  const mailer = new MockMailer();
  const run = await captureLogs(() => handle(post(), { rpc: broken.rpc, mailer, siteUrl: SITE }));
  assert(run.result.status === 500, "500 bei Claim-Fehler");
  const body = await run.result.json();
  assert(body.error === "claim_failed" && body.moderation.sent === 1, JSON.stringify(body));
  assert(mailer.sent.length === 1 && broken.calls.some((c) => c.fn === "confirm_moderation_notifications"), "Moderation trotzdem versendet");
});

Deno.test("Fehler beim Zurückmelden nur als Zahl im Log", async () => {
  const { rpc } = mockRpc({
    claim_search_notifications: { data: { recipients: [searchClaim.recipients[0]] } },
    confirm_search_notifications: { error: { code: "42883" } },
    claim_moderation_notifications: { data: [] },
  });
  const { result, logs } = await captureLogs(() => handle(post(), { rpc, mailer: new MockMailer(), siteUrl: SITE }));
  assert(result.status === 200, "Versand gilt als erfolgt");
  assert((JSON.parse(logs[0]) as { bookkeepingErrors: number }).bookkeepingErrors === 1, "gezählt");
});
