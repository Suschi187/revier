import { expect, test, type Page, type Request } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { admin, deleteTestUsers, local } from "./cleanup";
import { createAccount, signInAs, type TestAccount } from "./session";

// QA-Abnahme M8 (docs/QA-REPORT.md, „M8 – Abnahme“): Proben neben saved-searches.spec.ts, kein Feature-Code.
// - Abbestellseite: Token verlässt die Seite nur im Formular-POST (kein Prefetch, Referer, Next-Url), keine fremden
//   Hosts; gleiche Seite für gültige und ungültige Token (kein DB-Orakel beim GET).
// - One-Click mit Sitzungs-Cookie und fremdem Origin: 200, kein Set-Cookie, kein Redirect.
// - Konto-Seite ohne JavaScript (alle Aktionen) und nur mit der Tastatur (Speichern und Pausieren).
// - axe in en/cs/pl mit Zuständen (pausiert, abgelaufen, Fehler) und auf der Bestätigung nach dem POST; 360 px.
// - F2 (behoben): Header der Route wurden von next.config überschrieben.

const created: string[] = [];
test.afterAll(() => deleteTestUsers(created));
test.describe.configure({ mode: "serial" });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RUN = Array.from({ length: 10 }, () => "bcdfghjklmnpqrstvwxz"[Math.floor(Math.random() * 20)]).join("");

function rows<T>(query: string): T[] {
  const out = execFileSync("supabase", ["db", "query", "-o", "json", query], {
    cwd: path.resolve(process.cwd(), ".."), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000,
  });
  const parsed = JSON.parse(out.slice(out.search(/[[{]/))) as T[] | { rows?: T[] };
  return Array.isArray(parsed) ? parsed : (parsed.rows ?? []);
}
function id(value: string): string {
  if (!UUID.test(value)) throw new Error("uuid");
  return value;
}
/** Token wie aus dem Claim (nur der Hash bleibt in der DB). */
function chatToken(account: TestAccount): string {
  const t = rows<{ t: string }>(`select private.issue_unsubscribe_token('${id(account.id)}', 'chat', '{}') as t`)[0].t;
  if (!/^[0-9a-f]{64}$/.test(t)) throw new Error("token");
  return t;
}
async function search(account: TestAccount, name: string, filters: Record<string, unknown> = { v: 1 }) {
  const { data, error } = await admin().from("saved_searches").insert({ user_id: account.id, name, filters }).select("id").single();
  if (error) throw error;
  return data.id as string;
}
async function row(searchId: string) {
  return (await admin().from("saved_searches").select("name, cadence, notify_email, paused_at, expires_at").eq("id", searchId).single()).data!;
}
async function axe(page: Page, label: string) {
  const { default: AxeBuilder } = await import("@axe-core/playwright");
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(result.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${label} ${v.id}: ${v.nodes.length}`)).toEqual([]);
}
async function noOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, label).toBeLessThanOrEqual(0);
}

test.describe("QA M8", () => {
  test.skip(!local, "Lokale Supabase nötig");
  let user: TestAccount;

  test.beforeAll(async () => {
    user = await createAccount("qa8-e2e", "Quirin Qualität", created);
  });

  test.setTimeout(90_000);

  test("Abbestellseite: Token nur im Formular-POST, nie in Prefetch, Referer oder anderen Anfragen; keine fremden Hosts", async ({ page }) => {
    const token = chatToken(user);
    const requests: Request[] = [];
    page.on("request", (r) => requests.push(r));
    await page.goto(`/de/unsubscribe?t=${token}`);
    await page.waitForLoadState("load");
    // Prefetch auslösen: über alle sichtbaren Links fahren.
    for (const link of await page.getByRole("link").all()) {
      if (await link.isVisible()) await link.hover({ timeout: 1000 }).catch(() => undefined);
    }
    await page.waitForTimeout(1500);
    const before = requests.length;
    await page.getByRole("button", { name: "Abbestellen" }).click();
    await expect(page.getByRole("status")).toContainText("Erledigt");
    const leaks = requests.slice(1).filter((r) => {
      if (r.method() === "POST" && new URL(r.url()).pathname === "/api/unsubscribe") return false;
      const headers = Object.values(r.headers()).join("\n");
      return r.url().includes(token) || headers.includes(token);
    });
    expect(leaks.map((r) => `${r.method()} ${new URL(r.url()).pathname}`)).toEqual([]);
    const post = requests.slice(before).find((r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/unsubscribe")!;
    expect(post.headers()["referer"]).toBeUndefined();
    const hosts = new Set(requests.filter((r) => !r.url().startsWith("ws")).map((r) => new URL(r.url()).host));
    expect([...hosts]).toEqual(["localhost:3000"]);
    expect((await admin().from("profiles").select("notify_chat_email").eq("user_id", user.id).single()).data!.notify_chat_email).toBe(false);
    await admin().from("profiles").update({ notify_chat_email: true }).eq("user_id", user.id);
  });

  test("Abbestellseite: gültiger und ungültiger Token ergeben dieselbe Seite (kein DB-Orakel beim GET)", async ({ request }) => {
    const valid = chatToken(user);
    const invalid = "f".repeat(64);
    const main = async (t: string) => {
      const response = await request.get(`/de/unsubscribe?t=${t}`, { maxRedirects: 0 });
      expect(response.status()).toBe(200);
      const html = await response.text();
      return /<main[\s\S]*?<\/main>/.exec(html)![0].replaceAll(t, "<t>");
    };
    expect(await main(valid)).toBe(await main(invalid));
    expect((await admin().from("profiles").select("notify_chat_email").eq("user_id", user.id).single()).data!.notify_chat_email).toBe(true);
  });

  test("One-Click mit Sitzungs-Cookie und fremdem Origin: 200, gleicher Body, kein Set-Cookie, kein Redirect", async ({ playwright }) => {
    const token = chatToken(user);
    const cookie = user.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const ctx = await playwright.request.newContext({ baseURL: "http://localhost:3000" });
    const post = (t: string, extra: Record<string, string> = {}) => ctx.post(`/api/unsubscribe?t=${t}`, {
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie, Origin: "https://evil.example", ...extra },
      data: "List-Unsubscribe=One-Click", maxRedirects: 0,
    });
    const invalid = await post("0".repeat(64));
    const valid = await post(token);
    for (const r of [invalid, valid]) {
      expect(r.status()).toBe(200);
      expect(r.headers()["set-cookie"]).toBeUndefined();
      expect(r.headers()["location"]).toBeUndefined();
      expect(r.headers()["cache-control"]).toContain("no-store");
    }
    expect(await valid.text()).toBe(await invalid.text());
    // Überlanger Body (verworfen), Token aus der Query gilt trotzdem; Text statt Formular ebenso.
    await admin().from("profiles").update({ notify_chat_email: true }).eq("user_id", user.id);
    const big = await ctx.post(`/api/unsubscribe?t=${token}`, { headers: { "Content-Type": "text/plain" }, data: "x".repeat(20_000) });
    expect(big.status()).toBe(200);
    expect((await admin().from("profiles").select("notify_chat_email").eq("user_id", user.id).single()).data!.notify_chat_email).toBe(false);
    await admin().from("profiles").update({ notify_chat_email: true }).eq("user_id", user.id);
    await ctx.dispose();
  });

  // F2 (niedrig, behoben): Die Route setzt Referrer-Policy no-referrer und eine eigene CSP (DONE_CSP); next.config.ts nimmt
  // /api/unsubscribe von der allgemeinen Header-Regel aus.
  test("F2: POST/GET /api/unsubscribe behalten Referrer-Policy no-referrer und die CSP der Bestätigung", async ({ request }) => {
    const t = "0".repeat(64);
    const post = await request.post(`/api/unsubscribe?t=${t}`, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" }, data: "List-Unsubscribe=One-Click", maxRedirects: 0,
    });
    const get = await request.get(`/api/unsubscribe?t=${t}`, { maxRedirects: 0 });
    expect(post.headers()["content-security-policy"]).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    expect([post.headers()["referrer-policy"], get.headers()["referrer-policy"]]).toEqual(["no-referrer", "no-referrer"]);
  });

  test("Konto-Seite ohne JavaScript: Pausieren, Fortsetzen, E-Mail aus, Takt, Umbenennen, Verlängern, Löschen", async ({ browser }) => {
    const s = await search(user, `OhneJS ${RUN}`);
    await admin().from("saved_searches").update({ expires_at: new Date(Date.now() + 3 * 864e5).toISOString() }).eq("id", s);
    const context = await browser.newContext({ javaScriptEnabled: false });
    await signInAs(context, user);
    const page = await context.newPage();
    await page.goto("/de/account/searches");
    const item = () => page.locator(`#search-${s}`);
    const status = page.getByRole("status");

    await item().getByRole("button", { name: "Pausieren" }).click();
    await expect(status).toHaveText("Der Suchauftrag ist pausiert.");
    expect((await row(s)).paused_at).not.toBeNull();
    await item().getByRole("button", { name: "Fortsetzen" }).click();
    await expect(status).toHaveText("Der Suchauftrag ist wieder aktiv.");
    await item().getByRole("button", { name: "E-Mail ausschalten" }).click();
    await expect(status).toHaveText("E-Mails sind ausgeschaltet.");
    await item().getByRole("button", { name: "Auf täglich umstellen" }).click();
    await expect(status).toHaveText("Die Häufigkeit der E-Mails ist geändert.");
    const before = new Date((await row(s)).expires_at).getTime();
    await item().getByRole("button", { name: "Um 6 Wochen verlängern" }).click();
    await expect(status).toHaveText("Der Suchauftrag läuft jetzt weitere 6 Wochen.");
    expect(new Date((await row(s)).expires_at).getTime() - before).toBeGreaterThan(38 * 864e5);
    await item().getByText("Umbenennen", { exact: true }).click();
    await item().getByLabel("Name", { exact: true }).fill(`OhneJS neu ${RUN}`);
    await item().getByRole("button", { name: "Namen speichern" }).click();
    await expect(status).toHaveText("Der Name ist gespeichert.");
    expect(await row(s)).toMatchObject({ name: `OhneJS neu ${RUN}`, cadence: "daily", notify_email: false, paused_at: null });
    await item().getByRole("link", { name: "Löschen" }).click();
    await item().getByRole("button", { name: "Endgültig löschen" }).click();
    await expect(status).toHaveText("Der Suchauftrag ist gelöscht.");
    expect((await admin().from("saved_searches").select("id").eq("id", s)).data).toEqual([]);
    await context.close();
  });

  test("Nur Tastatur: Suche speichern und auf der Konto-Seite pausieren", async ({ page }) => {
    await signInAs(page.context(), user);
    await page.goto(`/de/suche?kind=helper&q=${RUN}tast`);
    const summary = page.locator("summary", { hasText: "Suche speichern" });
    for (let i = 0; i < 80 && !(await summary.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
    await expect(summary).toBeFocused();
    await page.keyboard.press("Enter");
    const name = page.getByLabel("Name", { exact: true });
    for (let i = 0; i < 10 && !(await name.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
    await expect(name).toBeFocused();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type(`Tastatur ${RUN}`);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/de\/account\/searches\?notice=created/);
    const { data } = await admin().from("saved_searches").select("id").eq("user_id", user.id).eq("name", `Tastatur ${RUN}`).single();
    const pause = page.locator(`#search-${data!.id}`).getByRole("button", { name: "Pausieren" });
    for (let i = 0; i < 80 && !(await pause.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
    await expect(pause).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status")).toHaveText("Der Suchauftrag ist pausiert.");
  });

  for (const locale of ["en", "cs", "pl"] as const) {
    test(`${locale}: axe und 360 px mit pausiertem, abgelaufenem Auftrag, Fehlermeldung, langem Namen; Bestätigung nach dem POST`, async ({ browser }) => {
      const paused = await search(user, `${locale} ${"Pausiert".repeat(12)}`.slice(0, 100));
      const expired = await search(user, `${locale} abgelaufen ${RUN}`);
      await admin().from("saved_searches").update({ paused_at: new Date().toISOString() }).eq("id", paused);
      await admin().from("saved_searches").update({ expires_at: new Date(Date.now() - 864e5).toISOString() }).eq("id", expired);
      const context = await browser.newContext({ viewport: { width: 360, height: 800 } });
      await signInAs(context, user);
      const page = await context.newPage();
      await page.goto(`/${locale}/account/searches?error=extendNotYet`);
      await expect(page.locator("main").getByRole("alert")).toBeVisible();
      await expect(page.locator(`#search-${paused}`)).toBeVisible();
      expect(await page.locator("main").innerText()).not.toMatch(/SavedSearches\.|\{date\}|\{name\}/);
      await noOverflow(page, `${locale} Konto`);
      await axe(page, `${locale} Konto`);

      await page.goto(`/${locale}/unsubscribe?t=${chatToken(user)}`);
      await noOverflow(page, `${locale} Abbestellen`);
      await axe(page, `${locale} Abbestellen`);
      await page.locator("main form button[type=submit]").click();
      await expect(page.getByRole("status")).toBeVisible();
      expect(await page.locator("html").getAttribute("lang")).toBe(locale);
      await noOverflow(page, `${locale} Bestätigung`);
      await axe(page, `${locale} Bestätigung`);
      await admin().from("profiles").update({ notify_chat_email: true }).eq("user_id", user.id);
      await admin().from("saved_searches").delete().in("id", [paused, expired]);
      await context.close();
    });
  }
});
