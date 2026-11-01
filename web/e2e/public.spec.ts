import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { admin, deleteTestUsers, local } from "./cleanup";
import { uniqueEmail } from "./mailpit";

// M5 (ADR 015): öffentliche Seiten, Suche, Detail, Anbieter, Favoriten. Testdaten legt der Testcode mit
// service_role an (nur Node, nie im Browser) und räumt sie wieder ab.

const created: string[] = [];
test.afterAll(() => deleteTestUsers(created));
test.describe.configure({ mode: "serial" });

const RUN = Date.now().toString(36);
const EXPIRES = () => new Date(Date.now() + 7 * 86_400_000).toISOString();

function anonKey(): string {
  const out = execFileSync("supabase", ["status", "-o", "env"], {
    cwd: path.resolve(process.cwd(), ".."), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 30_000,
  });
  const match = /^(?:ANON_KEY|PUBLISHABLE_KEY)="?([^"\n]+)"?$/m.exec(out);
  if (!match) throw new Error("ANON_KEY");
  return match[1];
}

type Owner = { id: string; email: string };

async function owner(name: string, type: "private" | "business" = "private"): Promise<Owner> {
  const service = admin();
  const email = uniqueEmail("m5");
  created.push(email);
  const { data } = await service.auth.admin.createUser({ email, email_confirm: true });
  const id = data.user!.id;
  await service
    .from("profiles")
    .update({ display_name: name, account_type: type, business_name: type === "business" ? `${name} GmbH` : null })
    .eq("user_id", id);
  return { id, email };
}

async function regionId(code: string): Promise<string> {
  const { data } = await admin().from("regions").select("id").eq("code", code).single();
  return data!.id;
}

type ListingInput = {
  owner: Owner;
  title: string;
  kind?: string;
  region?: string;
  status?: string;
  price?: { minor: number; currency: string; unit: string } | null;
};

async function listing(input: ListingInput): Promise<string> {
  const status = input.status ?? "active";
  const { data, error } = await admin()
    .from("listings")
    .insert({
      owner_id: input.owner.id,
      kind: input.kind ?? "lease",
      direction: "offer",
      title: input.title,
      description: "Öffentliche Beschreibung mit mehr als dreißig Zeichen für den Test.",
      content_language: "de",
      region_id: await regionId(input.region ?? "DE-09162"),
      status,
      expires_at: status === "draft" || status === "pending_review" || status === "rejected" ? null : EXPIRES(),
      ...(input.price
        ? { price_minor: input.price.minor, currency: input.price.currency, price_unit: input.price.unit }
        : { price_unit: "on_request" }),
      ...(status === "rejected" ? { reject_code: "other", reject_reason: "Test" } : {}),
    })
    .select("id")
    .single();
  expect(error).toBeNull();
  return data!.id;
}

/** Verarbeitetes Foto an den vom Server vergebenen Pfaden (ADR 011). */
async function photo(listingId: string): Promise<string> {
  const service = admin();
  const { data, error } = await service
    .from("listing_photos")
    .insert({ listing_id: listingId, sort_order: 0, processed_at: new Date().toISOString(), width: 800, height: 600 })
    .select("id")
    .single();
  expect(error).toBeNull();
  const { data: paths } = await service.from("listing_photos").select("storage_path, thumb_path").eq("id", data!.id).single();
  const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" });
  for (const p of [paths!.storage_path, paths!.thumb_path]) {
    await service.storage.from("listing-photos").upload(p!, jpeg, { upsert: true });
  }
  return data!.id;
}

/** Session wie @supabase/ssr im Cookie, mit Zustimmung zu den Rechtstexten (Merken braucht ein Konto im Onboarding-Stand). */
async function signInAs(context: BrowserContext, who: Owner) {
  const service = admin();
  const client = createClient(local!.url, anonKey(), { auth: { persistSession: false, autoRefreshToken: false } });
  const link = await service.auth.admin.generateLink({ type: "magiclink", email: who.email });
  const verified = await client.auth.verifyOtp({ token_hash: link.data.properties!.hashed_token, type: "email" });
  if (verified.error) throw verified.error;
  const { data: legal } = await client.rpc("legal_status").single<{ terms_version: string; privacy_version: string }>();
  await client.rpc("accept_legal", { p_terms_version: legal!.terms_version, p_privacy_version: legal!.privacy_version, p_source: "web" });
  const { data } = await client.auth.getSession();
  const name = `sb-${new URL(local!.url).hostname.split(".")[0]}-auth-token`;
  const value = `base64-${Buffer.from(JSON.stringify(data.session)).toString("base64url")}`;
  const chunks = value.length <= 3180 ? [value] : (value.match(/.{1,3180}/g) ?? []);
  await context.addCookies(
    chunks.map((chunk, i) => ({ name: chunks.length === 1 ? name : `${name}.${i}`, value: chunk, url: "http://localhost:3000", sameSite: "Lax" as const })),
  );
}

async function titles(page: Page): Promise<string[]> {
  return page.locator("article h3 a").allTextContents();
}

const norm = (text: string) => text.replace(/[  ]/g, " ");

test.describe("Öffentliche Seiten (M5)", () => {
  test.skip(!local, "Lokale Supabase nötig");

  let private_: Owner;
  let business: Owner;
  const ids: Record<string, string> = {};
  const T = (name: string) => `M5 ${RUN} ${name}`;

  test.beforeAll(async () => {
    private_ = await owner("M5 Privat");
    business = await owner("M5 Forst", "business");
    ids.muc = await listing({ owner: private_, title: T("Pacht München"), price: { minor: 500_000, currency: "EUR", unit: "per_year" } });
    ids.kb = await listing({ owner: business, title: T("Pacht Kitzbühel"), region: "AT-704", price: { minor: 12_345_000, currency: "CZK", unit: "total" } });
    ids.dd = await listing({ owner: business, title: T("Begehung Dresden"), kind: "permit", region: "DE-14612", price: { minor: 20_000, currency: "EUR", unit: "per_year" } });
    ids.draft = await listing({ owner: private_, title: T("Entwurf"), status: "draft" });
    ids.review = await listing({ owner: private_, title: T("Prüfung"), status: "pending_review" });
    ids.rejected = await listing({ owner: private_, title: T("Abgelehnt"), status: "rejected" });
    ids.photo = await photo(ids.muc);
  });

  test("Akzeptanz a: Filtern nach Land, Region, Art und Preis liefert die richtigen Anzeigen", async ({ page }) => {
    const q = encodeURIComponent(`M5 ${RUN}`);
    const cases: [string, string[]][] = [
      [`/de/suche?q=${q}&country=DE`, [T("Begehung Dresden"), T("Pacht München")]],
      [`/de/suche?q=${q}&country=AT`, [T("Pacht Kitzbühel")]],
      [`/de/suche?q=${q}&region=DE-BY`, [T("Pacht München")]],
      [`/de/jagdpacht?q=${q}`, [T("Pacht Kitzbühel"), T("Pacht München")]],
      [`/de/jagdpacht/tirol?q=${q}`, [T("Pacht Kitzbühel")]],
      [`/de/suche?q=${q}&cur=EUR&pmax=1000`, [T("Begehung Dresden")]],
      [`/de/suche?q=${q}&cur=EUR&pmin=1000`, [T("Pacht München")]],
      [`/de/suche?q=${q}&cur=CZK`, [T("Pacht Kitzbühel")]],
      [`/de/suche?q=${q}&cur=PLN`, []],
    ];
    for (const [url, expected] of cases) {
      await page.goto(url);
      expect((await titles(page)).sort(), url).toEqual([...expected].sort());
    }
  });

  test("Akzeptanz b: Preise in Originalwährung mit der Locale der Seite", async ({ page }) => {
    const pages: [string, string, number, string, string][] = [
      ["de", "anzeige", 5_000, "EUR", "pro Jahr"],
      ["en", "listing", 5_000, "EUR", "per year"],
      ["cs", "inzerat", 5_000, "EUR", "za rok"],
      ["pl", "ogloszenie", 5_000, "EUR", ""],
      ["de", "anzeige", 123_450, "CZK", "gesamt"],
      ["pl", "ogloszenie", 123_450, "CZK", ""],
    ];
    for (const [locale, word, amount, currency, unit] of pages) {
      const id = currency === "EUR" ? ids.muc : ids.kb;
      await page.goto(`/${locale}/${word}/${id}`);
      const expected = norm(new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: 0 }).format(amount));
      const text = norm(await page.locator("main").innerText());
      expect(text, `${locale} ${currency}`).toContain(expected);
      if (unit) expect(text).toContain(`${expected} ${unit}`);
    }
  });

  test("Akzeptanz c: Nicht freigegebene Anzeigen sind nicht abrufbar und nicht indexierbar", async ({ page, request }) => {
    for (const id of [ids.draft, ids.review, ids.rejected]) {
      const response = await request.get(`/de/anzeige/${id}`);
      expect(response.status(), id).toBe(404);
      expect(response.headers()["x-robots-tag"]).toContain("noindex");
    }
    const sitemap = await (await request.get("/sitemap/de.xml")).text();
    expect(sitemap).toContain(ids.muc);
    for (const id of [ids.draft, ids.review, ids.rejected]) expect(sitemap).not.toContain(id);
    await page.goto(`/de/suche?q=${encodeURIComponent(`M5 ${RUN}`)}`);
    const shown = await titles(page);
    for (const name of ["Entwurf", "Prüfung", "Abgelehnt"]) expect(shown).not.toContain(T(name));
    // Auch der eingeloggte Besitzer sieht seinen Entwurf nicht auf der öffentlichen URL.
    await signInAs(page.context(), private_);
    expect((await page.goto(`/de/anzeige/${ids.draft}`))!.status()).toBe(404);
  });

  test("Statuscodes: unbekannte Pfade 404, kodierte 308, Detail und Anbieter 200", async ({ request }) => {
    for (const p of ["/en/jagdpacht", "/de/jagdpacht/atlantis", "/de/suche/x", "/de/anzeige/kein-uuid", `/de/anzeige/${ids.muc.toUpperCase()}`, "/de/gone"]) {
      expect((await request.get(p)).status(), p).toBe(404);
    }
    const encoded = await request.get(`/de/%61nzeige/${ids.muc}`, { maxRedirects: 0 });
    expect(encoded.status()).toBe(308);
    expect(encoded.headers().location).toContain(`/de/anzeige/${ids.muc}`);
    expect((await request.get(`/cs/inzerat/${ids.muc}`)).status()).toBe(200);
    expect((await request.get(`/pl/oglaszajacy/${business.id}`)).status()).toBe(200);
    const doc = await request.get(`/de/anzeige/${ids.muc}`);
    expect(doc.headers()["cache-control"]).toMatch(/no-store|private/);
  });

  test("hreflang und Canonical mit übersetzten Pfaden, Sprachumschalter auf der Kategorieseite", async ({ page }) => {
    await page.goto("/de/jagdpacht/bayern");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/de\/jagdpacht\/bayern$/);
    await expect(page.locator('link[hreflang="cs"]')).toHaveAttribute("href", /\/cs\/pronajem-honitby\/bayern$/);
    await expect(page.locator('link[hreflang="x-default"]')).toHaveAttribute("href", /\/de\/jagdpacht\/bayern$/);
    await page.getByRole("navigation", { name: /Sprache/ }).getByRole("link", { name: "English" }).click();
    await expect(page).toHaveURL(/\/en\/hunting-lease\/bayern$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Hunting lease");
    // Mit Query: noindex, follow und keine Alternativen
    await page.goto("/de/jagdpacht?cur=EUR");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex, follow/);
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
  });

  test("Detail: kein Kontakt ohne Login, keine PLZ, Fotos über die eigene Route, JSON-LD maskiert", async ({ page, request }) => {
    await page.goto(`/de/anzeige/${ids.muc}`);
    const main = page.locator("main");
    await expect(main.getByRole("link", { name: /Anbieter kontaktieren/ })).toHaveAttribute("href", new RegExp(`/de/login\\?next=%2Fde%2Fanzeige%2F${ids.muc}`));
    await expect(main.getByRole("link", { name: "M5 Privat" })).toHaveAttribute("href", `/de/anbieter/${private_.id}`);
    const img = main.locator("img").first();
    await expect(img).toHaveAttribute("src", `/api/photos/${ids.photo}/thumb`);
    const html = await page.content();
    expect(html).not.toContain("listing-photos");
    expect(html).not.toMatch(/\b\d{5}\b Testort/);
    expect((await request.get(`/api/photos/${ids.photo}/thumb`)).status()).toBe(200);
    for (const ld of await page.locator('script[type="application/ld+json"]').allTextContents()) {
      expect(() => JSON.parse(ld)).not.toThrow();
    }
  });

  test("Anbieterprofil: Gewerbe indexierbar mit Firmenname, Privatperson noindex", async ({ page }) => {
    await page.goto(`/de/anbieter/${business.id}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("M5 Forst GmbH");
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
    expect(await titles(page)).toEqual(expect.arrayContaining([T("Pacht Kitzbühel"), T("Begehung Dresden")]));
    await page.goto(`/de/anbieter/${private_.id}`);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.getByText("dabei seit", { exact: false })).toHaveCount(0);
  });

  test("Suche ohne JavaScript: Formular und Ergebnisse stehen im HTML", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/de");
    await page.getByRole("searchbox", { name: "Suche" }).fill(`M5 ${RUN} Kitzbühel`);
    await page.getByRole("button", { name: "Suchen" }).click();
    await expect(page).toHaveURL(/\/de\/suche\?q=/);
    expect(await titles(page)).toEqual([T("Pacht Kitzbühel")]);
    await page.getByLabel("Währung").selectOption("EUR");
    await page.getByRole("button", { name: "Filter anwenden" }).click();
    expect(await titles(page)).toEqual([]);
    await context.close();
  });

  test("Merken: ohne Login zum Login mit Rücksprung, danach per Klick merken, Favoritenseite", async ({ page }) => {
    const fan = await owner("M5 Fan");
    await page.goto(`/de/anzeige/${ids.kb}`);
    await page.locator("main").getByRole("link", { name: /merken/ }).click();
    await expect(page).toHaveURL(new RegExp(`/de/login\\?next=%2Fde%2Fanzeige%2F${ids.kb}`));
    await signInAs(page.context(), fan);
    await page.goto(`/de/anzeige/${ids.kb}`);
    const button = page.locator("main").getByRole("button", { name: /merken/ });
    await expect(button).toHaveAttribute("aria-pressed", "false");
    await button.click();
    await expect(page).toHaveURL(new RegExp(`/de/anzeige/${ids.kb}$`));
    await expect(page.locator("main").getByRole("button", { name: /merken/ })).toHaveAttribute("aria-pressed", "true");
    await page.goto("/de/account/favorites");
    expect(await titles(page)).toEqual([T("Pacht Kitzbühel")]);

    // Nicht mehr verfügbar: bleibt gezählt, lässt sich gesammelt entfernen
    await admin().from("listings").update({ status: "paused" }).eq("id", ids.kb);
    await page.reload();
    await expect(page.getByText("1 gemerkte Anzeige ist nicht mehr verfügbar.")).toBeVisible();
    await page.getByRole("button", { name: "Nicht mehr verfügbare entfernen" }).click();
    await expect(page.getByText("Nicht mehr verfügbare Favoriten wurden entfernt.")).toBeVisible();
    await admin().from("listings").update({ status: "active" }).eq("id", ids.kb);
  });

  test("Pausiert ergibt 410, Fortsetzen wieder 200", async ({ request }) => {
    await admin().from("listings").update({ status: "paused" }).eq("id", ids.dd);
    const gone = await request.get(`/de/anzeige/${ids.dd}`);
    expect(gone.status()).toBe(410);
    expect(gone.headers()["x-robots-tag"]).toContain("noindex");
    expect(await gone.text()).toContain("nicht mehr verfügbar");
    await admin().from("listings").update({ status: "active" }).eq("id", ids.dd);
    expect((await request.get(`/de/anzeige/${ids.dd}`)).status()).toBe(200);
  });

  test("Barrierefreiheit (axe): Start, Kategorie, Suche, Detail, Anbieter, Favoriten ohne schwere Verstöße", async ({ page }) => {
    const fan = await owner("M5 Axe");
    await signInAs(page.context(), fan);
    for (const url of ["/de", "/de/jagdpacht", "/cs/hledani?kind=lease", `/de/anzeige/${ids.muc}`, `/pl/oglaszajacy/${business.id}`, "/de/account/favorites"]) {
      await page.goto(url);
      const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
      const serious = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious.map((v) => `${v.id}: ${v.nodes.length}`), url).toEqual([]);
    }
  });
});

test.describe("Sofortige Wirkung (Nutzer-Entscheidung 2026-10-31)", () => {
  test.skip(!local, "Lokale Supabase nötig");

  for (const action of ["entfernen", "sperren", "löschen"] as const) {
    test(`Nach ${action} sofort weg aus Kategorie, Startseite, Detail und Foto`, async ({ page, request }) => {
      const who = await owner(`M5 Sofort ${action}`);
      const title = `M5 ${RUN} Sofort ${action}`;
      const id = await listing({ owner: who, title, kind: "helper", region: "DE-14612" });
      const photoId = await photo(id);
      // Neue Anzeigen erscheinen in gecachten Listen erst nach bis zu 5 Minuten (normale Änderung). Eine Entfernung
      // erhöht den Cache-Zähler und erzwingt frische Listen; dann den Cache mit der neuen Anzeige füllen.
      const bump = await listing({ owner: who, title: `${title} Zähler`, kind: "helper", region: "DE-14612" });
      await admin().from("listings").update({ status: "removed" }).eq("id", bump);
      await page.goto("/de/jagdhelfer");
      await expect(page.getByRole("link", { name: title, exact: true })).toBeVisible();
      await page.goto("/de");
      await expect(page.getByRole("link", { name: title, exact: true })).toBeVisible();
      expect((await request.get(`/api/photos/${photoId}/thumb`)).status()).toBe(200);

      const service = admin();
      if (action === "entfernen") await service.from("listings").update({ status: "removed" }).eq("id", id);
      if (action === "sperren") await service.from("profiles").update({ is_blocked: true }).eq("user_id", who.id);
      if (action === "löschen") {
        const { data: files } = await service.storage.from("listing-photos").list(`${who.id}/${id}`);
        await service.storage.from("listing-photos").remove((files ?? []).map((f) => `${who.id}/${id}/${f.name}`));
        await service.auth.admin.deleteUser(who.id);
      }

      await page.goto("/de/jagdhelfer");
      await expect(page.getByRole("link", { name: title, exact: true })).toHaveCount(0);
      await page.goto("/de");
      await expect(page.getByRole("link", { name: title, exact: true })).toHaveCount(0);
      expect((await request.get(`/de/anzeige/${id}`)).status()).toBe(action === "löschen" ? 404 : 410);
      expect((await request.get(`/api/photos/${photoId}/thumb`)).status()).toBe(404);
    });
  }
});
