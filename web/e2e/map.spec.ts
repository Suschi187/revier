import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { admin, deleteTestUsers, local } from "./cleanup";
import { uniqueEmail } from "./mailpit";

// M6 Karte (ADR 016): Akzeptanz a (nur verfremdete Positionen) und b (Klick öffnet das Detail), Cluster, gestapelte
// Anzeigen, Bereichssuche, keine fremden Hosts, keine CSP-Verletzungen. Testdaten per service_role (nur Node).

const created: string[] = [];
test.afterAll(() => deleteTestUsers(created));
test.describe.configure({ mode: "serial" });

const RUN = Date.now().toString(36);
const T = (name: string) => `M6 ${RUN} ${name}`;
// Eingabepunkt im Kreis Sächsische Schweiz-Osterzgebirge (1654 km², Punkte erlaubt)
const RAW = { lat: 50.95, lng: 13.95 };

function anonKey(): string {
  const out = execFileSync("supabase", ["status", "-o", "env"], {
    cwd: path.resolve(process.cwd(), ".."), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 30_000,
  });
  const match = /^(?:ANON_KEY|PUBLISHABLE_KEY)="?([^"\n]+)"?$/m.exec(out);
  if (!match) throw new Error("ANON_KEY");
  return match[1];
}

test.describe("Karte (M6)", () => {
  test.skip(!local, "Lokale Supabase nötig");
  const ids: Record<string, string> = {};

  test.beforeAll(async () => {
    const service = admin();
    const email = uniqueEmail("m6");
    created.push(email);
    const { data: user } = await service.auth.admin.createUser({ email, email_confirm: true });
    const owner = user.user!.id;
    // Den Punkt setzt nur der Besitzer (ADR 006): als Besitzer per RPC an einem Entwurf, dann freigeben (Server).
    const client = createClient(local!.url, anonKey(), { auth: { persistSession: false, autoRefreshToken: false } });
    const link = await service.auth.admin.generateLink({ type: "magiclink", email });
    await client.auth.verifyOtp({ token_hash: link.data.properties!.hashed_token, type: "email" });
    const { data: legal } = await client.rpc("legal_status").single<{ terms_version: string; privacy_version: string }>();
    await client.rpc("accept_legal", { p_terms_version: legal!.terms_version, p_privacy_version: legal!.privacy_version, p_source: "web" });
    const region = async (code: string) => (await service.from("regions").select("id").eq("code", code).single()).data!.id as string;
    const big = await region("DE-14628");
    const draft = await client
      .from("listings")
      .insert({ kind: "helper", direction: "offer", title: T("Mit Punkt"), content_language: "de", region_id: big })
      .select("id")
      .single();
    ids.point = draft.data!.id;
    const set = await client.rpc("set_listing_location", { p_listing_id: ids.point, p_region_id: big, p_point: "set", p_lat: RAW.lat, p_lng: RAW.lng });
    expect(set.error).toBeNull();
    const expires = new Date(Date.now() + 7 * 86_400_000).toISOString();
    await service.from("listings").update({ status: "active", expires_at: expires }).eq("id", ids.point);
    // Zwei Anzeigen ohne Punkt im selben Kreis: gleiche Koordinate (Kreismittelpunkt), eine Kurzkarte für beide
    const rows = await service
      .from("listings")
      .insert([
        { owner_id: owner, kind: "helper", direction: "offer", title: T("Mitte A"), content_language: "de", region_id: big, status: "active", expires_at: expires },
        { owner_id: owner, kind: "helper", direction: "offer", title: T("Mitte B"), content_language: "de", region_id: big, status: "active", expires_at: expires },
      ])
      .select("id");
    ids.a = rows.data![0].id;
    ids.b = rows.data![1].id;
  });

  test("Akzeptanz a: Kartendaten zeigen nur den verfremdeten Punkt bzw. den Kreismittelpunkt, nie die Eingabe", async ({ page }) => {
    const service = admin();
    const { data: stored } = await service.rpc("map_listings", { p_filters: { v: 1, q: `M6 ${RUN}`, bbox: [13.0, 50.5, 14.8, 51.4] } });
    const byId = new Map((stored as { points: { id: string; lng: number; lat: number; approx: string }[] }).points.map((p) => [p.id, p]));
    const responses: string[] = [];
    page.on("response", async (response) => {
      if (response.url().includes("/api/map")) responses.push(await response.text());
    });
    await page.goto(`/de/jagdhelfer/sachsen/saechsische-schweiz-osterzgebirge?view=map&q=${encodeURIComponent(`M6 ${RUN}`)}`);
    await expect(page.getByText(/Anzeigen auf der Karte/)).toBeVisible({ timeout: 20_000 });
    const body = responses.join("\n");
    const data = JSON.parse(responses.at(-1)!) as { features: { geometry: { coordinates: [number, number] }; properties: { id: string } }[] };
    for (const feature of data.features) {
      const db = byId.get(feature.properties.id)!;
      expect(feature.geometry.coordinates).toEqual([db.lng, db.lat]);
    }
    const point = byId.get(ids.point)!;
    expect(point.approx).toBe("point");
    const dist = Math.hypot((point.lng - RAW.lng) * 111.32 * Math.cos((RAW.lat * Math.PI) / 180), (point.lat - RAW.lat) * 111.32);
    expect(dist).toBeGreaterThan(2.2);
    expect(dist).toBeLessThan(5.8);
    // Der Eingabepunkt erscheint in keiner Antwort (3–6 Nachkommastellen).
    const html = await page.content();
    for (const text of [body, html]) {
      expect(text).not.toMatch(/50\.95(0{0,4})?\b[^0-9]/);
      expect(text).not.toMatch(/13\.95(0{0,4})?\b[^0-9]/);
    }
    expect(body).not.toMatch(/owner_id|postal/);
  });

  test("Akzeptanz b: Klick auf einen Punkt öffnet die Kurzkarte, der Link das Detail; gestapelte Anzeigen alle", async ({ page }) => {
    await page.goto(`/de/jagdhelfer/sachsen/saechsische-schweiz-osterzgebirge?view=map&q=${encodeURIComponent(`M6 ${RUN}`)}`);
    // Beim Start liegen alle drei in einem Cluster; Klick zoomt hinein, bis Punkt und Stapel getrennt sind.
    const single = page.getByRole("button", { name: new RegExp(`^${T("Mit Punkt")}`) });
    for (let i = 0; i < 6 && !(await single.isVisible()); i++) {
      const cluster = page.getByRole("button", { name: /Anzeigen, hineinzoomen$/ }).first();
      if (await cluster.isVisible()) await cluster.click();
      await page.waitForTimeout(800);
    }
    await expect(single).toBeVisible({ timeout: 20_000 });
    const stack = page.getByRole("button", { name: "2 Anzeigen an dieser Stelle" });
    await stack.click();
    const dialog = page.getByRole("dialog", { name: "2 Anzeigen an dieser Stelle" });
    await expect(dialog.getByRole("link", { name: T("Mitte A") })).toBeVisible();
    await expect(dialog.getByRole("link", { name: T("Mitte B") })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(stack).toBeFocused();
    await single.click();
    await page.getByRole("dialog").getByRole("link", { name: T("Mit Punkt") }).click();
    await expect(page).toHaveURL(new RegExp(`/de/anzeige/${ids.point}$`));
  });

  test("In diesem Bereich suchen setzt bbox und filtert die Liste", async ({ page }) => {
    await page.goto(`/de/suche?view=map&q=${encodeURIComponent(`M6 ${RUN}`)}`);
    await expect(page.getByText(/Anzeigen auf der Karte/)).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "In diesem Bereich suchen" }).click();
    await expect(page).toHaveURL(/bbox=/);
    await expect(page).toHaveURL(/view=map/);
    await expect(page.getByText("Gefiltert nach Kartenbereich.")).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await page.getByRole("link", { name: "Bereich entfernen" }).click();
    await expect(page).not.toHaveURL(/bbox=/);
  });

  test("Nur eigene Origin, keine CSP-Verletzungen, keine Konsolenfehler", async ({ page }) => {
    const foreign: string[] = [];
    const errors: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (!["localhost", "127.0.0.1"].includes(url.hostname) && url.protocol.startsWith("http")) foreign.push(request.url());
    });
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.addInitScript(() => {
      document.addEventListener("securitypolicyviolation", (e) => console.error(`CSP ${e.violatedDirective} ${e.blockedURI}`));
    });
    await page.goto(`/de/jagdhelfer?view=map&q=${encodeURIComponent(`M6 ${RUN}`)}`);
    await expect(page.getByText(/Anzeigen auf der Karte/)).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1500);
    expect(foreign).toEqual([]);
    expect(errors.filter((e) => /CSP|Refused/.test(e))).toEqual([]);
  });

  test("Ohne JavaScript: Liste vollständig, Hinweis zur Karte", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(`/de/jagdhelfer?view=map&q=${encodeURIComponent(`M6 ${RUN}`)}`);
    expect(await page.content()).toContain("Die Karte braucht JavaScript");
    await expect(page.locator("article h3 a")).toHaveCount(3);
    await context.close();
  });
});
