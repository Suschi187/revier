import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { admin, deleteTestUsers, local } from "./cleanup";
import { uniqueEmail } from "./mailpit";

// QA M5 (docs/QA-REPORT.md, Abschnitt „M5 – Abnahme“): ergänzende Prüfungen zu öffentlichen Seiten und Suche.
// - Datenschutz: keine PLZ, kein Ort, keine Storage-Pfade in Seiten, Suche, Sitemap; UGC mit Skript-Tags
// - Cache: keine Session-Inhalte in anonym ausgelieferten Seiten
// - Paging bei gleichen Sortierschlüsseln, Suchtext mit sechs Wörtern, Favoriten über 220 Einträge
// - SEO-Signale (leere Seiten, Statuscodes, robots/Sitemap außerhalb von Prod)
// - ohne JavaScript, 360 px in vier Sprachen, axe auf weiteren Seiten, Login-Rücksprung über den Bestätigungslink
// - sofortige Wirkung beim Sperren auch auf Anbieterseite, Suche mit Text und Favoriten
// Die Funde F1–F11 standen hier als test.fail und sind seit den Fixes (2026-11-01) normale Tests. Testdaten legt der
// Testcode mit service_role an (nur Node) und löscht die Konten in afterAll. Gegen den Produktions-Build:
// QA_BASE_URL=http://localhost:3456 npx playwright test e2e/qa-m5.spec.ts

const BASE = process.env.QA_BASE_URL ?? "http://localhost:3000";
if (process.env.QA_BASE_URL) test.use({ baseURL: process.env.QA_BASE_URL });

const created: string[] = [];
test.afterAll(() => deleteTestUsers(created));
test.describe.configure({ mode: "serial" });

const RUN = Date.now().toString(36);
const EXPIRES = () => new Date(Date.now() + 7 * 86_400_000).toISOString();
const LOCALES = ["de", "en", "cs", "pl"] as const;
const DETAIL = { de: "anzeige", en: "listing", cs: "inzerat", pl: "ogloszenie" } as const;
const PROVIDER = { de: "anbieter", en: "provider", cs: "inzerent", pl: "oglaszajacy" } as const;
const SEARCH = { de: "suche", en: "search", cs: "hledani", pl: "szukaj" } as const;
const LEASE = { de: "jagdpacht", en: "hunting-lease", cs: "pronajem-honitby", pl: "dzierzawa-obwodu" } as const;
const XSS = `QA5 ${RUN} </script><script>alert("t")</script> & <img src=x onerror=alert("i")>`;
const TIE = `Gleichstand${RUN}`;

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
  const email = uniqueEmail("qa-m5");
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

async function photo(listingId: string): Promise<{ id: string; storage: string }> {
  const service = admin();
  const { data } = await service.from("listing_photos")
    .insert({ listing_id: listingId, sort_order: 0, processed_at: new Date().toISOString(), width: 800, height: 600 })
    .select("id, storage_path, thumb_path").single();
  const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" });
  for (const p of [data!.storage_path, data!.thumb_path]) await service.storage.from("listing-photos").upload(p!, jpeg, { upsert: true });
  return { id: data!.id, storage: data!.storage_path! };
}

/** Neue Anzeigen erscheinen in gecachten Listen nach bis zu 5 min; eine Entfernung erhöht den Cache-Zähler. */
async function bumpCache(who: Owner) {
  const [id] = await listings([await base(who, `QA5 ${RUN} Zähler`, { kind: "helper" })]);
  await admin().from("listings").update({ status: "removed" }).eq("id", id);
}

async function signInAs(context: BrowserContext, who: Owner) {
  const service = admin();
  const client = anonClient();
  const link = await service.auth.admin.generateLink({ type: "magiclink", email: who.email });
  const verified = await client.auth.verifyOtp({ token_hash: link.data.properties!.hashed_token, type: "email" });
  if (verified.error) throw verified.error;
  await acceptLegal(client);
  const { data } = await client.auth.getSession();
  const name = `sb-${new URL(local!.url).hostname.split(".")[0]}-auth-token`;
  const value = `base64-${Buffer.from(JSON.stringify(data.session)).toString("base64url")}`;
  const chunks = value.length <= 3180 ? [value] : (value.match(/.{1,3180}/g) ?? []);
  await context.addCookies(chunks.map((chunk, i) => ({ name: chunks.length === 1 ? name : `${name}.${i}`, value: chunk, url: BASE, sameSite: "Lax" as const })));
}

function anonClient() {
  return createClient(local!.url, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function acceptLegal(client: ReturnType<typeof anonClient>) {
  const { data: legal } = await client.rpc("legal_status").single<{ terms_version: string; privacy_version: string }>();
  await client.rpc("accept_legal", { p_terms_version: legal!.terms_version, p_privacy_version: legal!.privacy_version, p_source: "web" });
}

async function cardIds(page: Page): Promise<string[]> {
  const hrefs = await page.locator("article h3 a").evaluateAll((links) => links.map((a) => a.getAttribute("href") ?? ""));
  return hrefs.map((h) => h.split("/").pop()!);
}

async function anonSearch(filters: object): Promise<string> {
  const response = await fetch(`${local!.url}/rest/v1/rpc/search_listings`, {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ p_filters: filters, p_limit: 50 }),
  });
  return response.text();
}

async function noOverflow(page: Page, url: string) {
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width, `${url}: Überbreite bei 360 px`).toBeLessThanOrEqual(360);
}

test.describe("QA M5: Datenschutz, UGC und Cache", () => {
  test.skip(!local, "Lokale Supabase nötig");

  let firm: Owner;
  let priv: Owner;
  const ids: Record<string, string> = {};
  let plz = "";
  let storage = "";

  test.beforeAll(async () => {
    firm = await owner("QA5 Firma", "business", `QA5 <b>Forst</b> & Co ${RUN}`);
    priv = await owner(`QA5 Privat ${RUN}`);
    [ids.xss, ids.place] = await listings([
      await base(firm, XSS, { description: `Text </script><script>alert("d")</script> https://evil.example ${RUN} lang genug.`, currency: "CHF", price_minor: 123_456 }),
      await base(priv, `QA5 ${RUN} Mit Ort`, { kind: "permit", price_minor: 20_000 }),
    ]);
    const service = admin();
    const { data: code } = await service.from("postal_code_regions").select("code").eq("region_id", await regionId("DE-09162")).order("code").limit(1).single();
    plz = code!.code as string;
    const { error } = await service.from("listing_places").insert({ listing_id: ids.place, postal_code: plz, place_name: `Geheimhausen${RUN}` });
    expect(error).toBeNull();
    const p = await photo(ids.place);
    ids.photo = p.id;
    storage = p.storage;
    await bumpCache(priv);
  });

  test("Weder PLZ noch Ort noch Storage-Pfade in Detail, Listen, Profil, Sitemap und Such-RPC", async ({ page, request }) => {
    const urls = [
      `/de/anzeige/${ids.place}`, `/pl/ogloszenie/${ids.place}`, `/de/suche?q=${RUN}`, `/de/begehungsschein/bayern/muenchen-stadt`,
      "/de", `/de/anbieter/${priv.id}`, "/sitemap/de.xml",
    ];
    for (const url of urls) {
      const body = await (await request.get(url)).text();
      expect(body, url).not.toContain(`Geheimhausen${RUN}`);
      expect(body, url).not.toContain(plz);
      expect(body, url).not.toContain("listing-photos");
      expect(body, url).not.toContain(storage);
    }
    const rpc = await anonSearch({ v: 1, q: RUN });
    expect(rpc).not.toContain(`Geheimhausen${RUN}`);
    expect(rpc).not.toContain(plz);
    expect(rpc).toContain(ids.place);
    await page.goto(`/de/anzeige/${ids.place}`);
    await expect(page.locator("main")).toContainText(`PLZ-Bereich ${plz.slice(0, 2)}…`);
    // Open Graph mit absoluter URL der großen Fassung (Review A5)
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", new RegExp(`^https?://[^/]+/api/photos/${ids.photo}/full$`));
  });

  test("UGC mit Skript-Tags: keine Ausführung; Titel, JSON-LD und Open Graph unverändert als Text", async ({ page }) => {
    const dialogs: string[] = [];
    page.on("dialog", async (d) => { dialogs.push(d.message()); await d.dismiss(); });
    for (const url of [`/de/anzeige/${ids.xss}`, `/en/listing/${ids.xss}`, `/de/suche?q=${RUN}`, `/de/anbieter/${firm.id}`]) {
      await page.goto(url);
      await page.waitForLoadState("networkidle");
    }
    expect(dialogs).toEqual([]);
    await page.goto(`/de/anzeige/${ids.xss}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(XSS);
    const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
    const crumbs = blocks.map((b) => JSON.parse(b)).find((d) => d["@type"] === "BreadcrumbList");
    expect(crumbs.itemListElement.at(-1).name).toBe(XSS);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", XSS);
    expect(await page.title()).toContain(XSS);
    // Beschreibung ohne Autolinks (Review A11), Firmenname als Text
    await expect(page.locator('main a[href^="https://evil"]')).toHaveCount(0);
    await expect(page.locator("main")).toContainText(`QA5 <b>Forst</b> & Co ${RUN}`);
  });

  test("Session-Inhalte landen nicht im Cache anonymer Seiten (Review B3)", async ({ page, browser }) => {
    const fan = await owner(`QA5 Fan ${RUN}`);
    await signInAs(page.context(), fan);
    await page.goto(`/de/anzeige/${ids.place}`);
    await page.locator("main").getByRole("button", { name: /merken/ }).click();
    await expect(page.locator("main").getByRole("button", { name: /merken/ })).toHaveAttribute("aria-pressed", "true");
    const pages = ["/de", "/de/begehungsschein", `/de/begehungsschein/bayern/muenchen-stadt`, `/de/anzeige/${ids.place}`, `/de/anbieter/${priv.id}`, `/de/suche?q=${RUN}`];
    for (const url of pages) {
      const signed = await page.goto(url);
      expect(signed!.headers()["cache-control"], url).toMatch(/private|no-store/);
      await expect(page.getByRole("button", { name: "Abmelden" }), url).toBeVisible();
    }
    const anon = await browser.newContext();
    const other = await anon.newPage();
    for (const url of pages) {
      const response = await other.goto(url);
      expect(response!.headers()["cache-control"], url).toMatch(/private|no-store/);
      const html = await other.content();
      expect(html, url).not.toContain(`QA5 Fan ${RUN}`);
      expect(html, url).not.toContain('aria-pressed="true"');
      await expect(other.getByRole("button", { name: "Abmelden" }), url).toHaveCount(0);
      await expect(other.getByRole("link", { name: "Anmelden" }).first(), url).toBeVisible();
    }
    await anon.close();
  });

  test("Eigene Anzeige lässt sich per Server Action nicht merken (A10, F4)", async ({ browser }) => {
    // Ohne JavaScript, damit das Formular so abgeschickt wird, wie es im DOM steht (manipulierter POST)
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await signInAs(context, priv);
    await page.goto(`/de/anzeige/${ids.xss}`);
    // Formular einer fremden Anzeige, ID auf die eigene umgeschrieben (wie ein manipulierter POST)
    await page.locator('main form input[name="id"]').evaluate((input, id) => { (input as HTMLInputElement).value = id; }, ids.place);
    await Promise.all([page.waitForEvent("load"), page.locator("main").getByRole("button", { name: /merken/ }).click()]);
    const { count } = await admin().from("favorites").select("*", { count: "exact", head: true }).eq("user_id", priv.id).eq("listing_id", ids.place);
    await context.close();
    expect(count).toBe(0);
  });

  test("Eigene Anzeige: weder Merken noch Kontakt, Hinweis statt Button", async ({ page }) => {
    await signInAs(page.context(), priv);
    await page.goto(`/de/anzeige/${ids.place}`);
    await expect(page.locator("main").getByRole("button", { name: /merken/ })).toHaveCount(0);
    await expect(page.locator("main")).toContainText("Das ist deine Anzeige.");
    await expect(page.locator("main").getByRole("link", { name: /kontaktieren/ })).toHaveCount(0);
    await page.goto(`/de/anzeige/${ids.xss}`);
    await expect(page.locator("main")).toContainText("Nachrichten an Anbieter folgen in Kürze.");
    await expect(page.locator('main a[href*="/login"]')).toHaveCount(0);
  });

  test("Merken in der Textsuche führt zurück zur selben Suche (F9: q fällt weg)", async ({ page }) => {
    const fan = await owner(`QA5 Sucher ${RUN}`);
    await signInAs(page.context(), fan);
    await page.goto(`/de/suche?q=${RUN}+Ort`);
    expect(await cardIds(page)).toEqual([ids.place]);
    // Ohne Login enthält der Login-Link den Suchtext (H10); mit Login fällt er beim Rücksprung weg
    const before = page.url();
    await page.locator("main article").getByRole("button", { name: /merken/ }).click();
    await expect(page.locator(`main article:has(a[href$="${ids.place}"])`).getByRole("button", { name: /merken/ })).toHaveAttribute("aria-pressed", "true");
    expect(page.url(), "Rücksprung auf dieselbe Suche").toBe(before);
  });

  test("Ohne Login: Merken-Link in der Textsuche trägt den Suchtext nicht im next-Parameter (H10, F9)", async ({ page }) => {
    await page.goto(`/de/suche?q=${RUN}+Ort`);
    const href = await page.locator("main article").getByRole("link", { name: /merken/ }).getAttribute("href");
    expect(decodeURIComponent(href!)).not.toContain(RUN);
    expect(decodeURIComponent(href!)).toContain("next=/de/suche");
  });

  test("Sperren wirkt sofort auch auf Anbieterseite, Textsuche und Favoriten", async ({ page, request }) => {
    const fan = await owner(`QA5 Fan2 ${RUN}`);
    const who = await owner(`QA5 Sperre ${RUN}`);
    const [id] = await listings([await base(who, `QA5 ${RUN} Sperrfall`, { kind: "helper" })]);
    await admin().from("favorites").insert({ user_id: fan.id, listing_id: id });
    await signInAs(page.context(), fan);
    expect((await request.get(`/de/anbieter/${who.id}`)).status()).toBe(200);
    await page.goto(`/de/suche?q=${RUN}+Sperrfall`);
    expect(await cardIds(page)).toEqual([id]);
    await page.goto("/de/account/favorites");
    expect(await cardIds(page)).toContain(id);

    await admin().from("profiles").update({ is_blocked: true }).eq("user_id", who.id);
    expect((await request.get(`/de/anbieter/${who.id}`)).status()).toBe(410);
    expect((await request.get(`/de/anzeige/${id}`)).status()).toBe(410);
    await page.goto(`/de/suche?q=${RUN}+Sperrfall`);
    expect(await cardIds(page)).toEqual([]);
    await page.goto("/de/account/favorites");
    expect(await cardIds(page)).not.toContain(id);
    await expect(page.getByText(/nicht mehr verfügbar/)).toBeVisible();
  });
});

test.describe("QA M5: Paging, Suchtext und viele Favoriten", () => {
  test.skip(!local, "Lokale Supabase nötig");

  let seller: Owner;
  let fan: Owner;
  let tieIds: string[] = [];

  test.beforeAll(async () => {
    seller = await owner(`QA5 Massen ${RUN}`);
    fan = await owner(`QA5 Sammler ${RUN}`);
    // Ein Insert = eine Transaktion: alle haben dasselbe published_at und denselben Text (gleicher Rang)
    const row = await base(seller, `QA5 ${TIE} Keiler`, { kind: "trophy_hunt", description: `${TIE} Keiler ${TIE} Beschreibung, lang genug für den Test.`, price_minor: 100_000, currency: "PLN", price_unit: "per_animal" });
    tieIds = await listings(Array.from({ length: 230 }, () => row));
  });

  async function walk(page: Page, url: string, maxPages: number): Promise<string[]> {
    await page.goto(url);
    const seen: string[] = [];
    for (let i = 0; i < maxPages; i++) {
      seen.push(...(await cardIds(page)));
      const next = page.getByRole("link", { name: "Nächste Seite" });
      if ((await next.count()) === 0) break;
      await Promise.all([page.waitForEvent("load"), next.click()]);
    }
    return seen;
  }

  test("newest mit gleichem published_at: drei Seiten ohne Doppelte", async ({ page }) => {
    const seen = await walk(page, `/de/suche?q=${TIE}`, 3);
    expect(seen).toHaveLength(60);
    expect(new Set(seen).size).toBe(60);
  });

  test("Preis aufsteigend mit gleichem Preis: drei Seiten ohne Doppelte", async ({ page }) => {
    const seen = await walk(page, `/de/suche?q=${TIE}&cur=PLN&unit=per_animal&sort=price_asc`, 3);
    expect(new Set(seen).size).toBe(60);
  });

  test("Relevanz: nächste Seite ohne Doppelte (F1, Rang im Cursor gerundet)", async ({ page }) => {
    const seen = await walk(page, `/de/suche?q=${TIE}&sort=relevance`, 3);
    expect(new Set(seen).size).toBe(60);
  });

  test("Suchtext mit sechs Wörtern ergibt Treffer statt „Filter ungültig“ (F2)", async ({ page }) => {
    await page.goto(`/de/suche?q=${encodeURIComponent(`${TIE} Keiler Beschreibung lang genug Test`)}`);
    await expect(page.getByText("Die Filter sind ungültig.")).toHaveCount(0);
    expect((await cardIds(page)).length).toBeGreaterThan(0);
  });

  test("Suchtext mit fünf Wörtern liefert Treffer", async ({ page }) => {
    await page.goto(`/de/suche?q=${encodeURIComponent(`${TIE} Keiler Beschreibung lang genug`)}`);
    expect((await cardIds(page)).length).toBe(20);
  });

  test("230 Favoriten: Seite zeigt sie, „nicht mehr verfügbar entfernen“ löscht keine verfügbaren (F3)", async ({ page }) => {
    const { error } = await admin().from("favorites").insert(tieIds.map((id) => ({ user_id: fan.id, listing_id: id })));
    expect(error).toBeNull();
    await signInAs(page.context(), fan);
    await page.goto("/de/account/favorites");
    const remove = page.getByRole("button", { name: "Nicht mehr verfügbare entfernen" });
    if (await remove.count()) {
      await Promise.all([page.waitForURL(/notice=|error=/), remove.click()]);
    }
    const { count } = await admin().from("favorites").select("*", { count: "exact", head: true }).eq("user_id", fan.id);
    expect(count, "verfügbare Favoriten gelöscht").toBe(230);
    expect((await cardIds(page)).length).toBe(230);
  });
});

test.describe("QA M5: SEO und Statuscodes", () => {
  test.skip(!local, "Lokale Supabase nötig");

  let who: Owner;
  const ids: Record<string, string> = {};

  test.beforeAll(async () => {
    who = await owner(`QA5 SEO ${RUN}`, "business");
    [ids.pub, ids.draft, ids.paused] = await listings([
      await base(who, `QA5 ${RUN} SEO öffentlich`),
      await base(who, `QA5 ${RUN} SEO Entwurf`, { status: "draft", expires_at: null }),
      await base(who, `QA5 ${RUN} SEO pausiert`),
    ]);
    await admin().from("listings").update({ status: "paused" }).eq("id", ids.paused);
  });

  test("Statuscodes: Formen, Kodierung, Groß-/Kleinschreibung, Fremdsprachwort", async ({ request }) => {
    const cases: [string, number][] = [
      [`/de/anzeige/${ids.pub}`, 200],
      [`/de/anzeige/${ids.draft}`, 404],
      [`/de/anzeige/${ids.paused}`, 410],
      [`/en/listing/${ids.paused}`, 410],
      [`/de/anzeige/${ids.pub.toUpperCase()}`, 404],
      [`/de/anzeige/${ids.pub}/x`, 404],
      [`/en/anzeige/${ids.pub}`, 404],
      [`/de/listing/${ids.pub}`, 404],
      [`/de/Anzeige/${ids.pub}`, 404],
      ["/de/jagdpacht/Bayern", 404],
      ["/de/jagdpacht/bayern/dresden", 404],
      ["/de/jagdpacht/bayern/rosenheim/x", 404],
      ["/en/suche", 404],
      ["/de/anzeige", 404],
      ["/de/missing", 404],
      [`/de/anbieter/${who.id}`, 200],
      [`/de/anbieter/${who.id.toUpperCase()}`, 404],
    ];
    for (const [url, status] of cases) {
      const response = await request.get(url, { maxRedirects: 0 });
      expect(response.status(), url).toBe(status);
      if (status !== 200) expect(response.headers()["x-robots-tag"], url).toContain("noindex");
    }
    for (const [url, target] of [
      [`/de/%61nzeige/${ids.pub}`, `/de/anzeige/${ids.pub}`],
      [`/de/anzeige/${ids.pub}/`, `/de/anzeige/${ids.pub}`],
      ["/de/jagdpacht/bay%65rn", "/de/jagdpacht/bayern"],
      ["/de//jagdpacht", "/de/jagdpacht"],
    ]) {
      const response = await request.get(url, { maxRedirects: 0 });
      expect(response.status(), url).toBe(308);
      expect(new URL(response.headers().location, BASE).pathname, url).toBe(target);
    }
    // Prefetch- und RSC-Anfragen gehen ohne Statusprüfung durch, liefern aber nichts Unveröffentlichtes
    const rsc = await request.get(`/de/anzeige/${ids.draft}`, { headers: { RSC: "1" } });
    expect(await rsc.text()).not.toContain(`SEO Entwurf`);
  });

  test("Unbekannte Unterpfade statischer Seiten ergeben 404 (F8, nur im Produktions-Build 200)", async ({ request }) => {
    for (const url of ["/de/imprint/x", "/de/login/x", "/de/privacy/a/b"]) {
      expect((await request.get(url)).status(), url).toBe(404);
    }
  });

  test("hreflang und Canonical je Sprache am Detail, x-default de", async ({ page }) => {
    for (const locale of LOCALES) {
      await page.goto(`/${locale}/${DETAIL[locale]}/${ids.pub}`);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `${BASE.replace("3456", "3000")}/${locale}/${DETAIL[locale]}/${ids.pub}`);
      for (const other of LOCALES) {
        await expect(page.locator(`link[rel="alternate"][hreflang="${other}"]`)).toHaveAttribute("href", new RegExp(`/${other}/${DETAIL[other]}/${ids.pub}$`));
      }
      await expect(page.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveAttribute("href", new RegExp(`/de/anzeige/${ids.pub}$`));
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
    }
  });

  test("Leere Regionsseite: noindex ohne Canonical und hreflang (A7, F6)", async ({ page }) => {
    const { data } = await anonClient().rpc("listing_region_counts", { p_kind: "driven_hunt" });
    expect((data ?? []).some((r: { region_code: string }) => r.region_code === "AT-9")).toBe(false);
    await page.goto("/de/gesellschaftsjagd/wien");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    await expect(page.locator('link[rel="alternate"]')).toHaveCount(0);
  });

  test("Außerhalb von Prod: robots Disallow, X-Robots-Tag überall, Sitemaps ohne Unveröffentlichtes", async ({ request }) => {
    const robots = await (await request.get("/robots.txt")).text();
    expect(robots).toMatch(/Disallow: \/\s*$/m);
    expect(robots).not.toContain("Sitemap:");
    for (const url of ["/de", "/de/jagdpacht", `/de/anzeige/${ids.pub}`, `/de/anbieter/${who.id}`]) {
      expect((await request.get(url)).headers()["x-robots-tag"], url).toContain("noindex");
    }
    for (const locale of LOCALES) {
      // Die Sitemap ist bis zu 1 h gecacht (Profil hours, ADR 015): neue Anzeigen fehlen evtl. noch, deshalb nur Ausschlüsse.
      const xml = await (await request.get(`/sitemap/${locale}.xml`)).text();
      expect(xml.split("<url>").length - 1, locale).toBe(xml.split('hreflang="x-default"').length - 1);
      expect(xml, locale).not.toContain(ids.draft);
      expect(xml, locale).not.toContain(ids.paused);
      expect(xml, locale).not.toContain(`/${SEARCH[locale]}<`);
      expect(xml, locale).not.toMatch(/\/(account|admin|login)/);
    }
  });
});

test.describe("QA M5: Ohne JavaScript, Sprachen, 360 px, axe", () => {
  test.skip(!local, "Lokale Supabase nötig");

  let firm: Owner;
  let id = "";

  test.beforeAll(async () => {
    firm = await owner(`QA5 Layout ${RUN}`, "business", `QA5 Forst Oberbayern-Süd mit recht langem Namen ${RUN}`);
    [id] = await listings([await base(firm, `QA5 ${RUN} Hochwildrevier am Waldrand mit Hochsitzen und Jagdhütte`)]);
    await photo(id);
    await bumpCache(firm);
  });

  test("Ohne JavaScript: Sprachumschalter mit übersetzten Pfaden und Query, Paging- und Filterlinks", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(`/de/jagdpacht/bayern?cur=EUR`);
    const nav = page.getByRole("navigation", { name: "Sprache" });
    await expect(nav.getByRole("link", { name: "Polski" })).toHaveAttribute("href", "/pl/dzierzawa-obwodu/bayern?cur=EUR");
    await nav.getByRole("link", { name: "Čeština" }).click();
    await expect(page).toHaveURL(/\/cs\/pronajem-honitby\/bayern\?cur=EUR$/);
    await page.goto(`/de/anzeige/${id}`);
    await expect(page.getByRole("navigation", { name: "Sprache" }).getByRole("link", { name: "English" })).toHaveAttribute("href", `/en/listing/${id}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Hochwildrevier");
    await page.goto(`/de/anbieter/${firm.id}`);
    await expect(page.getByRole("navigation", { name: "Sprache" }).getByRole("link", { name: "English" })).toHaveAttribute("href", `/en/provider/${firm.id}`);
    await page.goto("/de/suche");
    await page.getByLabel("Bundesland bzw. Region").selectOption("DE-BY");
    await page.getByLabel("Suchbegriff").fill(RUN);
    await page.getByRole("button", { name: "Filter anwenden" }).click();
    await page.waitForURL(/region=DE-BY/);
    await expect(page.locator("article h3 a").first()).toBeVisible();
    expect(await cardIds(page)).toContain(id);
    await context.close();
  });

  for (const locale of LOCALES) {
    test(`${locale}: 360 px ohne Überbreite, keine rohen Schlüssel, lang gesetzt`, async ({ page, request }) => {
      await page.setViewportSize({ width: 360, height: 800 });
      const gone = (await admin().from("listings").select("id").eq("owner_id", firm.id).eq("status", "removed").limit(1).single()).data!.id;
      const urls = [`/${locale}`, `/${locale}/${LEASE[locale]}`, `/${locale}/${LEASE[locale]}/bayern/muenchen-stadt`, `/${locale}/${SEARCH[locale]}?q=${RUN}`,
        `/${locale}/${DETAIL[locale]}/${id}`, `/${locale}/${PROVIDER[locale]}/${firm.id}`, `/${locale}/${DETAIL[locale]}/${gone}`];
      for (const url of urls) {
        await page.goto(url);
        await noOverflow(page, url);
        await expect(page.locator("html"), url).toHaveAttribute("lang", locale);
        const text = await page.locator("body").innerText();
        expect(text, url).not.toMatch(/\b(Public|Favorites|Listings|Profile|Seo)\.[a-zA-Z]+/);
      }
      expect((await request.get(`/${locale}/${DETAIL[locale]}/${gone}`)).status()).toBe(410);
    });
  }

  test("360 px: Listenkarte mit langem deutschem Kompositum ohne Überbreite (F5)", async ({ page }) => {
    // „Rehwildbestandsregulierung“ (26 Zeichen): break-words senkt die min-content-Breite des Grid-Elements nicht
    const [longId] = await listings([await base(firm, `QA5 ${RUN} Rehwildbestandsregulierung`)]);
    await bumpCache(firm);
    await page.setViewportSize({ width: 360, height: 800 });
    for (const url of [`/de/suche?q=${RUN}+Rehwildbestandsregulierung`, "/de", `/de/anzeige/${longId}`]) {
      await page.goto(url);
      await noOverflow(page, url);
    }
  });

  test("axe: Kreis, Suche mit Treffern und Filtern, Detail en/pl, 410-Seite", async ({ page }) => {
    const gone = (await admin().from("listings").select("id").eq("owner_id", firm.id).eq("status", "removed").limit(1).single()).data!.id;
    for (const url of ["/de/jagdpacht/bayern/muenchen-stadt", `/de/suche?q=${RUN}&cur=EUR&country=DE`, `/en/listing/${id}`, `/pl/ogloszenie/${id}`, `/de/anzeige/${gone}`]) {
      await page.goto(url);
      const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
      const serious = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious.map((v) => `${v.id}: ${v.nodes.length}`), url).toEqual([]);
    }
  });

  test("Merken ohne Login → Anmeldung über den Bestätigungslink mit next → zurück zur Anzeige → Merken per POST", async ({ page }) => {
    // Die Mail selbst wird nicht angefordert (lokales Limit email_sent = 2/h); der Link entsteht wie in der Mail
    // mit redirect_to auf /auth/confirm?next=… (ADR 010), das Ziel kommt aus der Login-URL.
    const fan = await owner(`QA5 Rücksprung ${RUN}`);
    const client = anonClient();
    const first = await admin().auth.admin.generateLink({ type: "magiclink", email: fan.email });
    await client.auth.verifyOtp({ token_hash: first.data.properties!.hashed_token, type: "email" });
    await acceptLegal(client);
    await page.goto(`/de/anzeige/${id}`);
    await page.locator("main").getByRole("link", { name: /merken/ }).click();
    await expect(page).toHaveURL(new RegExp(`/de/login\\?next=%2Fde%2Fanzeige%2F${id}$`));
    const next = new URL(page.url()).searchParams.get("next")!;
    const link = await admin().auth.admin.generateLink({ type: "magiclink", email: fan.email });
    const redirectTo = `http://localhost:3000/de/auth/confirm?next=${encodeURIComponent(next)}`;
    await page.goto(`/de/auth/confirm?token_hash=${link.data.properties!.hashed_token}&type=email&redirect_to=${encodeURIComponent(redirectTo)}`);
    await page.getByRole("button", { name: "Anmeldung bestätigen" }).click();
    await expect(page).toHaveURL(new RegExp(`/de/anzeige/${id}$`));
    const { count: before } = await admin().from("favorites").select("*", { count: "exact", head: true }).eq("user_id", fan.id);
    expect(before, "kein Merken per GET nach dem Login").toBe(0);
    await page.locator("main").getByRole("button", { name: /merken/ }).click();
    await expect(page.locator("main").getByRole("button", { name: /merken/ })).toHaveAttribute("aria-pressed", "true");
  });
});
