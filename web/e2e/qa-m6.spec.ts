import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { admin, deleteTestUsers, local } from "./cleanup";
import { uniqueEmail } from "./mailpit";
import { parsePoint } from "../lib/map/geo";
import { publicPath } from "../lib/public/paths";

// QA M6 (Abnahme): Standortschutz im Web (Eingabepunkt in keiner Antwort, URL, Spalte, Log), unverändertes Speichern
// an einer aktiven Anzeige, Nachladen der Karte, Bereich über 30°, sofortige Wirkung auf Karte, Liste und Detail,
// /api/map-Vertrag, Kachel-Route, Glyphen und fremde Hosts in vier Sprachen, 360 px, Tastatur, ohne JavaScript.
// Konten per service_role in Node, Löschung in afterAll. Gegen den Produktions-Build mit QA_BASE_URL; QA_TILES sagt,
// wie der Server gestartet ist ("dev" | "none" | "file-only" | "dir"), QA_DEV_LOG zeigt auf das Server-Log.
// Bekannte Fehler als test.fail (F-Nummern aus docs/QA-REPORT.md, Abschnitt „M6 – Abnahme“).

const BASE = process.env.QA_BASE_URL ?? "http://localhost:3000";
if (process.env.QA_BASE_URL) test.use({ baseURL: process.env.QA_BASE_URL });
const TILES = process.env.QA_TILES ?? (process.env.QA_BASE_URL ? "none" : "dev");
const LOCALES = ["de", "en", "cs", "pl"] as const;

const created: string[] = [];
test.afterAll(() => deleteTestUsers(created));
test.describe.configure({ mode: "serial" });

const RUN = `QA6${Date.now().toString(36)}`;
const T = (name: string) => `${RUN} ${name}`;
const SAXONY: [number, number, number, number] = [13.0, 50.5, 14.8, 51.4];

function anonKey(): string {
  const out = execFileSync("supabase", ["status", "-o", "env"], {
    cwd: path.resolve(process.cwd(), ".."), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 30_000,
  });
  const match = /^(?:ANON_KEY|PUBLISHABLE_KEY)="?([^"\n]+)"?$/m.exec(out);
  if (!match) throw new Error("ANON_KEY");
  return match[1];
}

type Signed = { client: SupabaseClient; cookies: { name: string; value: string }[] };

async function signIn(email: string): Promise<Signed> {
  const service = admin();
  const client = createClient(local!.url, anonKey(), { auth: { persistSession: false, autoRefreshToken: false } });
  const link = await service.auth.admin.generateLink({ type: "magiclink", email });
  await client.auth.verifyOtp({ token_hash: link.data.properties!.hashed_token, type: "email" });
  const { data: legal } = await client.rpc("legal_status").single<{ terms_version: string; privacy_version: string }>();
  await client.rpc("accept_legal", { p_terms_version: legal!.terms_version, p_privacy_version: legal!.privacy_version, p_source: "web" });
  const { data } = await client.auth.getSession();
  const name = `sb-${new URL(local!.url).hostname.split(".")[0]}-auth-token`;
  const value = `base64-${Buffer.from(JSON.stringify(data.session)).toString("base64url")}`;
  const chunks = value.length <= 3180 ? [value] : (value.match(/.{1,3180}/g) ?? []);
  return { client, cookies: chunks.map((chunk, i) => ({ name: chunks.length === 1 ? name : `${name}.${i}`, value: chunk })) };
}

async function useSession(context: BrowserContext, signed: Signed) {
  await context.addCookies(signed.cookies.map((c) => ({ ...c, url: BASE, sameSite: "Lax" as const })));
}

const distanceKm = (a: { lng: number; lat: number }, b: { lng: number; lat: number }) =>
  Math.hypot((a.lng - b.lng) * 111.32 * Math.cos((a.lat * Math.PI) / 180), (a.lat - b.lat) * 111.32);

/** Zeichenketten, an denen der Eingabepunkt erkennbar wäre: 5 und 6 Nachkommastellen, abgeschnitten und gerundet. */
function rawForms(value: number): string[] {
  const forms = new Set<string>();
  for (const digits of [5, 6]) {
    forms.add(value.toFixed(digits));
    const factor = 10 ** digits;
    forms.add((Math.trunc(value * factor) / factor).toFixed(digits));
  }
  return [...forms];
}

/** Herauszoomen über den Button der Karte, jeweils bis die Bewegung endet. */
async function zoomOut(page: Page, steps: number) {
  for (let i = 0; i < steps; i++) {
    await page.locator(".maplibregl-ctrl-zoom-out").click();
    await page.waitForTimeout(700);
  }
  await page.waitForTimeout(800);
}

async function listedTitles(page: Page): Promise<string[]> {
  return page.locator("article h3 a").allTextContents();
}

test.describe("QA M6", () => {
  test.skip(!local, "Lokale Supabase nötig");
  const ids: Record<string, string> = {};
  let owner: Signed;
  let blockedId = "";
  let bigCentre = { lng: 0, lat: 0 };

  test.beforeAll(async () => {
    const service = admin();
    const ownerEmail = uniqueEmail("qa6");
    const blockedEmail = uniqueEmail("qa6-blk");
    created.push(ownerEmail, blockedEmail);
    const { data: o } = await service.auth.admin.createUser({ email: ownerEmail, email_confirm: true });
    const { data: b } = await service.auth.admin.createUser({ email: blockedEmail, email_confirm: true });
    blockedId = b.user!.id;
    owner = await signIn(ownerEmail);
    const region = async (code: string) => (await service.from("regions").select("id").eq("code", code).single()).data!.id as string;
    const big = await region("DE-14628");
    const muc = await region("DE-09184");
    const { data: geo } = await service.rpc("region_geo");
    const centre = (geo as { code: string; lng: number; lat: number }[]).find((r) => r.code === "DE-14628")!;
    bigCentre = { lng: centre.lng, lat: centre.lat };
    const expires = new Date(Date.now() + 7 * 86_400_000).toISOString();

    // Anzeigen mit Punkt setzt nur der Besitzer (RPC), dann freigeben (Server-Pfad).
    const withPoint = async (key: string, regionId: string, lat: number, lng: number) => {
      const draft = await owner.client
        .from("listings")
        .insert({ kind: "helper", direction: "wanted", title: T(key), content_language: "de", region_id: regionId })
        .select("id")
        .single();
      ids[key] = draft.data!.id;
      const set = await owner.client.rpc("set_listing_location", { p_listing_id: ids[key], p_region_id: regionId, p_point: "set", p_lat: lat, p_lng: lng });
      expect(set.error).toBeNull();
      await service.from("listings").update({ status: "active", expires_at: expires }).eq("id", ids[key]);
    };
    await withPoint("Sachsen Punkt", big, 50.95, 13.95);
    await withPoint("Muenchen Punkt", muc, 48.05, 11.7);
    await withPoint("Punkt weg", big, 50.9, 13.9);
    const rows = await service
      .from("listings")
      .insert([
        { owner_id: o.user!.id, kind: "helper", direction: "wanted", title: T("Mitte"), content_language: "de", region_id: big, status: "active", expires_at: expires },
        { owner_id: o.user!.id, kind: "helper", direction: "wanted", title: T("Entfernt"), content_language: "de", region_id: big, status: "active", expires_at: expires },
        { owner_id: blockedId, kind: "helper", direction: "wanted", title: T("Gesperrt"), content_language: "de", region_id: big, status: "active", expires_at: expires },
      ])
      .select("id, title");
    expect(rows.error).toBeNull();
    const pick = await service
      .from("listings")
      .insert({ owner_id: o.user!.id, kind: "helper", direction: "wanted", title: T("Punktwahl"), content_language: "de", region_id: big })
      .select("id, title")
      .single();
    expect(pick.error).toBeNull();
    rows.data!.push(pick.data!);
    for (const row of rows.data!) ids[row.title.slice(RUN.length + 1)] = row.id;
  });

  // ---------------------------------------------------------------------------------------------------------------
  // Standortschutz
  // ---------------------------------------------------------------------------------------------------------------
  test("Punktwahl: Eingabepunkt in keiner Antwort, keiner URL, keiner Spalte und keinem Server-Log", async ({ page }) => {
    await useSession(page.context(), owner);
    const bodies: string[] = [];
    const urls: string[] = [];
    page.on("request", (request) => urls.push(request.url()));
    page.on("response", async (response) => {
      const type = response.request().resourceType();
      if (["document", "fetch", "xhr"].includes(type)) bodies.push(await response.text().catch(() => ""));
      const location = response.headers()["location"];
      if (location) urls.push(location);
    });
    await page.goto(`/de/account/listings/${ids.Punktwahl}/edit?step=location`);
    const setCentre = page.getByRole("button", { name: "Punkt in der Kartenmitte setzen" });
    await expect(setCentre).toBeEnabled({ timeout: 20_000 });
    // Karte per Tastatur verschieben, damit der Punkt nicht der Kreismittelpunkt ist
    await page.locator(".maplibregl-canvas").focus();
    for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(800);
    await setCentre.click();
    const chosen = {
      lat: Number(await page.locator('input[name="lat"]').inputValue()),
      lng: Number(await page.locator('input[name="lng"]').inputValue()),
    };
    await page.getByRole("button", { name: "Speichern und weiter" }).click();
    await expect(page).toHaveURL(/saved=1/);
    await page.goto(`/de/account/listings/${ids.Punktwahl}/edit?step=location`);
    await expect(page.getByRole("img", { name: "So erscheint die Lage öffentlich (verfremdet)" })).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(500);

    const forms = [...rawForms(chosen.lat), ...rawForms(chosen.lng)];
    for (const form of forms) {
      expect(bodies.filter((b) => b.includes(form)).length, `Antwort enthält ${form}`).toBe(0);
      expect(urls.filter((u) => u.includes(form)), `URL enthält ${form}`).toEqual([]);
    }
    // DB: keine Spalte der Anzeige, des Orts oder des Audits enthält den Eingabepunkt
    const service = admin();
    const row = await service.from("listings").select("*").eq("id", ids.Punktwahl).single();
    const places = await service.from("listing_places").select("*").eq("listing_id", ids.Punktwahl);
    const audit = await service.from("audit_log").select("*").eq("target_id", ids.Punktwahl);
    const stored = JSON.stringify([row.data, places.data, audit.data]);
    const mapPoint = parsePoint(row.data!.map_point)!;
    const dist = distanceKm(mapPoint, chosen);
    expect(dist).toBeGreaterThan(2.2);
    expect(dist).toBeLessThan(5.8);
    for (const form of forms) expect(stored).not.toContain(form);
    // Server-Log (nur wenn der Lauf es mitschreibt)
    const log = process.env.QA_DEV_LOG;
    if (log && existsSync(log)) {
      const text = readFileSync(log, "utf8");
      for (const form of forms) expect(text, `Log enthält ${form}`).not.toContain(form);
    }
  });

  test("Unverändert speichern an einer aktiven Anzeige: bleibt aktiv, Punkt unverändert (B3)", async ({ page }) => {
    await useSession(page.context(), owner);
    const service = admin();
    const before = await service.from("listings").select("status, map_point, display_location").eq("id", ids["Sachsen Punkt"]).single();
    expect(before.data!.status).toBe("active");
    await page.goto(`/de/account/listings/${ids["Sachsen Punkt"]}/edit?step=location`);
    await expect(page.getByRole("img", { name: "So erscheint die Lage öffentlich (verfremdet)" })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('input[name="point"]')).toHaveValue("keep");
    await page.getByRole("button", { name: "Speichern und weiter" }).click();
    await expect(page).toHaveURL(/saved=1/);
    const after = await service.from("listings").select("status, map_point, display_location").eq("id", ids["Sachsen Punkt"]).single();
    expect(after.data).toEqual(before.data);
  });

  test("Ohne JavaScript: Schritt Ort speichert mit keep, Punkt und Status bleiben", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    await useSession(context, owner);
    const page = await context.newPage();
    const service = admin();
    const before = await service.from("listings").select("status, map_point").eq("id", ids["Sachsen Punkt"]).single();
    await page.goto(`/de/account/listings/${ids["Sachsen Punkt"]}/edit?step=location`);
    expect(await page.content()).toContain("Den Punkt kannst du nur mit JavaScript setzen");
    await expect(page.locator('input[name="point"]')).toHaveValue("keep");
    await page.getByRole("button", { name: "Speichern und weiter" }).click();
    await expect(page).toHaveURL(/saved=1/);
    const after = await service.from("listings").select("status, map_point").eq("id", ids["Sachsen Punkt"]).single();
    expect(after.data).toEqual(before.data);
    await context.close();
  });

  test("Detail ohne Koordinaten außerhalb der Karte: JSON-LD, Meta, Titel, Sitemap", async ({ page, request }) => {
    const row = await admin().from("listings").select("map_point").eq("id", ids["Sachsen Punkt"]).single();
    const point = parsePoint(row.data!.map_point)!;
    await page.goto(`/de/anzeige/${ids["Sachsen Punkt"]}`);
    const head = await page.locator("head").innerHTML();
    const ld = (await page.locator('script[type="application/ld+json"]').allTextContents()).join("");
    for (const text of [head, ld]) {
      expect(text).not.toContain(point.lat.toFixed(4));
      expect(text).not.toContain(point.lng.toFixed(4));
    }
    const sitemap = await (await request.get("/sitemap/de.xml")).text();
    expect(sitemap).not.toContain(point.lat.toFixed(4));
  });

  // ---------------------------------------------------------------------------------------------------------------
  // Karte in Listen
  // ---------------------------------------------------------------------------------------------------------------
  test("Bereichssuche nach Herauszoomen: Liste enthält die Anzeige in München", async ({ page }) => {
    await page.goto(`/de/suche?view=map&q=${encodeURIComponent(RUN)}&bbox=${SAXONY.join(",")}`);
    await expect(page.getByText(/Anzeigen auf der Karte/)).toBeVisible({ timeout: 20_000 });
    expect(await listedTitles(page)).not.toContain(T("Muenchen Punkt"));
    await zoomOut(page, 3);
    await page.getByRole("button", { name: "In diesem Bereich suchen" }).click();
    await expect.poll(() => listedTitles(page), { timeout: 15_000 }).toContain(T("Muenchen Punkt"));
  });

  test("F1: Karte lädt nach Verschieben, Zoomen und „In diesem Bereich suchen“ keine Punkte nach", async ({ page }) => {
    test.fail(true, "F1: /api/map nur einmal beim Start");
    const calls: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/map")) calls.push(request.url());
    });
    await page.goto(`/de/suche?view=map&q=${encodeURIComponent(RUN)}&bbox=${SAXONY.join(",")}`);
    await expect(page.getByText(/Anzeigen auf der Karte/)).toBeVisible({ timeout: 20_000 });
    const initial = calls.length;
    await zoomOut(page, 3);
    await page.getByRole("button", { name: "In diesem Bereich suchen" }).click();
    await expect.poll(() => listedTitles(page), { timeout: 15_000 }).toContain(T("Muenchen Punkt"));
    await expect.poll(() => calls.length, { timeout: 5_000 }).toBeGreaterThan(initial);
    await expect(page.getByRole("button", { name: new RegExp(`^${T("Muenchen Punkt")}`) })).toHaveCount(1);
  });

  test("F2: Bereichssuche mit einem Ausschnitt über 30° wird still verworfen", async ({ page }) => {
    test.fail(true, "F2: Kappung auf 30° plus Rundung nach außen ergibt 30,0001°");
    await page.goto(`/de/suche?view=map&q=${encodeURIComponent(RUN)}`);
    await expect(page.getByText(/Anzeigen auf der Karte/)).toBeVisible({ timeout: 20_000 });
    await zoomOut(page, 3);
    await page.getByRole("button", { name: "In diesem Bereich suchen" }).click();
    await expect(page).toHaveURL(/bbox=/);
    await expect(page.getByText("Gefiltert nach Kartenbereich.")).toBeVisible({ timeout: 10_000 });
  });

  test("F3: Steuerelemente der Karte sind nicht übersetzt (Zoom-Buttons englisch)", async ({ page }) => {
    test.fail(true, "F3: MapLibre ohne locale");
    await page.goto(`/de/suche?view=map&q=${encodeURIComponent(RUN)}`);
    await expect(page.locator(".maplibregl-canvas")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".maplibregl-ctrl-zoom-in")).toBeVisible();
    expect(await page.locator(".maplibregl-ctrl-zoom-in").getAttribute("aria-label")).not.toBe("Zoom in");
  });

  test("Tastatur: Karte → Marker → Steuerelemente → Liste; Kurzkarte mit Schließen-Button gibt den Fokus zurück", async ({ page }) => {
    await page.goto(`/de/suche?view=map&q=${encodeURIComponent(RUN)}&bbox=${SAXONY.join(",")}`);
    await expect(page.getByText(/Anzeigen auf der Karte/)).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1000);
    await page.getByRole("link", { name: "Karte", exact: true }).focus();
    const order: string[] = [];
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press("Tab");
      order.push(await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el) return "";
        if (el.classList.contains("maplibregl-canvas")) return "canvas";
        if (el.classList.contains("map-marker")) return "marker";
        if (el.closest(".maplibregl-ctrl")) return "control";
        if (el.textContent === "In diesem Bereich suchen") return "area";
        if (el.closest("article")) return "list";
        return el.tagName.toLowerCase();
      }));
    }
    const first = (kind: string) => order.indexOf(kind);
    expect(first("canvas")).toBeGreaterThanOrEqual(0);
    expect(first("marker")).toBeGreaterThan(first("canvas"));
    expect(first("area")).toBeGreaterThan(first("marker"));
    // Kurzkarte über die Tastatur öffnen, mit dem Button schließen
    const marker = page.locator(".map-marker:not(.map-cluster)").first();
    for (let i = 0; i < 6 && (await marker.count()) === 0; i++) {
      // Cluster per Tastatur öffnen (Enter zoomt hinein)
      await page.locator(".map-cluster").first().focus();
      await page.keyboard.press("Enter");
      await page.waitForTimeout(1000);
    }
    await marker.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("link").first()).toBeFocused();
    await dialog.getByRole("button", { name: "Schließen" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(".map-marker:focus")).toHaveCount(1);
  });

  // ---------------------------------------------------------------------------------------------------------------
  // /api/map
  // ---------------------------------------------------------------------------------------------------------------
  test("/api/map: Koordinaten wie gespeichert, Kreismittelpunkt-Semantik, Header, kein CORS, Sprache", async ({ request }) => {
    const wide = `bbox=5.8,45.8,17.2,55.1&q=${encodeURIComponent(RUN)}`;
    const response = await request.get(`/api/map?${wide}&lang=cs`, { headers: { Origin: "https://evil.example" } });
    expect(response.status()).toBe(200);
    const headers = response.headers();
    expect(headers["cache-control"]).toBe("private, no-store");
    expect(headers["content-type"]).toContain("application/geo+json");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["access-control-allow-origin"]).toBeUndefined();
    const data = (await response.json()) as { features: { geometry: { coordinates: [number, number] }; properties: Record<string, string> }[] };
    const byTitle = new Map(data.features.map((f) => [f.properties.title, f]));
    const service = admin();
    for (const key of ["Sachsen Punkt", "Muenchen Punkt", "Mitte"]) {
      const row = await service.from("listings").select("map_point").eq("id", ids[key]).single();
      const p = parsePoint(row.data!.map_point)!;
      // Bis auf die 15. Stelle (F4: map_listings rundet unter extra_float_digits = 0)
      const [lng, lat] = byTitle.get(T(key))!.geometry.coordinates;
      expect(lng, key).toBeCloseTo(p.lng, 10);
      expect(lat, key).toBeCloseTo(p.lat, 10);
    }
    expect(byTitle.get(T("Mitte"))!.geometry.coordinates).toEqual([bigCentre.lng, bigCentre.lat]);
    expect(byTitle.get(T("Mitte"))!.properties.kind).toBe("Pomocník při lovu");
    expect(byTitle.get(T("Mitte"))!.properties.href).toMatch(/^\/cs\//);
    expect(JSON.stringify(data)).not.toMatch(/owner_id|postal|place_name/);
    // Bereich über einem Teil des Kreises, aber ohne Mittelpunkt: Anzeige ohne Punkt fehlt (Karte und Liste)
    const part = [bigCentre.lng + 0.02, bigCentre.lat - 0.2, bigCentre.lng + 0.4, bigCentre.lat + 0.2].map((v) => v.toFixed(4)).join(",");
    const partData = (await (await request.get(`/api/map?bbox=${part}&q=${encodeURIComponent(RUN)}`)).json()) as typeof data;
    expect(partData.features.map((f) => f.properties.title)).not.toContain(T("Mitte"));
    // Fehler
    for (const bad of ["", "bbox=5,45,40,55", "bbox=13,51,12,52", "bbox=1e1,45,12,50", "bbox=a,b,c,d", `bbox=${"1".repeat(90)}`]) {
      const r = await request.get(`/api/map?${bad}`);
      expect(r.status(), bad).toBe(400);
      expect(await r.json()).toEqual({ error: "invalid", key: "bbox" });
      expect(r.headers()["cache-control"]).toBe("private, no-store");
    }
    expect((await request.post(`/api/map?${wide}`)).status()).toBe(405);
  });

  // ---------------------------------------------------------------------------------------------------------------
  // Sofortige Wirkung (Nutzer-Ergänzung M5, Review A6)
  // ---------------------------------------------------------------------------------------------------------------
  test("Entfernen, Sperren und Punkt entfernen wirken sofort auf Karte, Liste und Detail", async ({ page, request }) => {
    const listUrl = `/de/suche?q=${encodeURIComponent(RUN)}`;
    const mapUrl = `/api/map?bbox=5.8,45.8,17.2,55.1&q=${encodeURIComponent(RUN)}`;
    // Caches wärmen
    await page.goto(listUrl);
    expect(await listedTitles(page)).toEqual(expect.arrayContaining([T("Entfernt"), T("Gesperrt"), T("Punkt weg")]));
    await page.goto(`/de/anzeige/${ids["Punkt weg"]}`);
    await expect(page.getByText(/Der Punkt auf der Karte ist 3–5 km verschoben/)).toBeVisible();
    await page.goto(`/de/jagdhelfer/sachsen/saechsische-schweiz-osterzgebirge`);

    const service = admin();
    await service.from("listings").update({ status: "removed", reject_code: "prohibited_content" }).eq("id", ids.Entfernt);
    await service.from("profiles").update({ is_blocked: true }).eq("user_id", blockedId);
    await service.from("listings").update({ display_location: null }).eq("id", ids["Punkt weg"]);

    const map = (await (await request.get(mapUrl)).json()) as { features: { geometry: { coordinates: [number, number] }; properties: { title: string } }[] };
    const titles = map.features.map((f) => f.properties.title);
    expect(titles).not.toContain(T("Entfernt"));
    expect(titles).not.toContain(T("Gesperrt"));
    expect(map.features.find((f) => f.properties.title === T("Punkt weg"))!.geometry.coordinates).toEqual([bigCentre.lng, bigCentre.lat]);

    await page.goto(listUrl);
    const listed = await listedTitles(page);
    expect(listed).not.toContain(T("Entfernt"));
    expect(listed).not.toContain(T("Gesperrt"));
    expect(listed).toContain(T("Punkt weg"));
    await page.goto(`/de/jagdhelfer/sachsen/saechsische-schweiz-osterzgebirge`);
    expect(await listedTitles(page)).not.toContain(T("Entfernt"));
    expect((await request.get(`/de/anzeige/${ids.Entfernt}`)).status()).toBe(410);
    expect((await request.get(`/de/anzeige/${ids.Gesperrt}`)).status()).toBe(410);
    await page.goto(`/de/anzeige/${ids["Punkt weg"]}`);
    await expect(page.getByText(/Lage im Landkreis Sächsische Schweiz-Osterzgebirge, ohne genauen Punkt/)).toBeVisible();
  });

  // ---------------------------------------------------------------------------------------------------------------
  // Auslieferung, CSP, Sprachen, 360 px
  // ---------------------------------------------------------------------------------------------------------------
  test("Kachel-Route je nach Start (dev, ohne MAP_TILES_DIR, nur MAP_TILES_FILE, mit Verzeichnis)", async ({ request, page }) => {
    const fixture = "/tiles/basemap-fixture.pmtiles";
    if (TILES === "none" || TILES === "file-only") {
      expect((await request.head(fixture)).status()).toBe(404);
      expect((await request.get(fixture, { headers: { Range: "bytes=0-9" } })).status()).toBe(404);
      const tileRequests: string[] = [];
      page.on("request", (r) => {
        if (r.url().includes("/tiles/")) tileRequests.push(r.url());
      });
      await page.goto("/de/suche?view=map");
      await expect(page.locator(".maplibregl-canvas")).toBeVisible({ timeout: 20_000 });
      // Punkte bleiben nutzbar (neutraler Grund bzw. fehlende Kacheln), ohne Fehlermeldung
      await expect(page.getByText(/Anzeigen auf der Karte/)).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole("alert").filter({ hasText: /Karte|Anzeigen/ })).toHaveCount(0);
      await page.waitForTimeout(4000);
      if (TILES === "none") expect(tileRequests).toEqual([]);
      // Nur MAP_TILES_FILE: Die Karte fragt die Datei an (404 ohne CDN), aber ohne Fehlerschleife
      else expect(tileRequests.length).toBeLessThan(10);
      return;
    }
    const head = await request.head(fixture);
    expect(head.status()).toBe(200);
    expect(head.headers()["accept-ranges"]).toBe("bytes");
    expect(head.headers()["etag"]).toMatch(/^"[0-9a-f]+-[0-9a-f]+"$/);
    const part = await request.get(fixture, { headers: { Range: "bytes=0-126", "Accept-Encoding": "gzip, br" } });
    expect(part.status()).toBe(206);
    expect(part.headers()["content-encoding"]).toBeUndefined();
    expect(part.headers()["content-length"]).toBe("127");
    const suffix = await request.get(fixture, { headers: { Range: "bytes=-10" } });
    expect(suffix.status()).toBe(206);
    for (const range of ["bytes=0-1,5-9", "bytes=999999999999-", "bytes=5-1", "items=0-1"]) {
      const r = await request.get(fixture, { headers: { Range: range } });
      expect(r.status(), range).toBe(416);
      expect(r.headers()["content-range"]).toMatch(/^bytes \*\/\d+$/);
    }
    for (const bad of ["/tiles/..%2F..%2Fpackage.json", "/tiles/..%252F.env.local", "/tiles/.env.local", "/tiles/Basemap.pmtiles", "/tiles/x.pmtiles%00", "/tiles/a/b"]) {
      expect([400, 404], bad).toContain((await request.get(bad)).status());
    }
    expect((await request.post(fixture)).status()).toBe(405);
  });

  test("Hinweis: 416 trägt Cache-Control immutable", async ({ request }) => {
    test.skip(TILES === "none" || TILES === "file-only", "Ohne Kachel-Route");
    const r = await request.get("/tiles/basemap-fixture.pmtiles", { headers: { Range: "bytes=0-1,5-9" } });
    // Dokumentiert den Ist-Zustand (H in QA-REPORT): ein Fehler-Status mit einem Jahr Cache
    expect(r.headers()["cache-control"]).toBe("public, max-age=31536000, immutable");
  });

  test("CSP der Kartenseite: worker-src 'self', kein blob: für Skripte und Worker", async ({ request }) => {
    const r = await request.get(`/de/suche?view=map`);
    const csp = r.headers()["content-security-policy"];
    expect(csp).toMatch(/worker-src 'self'(;|$)/);
    const directive = (name: string) => csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? "";
    expect(directive("worker-src")).not.toContain("blob:");
    expect(directive("script-src")).not.toContain("blob:");
    expect(directive("connect-src")).not.toMatch(/tile|protomaps|openstreetmap/);
    const style = await request.get("/static/map/style-pl.v5.7.2.json");
    expect(style.headers()["cache-control"]).toContain("immutable");
    const worker = await request.get(`/static/map/maplibre-6.15.0/maplibre-gl-worker.mjs`);
    expect(worker.status()).toBe(200);
    expect(worker.headers()["content-type"]).toMatch(/javascript/);
    expect(worker.headers()["cache-control"]).toContain("immutable");
  });

  for (const locale of LOCALES) {
    test(`${locale}: Karte ohne fremde Hosts, ohne 404 bei Stil, Schriften und Kacheln, ohne CSP-Verletzung`, async ({ page }) => {
      const foreign: string[] = [];
      const failed: string[] = [];
      const csp: string[] = [];
      page.on("request", (request) => {
        const url = new URL(request.url());
        if (url.protocol.startsWith("http") && url.origin !== new URL(BASE).origin) foreign.push(request.url());
      });
      page.on("response", (response) => {
        if (response.status() >= 400 && /\/static\/map\/|\/tiles\/|\/api\/map/.test(response.url())) failed.push(`${response.status()} ${response.url()}`);
      });
      page.on("console", (message) => {
        if (/Content Security Policy|CSP /.test(message.text())) csp.push(message.text());
      });
      await page.addInitScript(() => {
        document.addEventListener("securitypolicyviolation", (e) => console.error(`CSP ${e.violatedDirective} ${e.blockedURI}`));
      });
      await page.goto(`${publicPath({ route: "search" }, locale)}?view=map`);
      await expect(page.locator(".maplibregl-canvas")).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(4000);
      expect(foreign).toEqual([]);
      // Nur MAP_TILES_FILE ohne CDN davor: Die Datei selbst ist 404 (erwartet), sonst nichts
      expect(failed.filter((f) => !(TILES === "file-only" && /\/tiles\//.test(f)))).toEqual([]);
      expect(csp).toEqual([]);
      await expect(page.locator(".maplibregl-ctrl-attrib")).toContainText("OpenStreetMap");
    });

    test(`${locale}: 360 px mit Karte (Liste und Detail), Attribution sichtbar, keine rohen Schlüssel`, async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 740 });
      await page.goto(`${publicPath({ route: "search" }, locale)}?view=map&q=${encodeURIComponent(RUN)}`);
      await expect(page.locator(".maplibregl-canvas")).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(1500);
      const check = async (where: string) => {
        expect(await page.evaluate(() => document.documentElement.scrollWidth), where).toBeLessThanOrEqual(360);
        const attrib = page.locator(".maplibregl-ctrl-attrib").first();
        await expect(attrib).toBeVisible();
        await expect(attrib).toContainText("OpenStreetMap");
        await expect(attrib).toContainText("Protomaps");
        const box = (await attrib.boundingBox())!;
        expect(box.x, where).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, where).toBeLessThanOrEqual(360);
        const text = await page.locator("main").innerText();
        expect(text, where).not.toMatch(/\bMap\.[a-zA-Z]+|\{count\}|\{district\}/);
        expect(await page.locator("html").getAttribute("lang")).toBe(locale);
      };
      await check("Liste");
      await page.goto(publicPath({ route: "listing", id: ids["Sachsen Punkt"] }, locale));
      await page.locator("#location-heading ~ button").click();
      await expect(page.locator(".maplibregl-canvas")).toBeVisible({ timeout: 20_000 });
      await check("Detail");
    });
  }

  test("Ohne JavaScript: Detail mit Lage-Text, ohne Karten-Button-Funktion", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(`/de/anzeige/${ids["Sachsen Punkt"]}`);
    const html = await page.content();
    expect(html).toContain("Der Punkt auf der Karte ist 3–5 km verschoben");
    expect(html).toContain("Die Karte braucht JavaScript.");
    await context.close();
  });

});
