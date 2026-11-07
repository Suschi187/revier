import { expect, request as pwRequest, test, type APIRequestContext } from "@playwright/test";

// QA-Nachprüfung M8 (docs/QA-REPORT.md, „M8 – Nachprüfung“), F2: Header von /api/unsubscribe und Nebenwirkungen der
// geänderten Quelle in next.config.ts. Kein Feature-Code.
// - POST 200 und GET 303 behalten no-referrer und die eigene CSP; nosniff, X-Frame-Options, Permissions-Policy bleiben.
// - Übrige Seiten und /api-Pfade unverändert (allgemeine CSP, strict-origin-when-cross-origin, X-Frame-Options, nosniff).
// - /api/unsubscribex und /api/unsubscribe/x fallen nicht unter die Ausnahme.
// - N1 (behoben): /api/unsubscribe/ mit Schrägstrich bekam die allgemeine CSP; next.config nimmt den Pfad jetzt mit aus.
// Gegen den Produktions-Build: QA_BASE_URL=http://localhost:3100 QA_PROD=1 (dann auch HSTS).

const BASE = process.env.QA_BASE_URL ?? "http://localhost:3000";
// In der CI läuft der Produktions-Build (playwright.config.ts), dann gehört HSTS dazu.
const PROD = process.env.QA_PROD === "1" || (!process.env.QA_BASE_URL && !!process.env.CI);
const T = "0".repeat(64);
const DONE_CSP = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const FORM = { headers: { "Content-Type": "application/x-www-form-urlencoded" }, data: "List-Unsubscribe=One-Click", maxRedirects: 0 };

let ctx: APIRequestContext;
test.beforeAll(async () => {
  ctx = await pwRequest.newContext({ baseURL: BASE });
});
test.afterAll(async () => {
  await ctx.dispose();
});

function expectBase(h: Record<string, string>) {
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["permissions-policy"]).toBe("camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  if (PROD) expect(h["strict-transport-security"]).toBe("max-age=63072000; includeSubDomains");
  else expect(h["strict-transport-security"]).toBeUndefined();
}
function expectGeneralCsp(h: Record<string, string>) {
  expect(h["content-security-policy"]).toContain("script-src 'self'");
  expect(h["content-security-policy"]).toContain("form-action 'self'");
}

test.describe("QA M8 Nachprüfung F2", () => {
  test("POST /api/unsubscribe: eigene CSP, no-referrer, Basis-Header, kein Set-Cookie", async () => {
    const r = await ctx.post(`/api/unsubscribe?t=${T}`, FORM);
    const h = r.headers();
    expect(r.status()).toBe(200);
    expect(h["content-security-policy"]).toBe(DONE_CSP);
    expect(h["referrer-policy"]).toBe("no-referrer");
    expect(h["cache-control"]).toBe("no-store");
    expect(h["x-robots-tag"]).toBe("noindex");
    expect(h["set-cookie"]).toBeUndefined();
    expectBase(h);
    // Genau ein CSP- und ein Referrer-Header (keine zweite, allgemeine Fassung daneben).
    const all = r.headersArray().map((x) => x.name.toLowerCase());
    expect(all.filter((n) => n === "content-security-policy")).toHaveLength(1);
    expect(all.filter((n) => n === "referrer-policy")).toHaveLength(1);
  });

  test("GET /api/unsubscribe: 303 mit no-referrer, ohne allgemeine CSP, Basis-Header", async () => {
    const r = await ctx.get(`/api/unsubscribe?t=${T}`, { maxRedirects: 0 });
    const h = r.headers();
    expect(r.status()).toBe(303);
    expect(h["location"]).toBe(`/de/unsubscribe?t=${T}`);
    expect(h["referrer-policy"]).toBe("no-referrer");
    expect(h["content-security-policy"]).toBeUndefined();
    expectBase(h);
  });

  for (const path of ["/de", "/en/search", `/de/unsubscribe?t=${T}`, "/api/map", "/api/unsubscribex", "/api/unsubscribe/x", "/api/%75nsubscribe"]) {
    test(`Allgemeine Header unverändert: ${path}`, async () => {
      const r = await ctx.get(path, { maxRedirects: 0 });
      const h = r.headers();
      expectGeneralCsp(h);
      expectBase(h);
      // /de/unsubscribe setzt no-referrer selbst (A6), sonst die allgemeine Policy.
      expect(h["referrer-policy"]).toBe(path.startsWith("/de/unsubscribe") ? "no-referrer" : "strict-origin-when-cross-origin");
    });
  }

  test("/de/admin: ohne feste CSP (Nonce aus dem Proxy), übrige Header da", async () => {
    const r = await ctx.get("/de/admin", { maxRedirects: 0 });
    const h = r.headers();
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["content-security-policy"] ?? "").not.toContain("'unsafe-inline' 'unsafe-eval'");
    expectBase(h);
  });

  // N1 (niedrig): Der Proxy reicht /api/ unverändert durch (skipTrailingSlashRedirect), die Route antwortet auch auf
  // /api/unsubscribe/. Die Ausnahme `api/unsubscribe$` greift dort nicht, die allgemeine CSP ersetzt DONE_CSP.
  test("N1: POST /api/unsubscribe/ (Schrägstrich) behält die CSP der Bestätigung", async () => {
    const r = await ctx.post(`/api/unsubscribe/?t=${T}`, FORM);
    expect(r.status()).toBe(200);
    expect(r.headers()["content-security-policy"]).toBe(DONE_CSP);
  });
});
