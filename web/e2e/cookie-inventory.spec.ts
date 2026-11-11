import { expect, test, type APIResponse, type BrowserContext, type Page, type Response } from "@playwright/test";
import { inventoryEntryFor, type StorageKind } from "../lib/consent/inventory";
import { admin, deleteTestUsers, local } from "./cleanup";
import { latestMail, uniqueEmail } from "./mailpit";
import { createAccount, createPublicListing } from "./session";
import { makeAdmin, totp } from "../integration/totp";

// M9a, Akzeptanz b (ADR 021, Review A10): Ohne Einwilligung laufen keine nicht notwendigen Cookies. Gesammelt werden
// context.cookies(), die Set-Cookie-Header aller Antworten (auch Redirects, /api/*, Fehlerseiten), Local/Session
// Storage, IndexedDB, Cache Storage und Service Worker. Alles muss einem Inventareintrag entsprechen und notwendig
// sein, und es gibt keine Requests an fremde Origins. Ein Selbsttest beweist, dass der Test anschlägt.
// Export und Löschen (M9a) sind dabei; die Seiten aus M9b (Verifizierung, Melden, Entscheidungen, Admin-Meldungen)
// kommen mit ihren Commits dazu.
// Gegen Stage oder Produktion (nur anonyme Seiten): QA_BASE_URL=https://… QA_SUPABASE_URL=https://….supabase.co

const REMOTE = process.env.QA_BASE_URL;
const BASE = REMOTE ?? "http://localhost:3000";
const SUPABASE = process.env.QA_SUPABASE_URL ?? local?.url ?? "";
if (REMOTE) test.use({ baseURL: REMOTE });

type Found = { kind: StorageKind | "serviceWorker"; name: string; where: string; maxAge?: number };

/** Sammelt alles, was eine Seite im Browser ablegt oder anfragt; `violations()` liefert die Funde ohne Inventar. */
class Collector {
  readonly found: Found[] = [];
  readonly foreign = new Set<string>();
  private pending: Promise<void>[] = [];
  private readonly allowed = new Set([new URL(BASE).origin, ...(SUPABASE ? [new URL(SUPABASE).origin] : [])]);

  attach(page: Page): void {
    page.on("response", (r) => this.pending.push(this.fromResponse(r)));
    page.on("request", (req) => {
      const url = new URL(req.url());
      if (url.protocol !== "data:" && url.protocol !== "blob:" && !this.allowed.has(url.origin)) this.foreign.add(url.origin);
    });
  }

  private async fromResponse(response: Response): Promise<void> {
    this.headers(await response.headerValues("set-cookie"), response.url());
    // Redirect-Antworten zählen mit (auch 3xx aus dem Proxy).
    for (let req = response.request().redirectedFrom(); req; req = req.redirectedFrom()) {
      const r = await req.response();
      if (r) this.headers(await r.headerValues("set-cookie"), r.url());
    }
  }

  async api(response: APIResponse): Promise<void> {
    const values = response.headersArray().filter((h) => h.name.toLowerCase() === "set-cookie").map((h) => h.value);
    this.headers(values, response.url());
  }

  private headers(values: string[], where: string): void {
    for (const line of values.flatMap((v) => v.split("\n"))) {
      const name = line.split("=")[0].trim();
      if (!name) continue;
      const maxAge = /;\s*max-age=(\d+)/i.exec(line);
      this.found.push({ kind: "cookie", name, where: `Set-Cookie ${new URL(where).pathname}`, maxAge: maxAge ? Number(maxAge[1]) : undefined });
    }
  }

  async snapshot(page: Page, context: BrowserContext): Promise<void> {
    await Promise.all(this.pending);
    this.pending = [];
    const where = new URL(page.url()).pathname;
    const now = Date.now() / 1000;
    for (const c of await context.cookies()) {
      this.found.push({ kind: "cookie", name: c.name, where: `Cookie ${where}`, maxAge: c.expires > 0 ? Math.round(c.expires - now) : undefined });
    }
    const storage = await page.evaluate(async () => ({
      local: Object.keys(window.localStorage),
      session: Object.keys(window.sessionStorage),
      idb: "databases" in indexedDB ? (await indexedDB.databases()).map((d) => d.name ?? "") : [],
      caches: "caches" in window ? await caches.keys() : [],
      workers: "serviceWorker" in navigator ? (await navigator.serviceWorker.getRegistrations()).map((r) => r.scope) : [],
    }));
    for (const name of storage.local) this.found.push({ kind: "localStorage", name, where });
    for (const name of storage.session) this.found.push({ kind: "sessionStorage", name, where });
    for (const name of storage.idb) this.found.push({ kind: "indexedDB", name, where });
    for (const name of storage.caches) this.found.push({ kind: "cache", name, where });
    for (const name of storage.workers) this.found.push({ kind: "serviceWorker", name, where });
  }

  violations(): string[] {
    const out = new Set<string>();
    for (const f of this.found) {
      const entry = f.kind === "serviceWorker" ? null : inventoryEntryFor(f.kind, f.name);
      if (!entry) out.add(`${f.kind} „${f.name}“ nicht im Inventar (${f.where})`);
      else if (entry.category !== "necessary") out.add(`${f.kind} „${f.name}“ ist optional (${f.where})`);
      else if (f.maxAge !== undefined && entry.maxAgeSeconds !== null && f.maxAge > entry.maxAgeSeconds + 60) {
        out.add(`${f.kind} „${f.name}“ läuft länger als im Inventar (${f.maxAge} s, ${f.where})`);
      }
    }
    for (const origin of this.foreign) out.add(`Request an fremde Origin ${origin}`);
    return [...out].sort();
  }
}

async function visit(page: Page, context: BrowserContext, collector: Collector, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  await collector.snapshot(page, context);
}

const created: string[] = [];
test.afterAll(() => deleteTestUsers(created));

test("Selbsttest: ein nicht inventarisiertes Cookie und ein Local-Storage-Eintrag schlagen an", async ({ page, context }) => {
  const collector = new Collector();
  collector.attach(page);
  await page.goto("/de/cookies");
  await context.addCookies([{ name: "rogue_tracker", value: "1", url: BASE }]);
  await page.evaluate(() => window.localStorage.setItem("rogue_ls", "1"));
  await collector.snapshot(page, context);
  const violations = collector.violations();
  expect(violations.some((v) => v.includes("„rogue_tracker“"))).toBe(true);
  expect(violations.some((v) => v.includes("localStorage „rogue_ls“"))).toBe(true);
});

test("anonym: Seiten, Redirects, Fehlerseiten und APIs setzen nichts außerhalb des Inventars", async ({ page, context, request }) => {
  const collector = new Collector();
  collector.attach(page);
  const pages = ["/", "/de", "/en", "/cs", "/pl", "/de/jagdhelfer", "/de/jagdhelfer?view=map", "/de/suche", "/de/imprint", "/de/privacy",
    "/de/terms", "/de/guidelines", "/de/cookies", "/de/sources", "/de/login", "/de/gibt-es-nicht", "/de/account", "/de/admin"];
  if (!REMOTE) {
    const owner = await createAccount("inventory-owner", "Inventar Anbieter", created);
    const listing = await createPublicListing(owner.id, `Inventar ${Date.now()}`);
    pages.push(`/de/anzeige/${listing}`, `/de/anbieter/${owner.id}`);
  }
  for (const path of pages) await visit(page, context, collector, path);
  // Kein Cookie vor einer Nutzeraktion (ADR 021): anonyme Antworten tragen gar kein Set-Cookie, auch kein NEXT_LOCALE.
  expect(collector.found.filter((f) => f.kind === "cookie")).toEqual([]);

  const root = await request.get("/", { maxRedirects: 0, headers: { "Accept-Language": "pl,en;q=0.5" } });
  expect(root.status()).toBe(307);
  expect(root.headers()["location"]).toMatch(/\/pl$/);
  expect(root.headers()["vary"]).toMatch(/Accept-Language/);
  expect(root.headers()["cache-control"]).toMatch(/private/);
  for (const path of ["/", "/de/", "/api/sources/postal-codes", "/api/map?bbox=12,50,13,51&lang=de", `/api/photos/${crypto.randomUUID()}`,
    "/api/unsubscribe?t=" + "0".repeat(64), "/sitemap/de.xml", "/robots.txt", "/de/anzeige/00000000-0000-4000-8000-000000000000"]) {
    await collector.api(await request.get(path, { maxRedirects: 0 }));
  }
  expect(collector.violations()).toEqual([]);
});

test("angemeldet: Login, Konto, Chat, Suchaufträge, Admin und Abmelden bleiben im Inventar", async ({ page, context }) => {
  test.skip(!!REMOTE, "Braucht die lokale Supabase und Mailpit");
  const collector = new Collector();
  collector.attach(page);
  const email = uniqueEmail("inventory");
  created.push(email);
  await page.goto("/de/login?next=/de/account");
  const since = new Date(Date.now() - 1000);
  await page.getByLabel("E-Mail-Adresse").fill(email);
  await page.getByRole("button", { name: "Anmelde-E-Mail senden" }).click();
  const mail = await latestMail(email, since);
  await page.getByLabel("Anmeldecode").fill(mail.code);
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
  await expect(page).toHaveURL(/\/de\/welcome/);
  await collector.snapshot(page, context);
  await page.getByLabel("Anzeigename").fill("Inventar Konto");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Speichern und weiter" }).click();
  await expect(page).toHaveURL("/de/account");
  await collector.snapshot(page, context);
  // Session-Cookie vorhanden und als notwendig inventarisiert.
  expect((await context.cookies()).some((c) => inventoryEntryFor("cookie", c.name)?.id === "session")).toBe(true);

  for (const path of ["/de/account/profile", "/de/account/listings", "/de/account/listings/new", "/de/account/favorites",
    "/de/account/messages", "/de/account/searches", "/de/account/blocked", "/de/account/data", "/de/account/delete", "/de/jagdhelfer?view=map"]) {
    await visit(page, context, collector, path);
  }

  const { data } = await admin().auth.admin.listUsers({ perPage: 1000 });
  makeAdmin(data.users.find((u) => u.email === email)!.id);
  await page.goto("/de/admin/mfa");
  await page.getByRole("button", { name: "Authenticator einrichten" }).click();
  const secret = (await page.locator("code").textContent())!.trim();
  await page.getByLabel("6-stelliger Code aus der App").fill(totp(secret));
  await page.getByRole("button", { name: "Bestätigen" }).click();
  await expect(page).toHaveURL("/de/admin");
  for (const path of ["/de/admin", "/de/admin/listings", "/de/admin/audit", "/de/admin/admins"]) await visit(page, context, collector, path);

  await page.getByRole("button", { name: "Abmelden" }).click();
  await expect(page).toHaveURL("/de");
  await page.waitForLoadState("networkidle");
  await collector.snapshot(page, context);
  // Abmelden räumt Session und alle PKCE-Verifier ab (ADR 021).
  expect((await context.cookies()).map((c) => c.name).filter((n) => n.startsWith("sb-"))).toEqual([]);
  expect(collector.violations()).toEqual([]);
});
