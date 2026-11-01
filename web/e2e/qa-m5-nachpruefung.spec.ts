import { createClient } from "@supabase/supabase-js";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { admin, deleteTestUsers, local } from "./cleanup";
import { uniqueEmail } from "./mailpit";

// QA M5 Nachprüfung (docs/QA-REPORT.md, Abschnitt „M5 – Nachprüfung 2026-11-01“): Proben zu den Fixes F1–F11
// über qa-m5.spec.ts hinaus.
// - F9: Suchtext im Rücksprung nur per POST, auch nicht im Login- oder Welcome-Link, wenn die Action umleitet
// - F3: gemischte Favoriten (verfügbar und nicht verfügbar), Entfernen lässt die verfügbaren stehen
// - F2: eigener Text für zu langen Suchbegriff in vier Sprachen
// - F8: alle Leaf-Bereiche, geschützte Bereiche mit und ohne Login
// - F10: X-Robots-Tag aus dem Proxy auf Redirects, 403, 404, 410, und auf Pfaden außerhalb des Matchers
// - F5: Anbieter- und Kategorieseite bei 360 px in vier Sprachen; F6: befüllte Seiten behalten hreflang
// - F11: Entfernen wirkt sofort in der Sitemap
// Konten per service_role in Node, Löschung in afterAll. Gegen den Produktions-Build mit QA_BASE_URL.

const BASE = process.env.QA_BASE_URL ?? "http://localhost:3000";
if (process.env.QA_BASE_URL) test.use({ baseURL: process.env.QA_BASE_URL });

const created: string[] = [];
test.afterAll(() => deleteTestUsers(created));
test.describe.configure({ mode: "serial" });

const RUN = `n${Date.now().toString(36)}`;
const EXPIRES = () => new Date(Date.now() + 7 * 86_400_000).toISOString();
const LOCALES = ["de", "en", "cs", "pl"] as const;
const PROVIDER = { de: "anbieter", en: "provider", cs: "inzerent", pl: "oglaszajacy" } as const;
const SEARCH = { de: "suche", en: "search", cs: "hledani", pl: "szukaj" } as const;
const LEASE = { de: "jagdpacht", en: "hunting-lease", cs: "pronajem-honitby", pl: "dzierzawa-obwodu" } as const;
const TOO_LONG = {
  de: "Der Suchbegriff ist zu lang.",
  en: "The search term is too long.",
  cs: "Hledaný výraz je příliš dlouhý.",
  pl: "Szukana fraza jest za długa.",
} as const;

function env(): Record<string, string> {
  const out = execFileSync("supabase", ["status", "-o", "env"], {
    cwd: path.resolve(process.cwd(), ".."), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 30_000,
  });
  return Object.fromEntries(out.split("\n").flatMap((line) => {
    const m = /^([A-Z0-9_]+)="?(.*?)"?$/.exec(line.trim());
    return m ? [[m[1], m[2]]] : [];
  }));
}
const ANON = (() => { try { const e = env(); return e.ANON_KEY || e.PUBLISHABLE_KEY; } catch { return ""; } })();

type Owner = { id: string; email: string };

async function owner(name: string, type: "private" | "business" = "private", business?: string): Promise<Owner> {
  const service = admin();
  const email = uniqueEmail("qa-m5n");
  created.push(email);
  const { data } = await service.auth.admin.createUser({ email, email_confirm: true });
  const id = data.user!.id;
  await service.from("profiles").update({ display_name: name, account_type: type, business_name: type === "business" ? (business ?? `${name} GmbH`) : null }).eq("user_id", id);
  return { id, email };
}

async function regionId(code: string): Promise<string> {
  const { data } = await admin().from("regions").select("id").eq("code", code).single();
  return data!.id;
}

type Row = Record<string, unknown>;
async function listings(rows: Row[]): Promise<string[]> {
  const { data, error } = await admin().from("listings").insert(rows).select("id");
  expect(error).toBeNull();
  return data!.map((r) => r.id as string);
}

async function base(who: Owner, title: string, extra: Row = {}): Promise<Row> {
  return {
    owner_id: who.id, kind: "lease", direction: "offer", title, content_language: "de", region_id: await regionId("DE-09162"),
    description: "Öffentliche Beschreibung mit mehr als dreißig Zeichen für den QA-Test.", status: "active", expires_at: EXPIRES(),
    price_minor: 400_000, currency: "EUR", price_unit: "per_year", ...extra,
  };
}

async function bumpCache(who: Owner) {
  const [id] = await listings([await base(who, `QA5N ${RUN} Zähler`, { kind: "helper" })]);
  await admin().from("listings").update({ status: "removed" }).eq("id", id);
}

function anonClient() {
  return createClient(local!.url, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function signInAs(context: BrowserContext, who: Owner, accept = true) {
  const service = admin();
  const client = anonClient();
  const link = await service.auth.admin.generateLink({ type: "magiclink", email: who.email });
  const verified = await client.auth.verifyOtp({ token_hash: link.data.properties!.hashed_token, type: "email" });
  if (verified.error) throw verified.error;
  if (accept) {
    const { data: legal } = await client.rpc("legal_status").single<{ terms_version: string; privacy_version: string }>();
    await client.rpc("accept_legal", { p_terms_version: legal!.terms_version, p_privacy_version: legal!.privacy_version, p_source: "web" });
  }
  const { data } = await client.auth.getSession();
  const name = `sb-${new URL(local!.url).hostname.split(".")[0]}-auth-token`;
  const value = `base64-${Buffer.from(JSON.stringify(data.session)).toString("base64url")}`;
  const chunks = value.length <= 3180 ? [value] : (value.match(/.{1,3180}/g) ?? []);
  await context.addCookies(chunks.map((chunk, i) => ({ name: chunks.length === 1 ? name : `${name}.${i}`, value: chunk, url: BASE, sameSite: "Lax" as const })));
}

async function cardIds(page: Page): Promise<string[]> {
  const hrefs = await page.locator("article h3 a").evaluateAll((links) => links.map((a) => a.getAttribute("href") ?? ""));
  return hrefs.map((h) => h.split("/").pop()!);
}

test.describe("QA M5 Nachprüfung: Favoriten und Rücksprung", () => {
  test.skip(!local, "Lokale Supabase nötig");

  let seller: Owner;
  let target = "";

  test.beforeAll(async () => {
    seller = await owner(`QA5N Verkäufer ${RUN}`);
    [target] = await listings([await base(seller, `QA5N ${RUN} Suchziel Ort`)]);
    await bumpCache(seller);
  });

  test("F9 (N2): Merken mit abgelaufener Sitzung – Login-Link ohne Suchtext", async ({ page }) => {
    const fan = await owner(`QA5N Abgelaufen ${RUN}`);
    await signInAs(page.context(), fan);
    await page.goto(`/de/suche?q=${RUN}+Suchziel`);
    expect(await cardIds(page)).toEqual([target]);
    await page.context().clearCookies();
    await page.locator("main article").getByRole("button", { name: /merken/ }).click();
    await page.waitForURL(/\/de\/login/);
    expect(decodeURIComponent(page.url()), "Suchtext im Login-Link (H10)").not.toContain(RUN);
  });

  test("F9 (N2): Merken ohne aktuelle Zustimmung – Welcome-Link ohne Suchtext", async ({ page }) => {
    const fan = await owner(`QA5N Ohne Zustimmung ${RUN}`);
    await signInAs(page.context(), fan, false);
    await page.goto(`/de/suche?q=${RUN}+Suchziel`);
    const button = page.locator("main article").getByRole("button", { name: /merken/ });
    await expect(button).toHaveCount(1);
    await button.click();
    await page.waitForURL(/\/de\/welcome/);
    expect(decodeURIComponent(page.url()), "Suchtext im Welcome-Link (H10)").not.toContain(RUN);
  });

  test("F9: Manipulierter Rücksprung bleibt auf derselben Origin (keepSearchText)", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    const fan = await owner(`QA5N Umleitung ${RUN}`);
    await signInAs(context, fan);
    await page.goto(`/de/suche?q=${RUN}+Suchziel`);
    for (const back of ["//evil.example/de/suche?q=x", "/de/suche?q=x&next=https://evil.example", "/de/suche?q=%0d%0aSet-Cookie:x=y"]) {
      await page.goto(`/de/suche?q=${RUN}+Suchziel`);
      await page.locator('main form input[name="back"]').first().evaluate((input, v) => { (input as HTMLInputElement).value = v; }, back);
      await Promise.all([page.waitForEvent("load"), page.locator("main article").getByRole("button", { name: /merken/ }).click()]);
      expect(new URL(page.url()).origin, back).toBe(new URL(BASE).origin);
      expect(page.url(), back).not.toContain("evil");
      expect((await context.cookies()).some((c) => c.name === "x"), back).toBe(false);
    }
    await context.close();
  });

  test("F3: 230 verfügbare und 2 nicht verfügbare – Entfernen lässt die verfügbaren stehen", async ({ page }) => {
    const fan = await owner(`QA5N Sammler ${RUN}`);
    const row = await base(seller, `QA5N ${RUN} Masse`, { kind: "helper", price_minor: null, currency: null, price_unit: null });
    const ids = await listings(Array.from({ length: 232 }, () => row));
    const { error } = await admin().from("favorites").insert(ids.map((id) => ({ user_id: fan.id, listing_id: id })));
    expect(error).toBeNull();
    await admin().from("listings").update({ status: "paused" }).in("id", ids.slice(0, 2));
    await signInAs(page.context(), fan);
    await page.goto("/de/account/favorites");
    expect((await cardIds(page)).length).toBe(230);
    await expect(page.getByText("2 gemerkte Anzeigen sind nicht mehr verfügbar.")).toBeVisible();
    await Promise.all([page.waitForURL(/notice=removed/), page.getByRole("button", { name: "Nicht mehr verfügbare entfernen" }).click()]);
    const { count } = await admin().from("favorites").select("*", { count: "exact", head: true }).eq("user_id", fan.id);
    expect(count).toBe(230);
    expect((await cardIds(page)).length).toBe(230);
    await expect(page.getByRole("button", { name: "Nicht mehr verfügbare entfernen" })).toHaveCount(0);
  });
});

test.describe("QA M5 Nachprüfung: Suche, Layout, SEO", () => {
  test.skip(!local, "Lokale Supabase nötig");

  let firm: Owner;
  let pub = "";
  let gone = "";

  test.beforeAll(async () => {
    firm = await owner(`QA5N Firma ${RUN}`, "business", `QA5N Forstbetriebsgemeinschaftsgesellschaft ${RUN}`);
    [pub, gone] = await listings([
      await base(firm, `QA5N ${RUN} Rehwildbestandsregulierungsmaßnahmen`),
      await base(firm, `QA5N ${RUN} Wird entfernt`),
    ]);
    await admin().from("listings").update({ status: "removed" }).eq("id", gone);
  });

  test("F2: 17 Wörter ergeben in vier Sprachen den eigenen Hinweis, 16 Wörter nicht", async ({ page }) => {
    const words = (n: number) => Array.from({ length: n }, (_, i) => `wort${i}`).join(" ");
    for (const locale of LOCALES) {
      await page.goto(`/${locale}/${SEARCH[locale]}?q=${encodeURIComponent(words(17))}`);
      await expect(page.getByRole("alert").filter({ hasText: TOO_LONG[locale] })).toBeVisible();
    }
    await page.goto(`/de/suche?q=${encodeURIComponent(words(16))}`);
    await expect(page.getByText(TOO_LONG.de)).toHaveCount(0);
    await expect(page.getByText("Die Filter sind ungültig.")).toHaveCount(0);
  });

  test("F8: Leaf-Bereiche mit Unterpfad 404 (ohne Login), Bereiche selbst 200", async ({ request }) => {
    for (const url of ["/de/imprint/x", "/de/login/x", "/de/privacy/a/b", "/de/forbidden/x", "/de/terms/x", "/de/missing/x", "/en/imprint/x", "/pl/terms/a/b"]) {
      const response = await request.get(url, { maxRedirects: 0 });
      expect(response.status(), url).toBe(404);
      expect(response.headers()["x-robots-tag"], url).toContain("noindex");
    }
    for (const url of ["/de/imprint", "/de/privacy", "/de/terms", "/de/login"]) {
      expect((await request.get(url, { maxRedirects: 0 })).status(), url).toBe(200);
    }
    // Geschützte Bereiche ohne Login: zuerst der Login-Redirect (kein Orakel über existierende Unterseiten)
    for (const url of ["/de/welcome/x", "/de/account/x"]) {
      const response = await request.get(url, { maxRedirects: 0 });
      expect(response.status(), url).toBe(307);
      expect(response.headers().location, url).toContain("/de/login?next=");
    }
  });

  test("F8: mit Login – /de/welcome/x 404, Bereiche selbst 200", async ({ page }) => {
    const fan = await owner(`QA5N Leaf ${RUN}`);
    await signInAs(page.context(), fan);
    expect((await page.request.get("/de/welcome/x", { maxRedirects: 0 })).status()).toBe(404);
    expect((await page.request.get("/de/account/favorites", { maxRedirects: 0 })).status()).toBe(200);
  });

  test("F8 Rest: unbekannte Unterpfade von Bereichen mit Unterseiten (account, auth) ergeben 404", async ({ page }) => {
    const fan = await owner(`QA5N Nicht-Leaf ${RUN}`);
    await signInAs(page.context(), fan);
    for (const url of ["/de/account/x", "/de/account/favorites/x", "/de/account/listings/x/y", "/de/auth/x", "/de/auth/confirm/x"]) {
      expect((await page.request.get(url, { maxRedirects: 0 })).status(), url).toBe(404);
    }
    await page.context().clearCookies();
    expect((await page.request.get("/de/auth/x", { maxRedirects: 0 })).status(), "/de/auth/x ohne Login").toBe(404);
  });

  test("F10: X-Robots-Tag aus dem Proxy auf 307, 308, 403, 404, 410; 410 behält CSP", async ({ page, request }) => {
    const cases: [string, number][] = [
      ["/de/account", 307],
      [`/de/%61nzeige/${pub}`, 308],
      ["/DE/imprint", 307],
      ["/de/imprint/x", 404],
      [`/de/anzeige/${gone}`, 410],
      [`/de/${SEARCH.de}?q=x`, 200],
    ];
    for (const [url, status] of cases) {
      const response = await request.get(url, { maxRedirects: 0 });
      expect(response.status(), url).toBe(status);
      expect(response.headers()["x-robots-tag"], url).toBe("noindex");
    }
    expect((await request.get(`/de/anzeige/${gone}`)).headers()["content-security-policy"]).toContain("default-src 'none'");
    const fan = await owner(`QA5N Kein Admin ${RUN}`);
    await signInAs(page.context(), fan);
    const forbidden = await page.request.get("/de/admin", { maxRedirects: 0 });
    expect(forbidden.status()).toBe(403);
    expect(forbidden.headers()["x-robots-tag"]).toBe("noindex");
    expect(forbidden.headers()["cache-control"]).toContain("no-store");
  });

  test("F10 (N1): X-Robots-Tag auch außerhalb des Proxy-Matchers (Sitemap, robots, Foto-Route, Schrägstrich-Redirect)", async ({ request }) => {
    for (const url of ["/sitemap/de.xml", "/robots.txt", "/api/photos/00000000-0000-0000-0000-000000000000/full", "/de/jagdpacht/"]) {
      const response = await request.get(url, { maxRedirects: 0 });
      expect(response.headers()["x-robots-tag"], `${url} (${response.status()})`).toContain("noindex");
    }
  });

  test("F5: 360 px ohne Überbreite auf Anbieter-, Kategorie-, Such- und Startseite in vier Sprachen", async ({ page }) => {
    await bumpCache(firm);
    await page.setViewportSize({ width: 360, height: 800 });
    for (const locale of LOCALES) {
      for (const url of [`/${locale}/${PROVIDER[locale]}/${firm.id}`, `/${locale}/${LEASE[locale]}`, `/${locale}/${SEARCH[locale]}?q=${RUN}`, `/${locale}`]) {
        await page.goto(url);
        const width = await page.evaluate(() => document.documentElement.scrollWidth);
        expect(width, `${url}: Überbreite bei 360 px`).toBeLessThanOrEqual(360);
      }
    }
  });

  test("F6: befüllte Kategorieseite behält Canonical und hreflang in vier Sprachen", async ({ page }) => {
    for (const locale of LOCALES) {
      await page.goto(`/${locale}/${LEASE[locale]}`);
      await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
      await expect(page.locator('link[rel="alternate"][hreflang]')).toHaveCount(5);
      await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(0);
    }
  });

  test("F11: Entfernen wirkt sofort in der Sitemap, ohne weiteren Zähler-Anstoß", async ({ request }) => {
    const [fresh] = await listings([await base(firm, `QA5N ${RUN} Sitemap frisch`)]);
    await bumpCache(firm);
    expect(await (await request.get("/sitemap/de.xml")).text()).toContain(fresh);
    await admin().from("listings").update({ status: "removed" }).eq("id", fresh);
    expect(await (await request.get("/sitemap/de.xml")).text()).not.toContain(fresh);
    expect(await (await request.get("/sitemap/pl.xml")).text()).not.toContain(fresh);
  });
});
