import { createClient } from "@supabase/supabase-js";
import { expect, test, type BrowserContext } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { admin, deleteTestUsers, local } from "./cleanup";
import { uniqueEmail } from "./mailpit";
import { parsePoint } from "../lib/map/geo";

// M6 Punktwahl im Assistenten (ADR 016, Review B1, B3, A8): per Tastatur (Fadenkreuz), gespeichert nur verfremdet,
// nie als Eingabe vorbelegt, Entfernen, kleine Kreise ohne Punktwahl, Hinweis bei weiteren Punkten im Kreis.

const created: string[] = [];
test.afterAll(() => deleteTestUsers(created));
test.describe.configure({ mode: "serial" });

function anonKey(): string {
  const out = execFileSync("supabase", ["status", "-o", "env"], {
    cwd: path.resolve(process.cwd(), ".."), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 30_000,
  });
  const match = /^(?:ANON_KEY|PUBLISHABLE_KEY)="?([^"\n]+)"?$/m.exec(out);
  if (!match) throw new Error("ANON_KEY");
  return match[1];
}

async function signIn(context: BrowserContext, email: string) {
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
  await context.addCookies(chunks.map((chunk, i) => ({ name: chunks.length === 1 ? name : `${name}.${i}`, value: chunk, url: "http://localhost:3000", sameSite: "Lax" as const })));
  return client;
}

const distanceKm = (a: { lng: number; lat: number }, b: { lng: number; lat: number }) =>
  Math.hypot((a.lng - b.lng) * 111.32 * Math.cos((a.lat * Math.PI) / 180), (a.lat - b.lat) * 111.32);

test.describe("Punktwahl im Assistenten (M6)", () => {
  test.skip(!local, "Lokale Supabase nötig");
  let email = "";
  let owner = "";
  const ids: Record<string, string> = {};

  test.beforeAll(async () => {
    const service = admin();
    email = uniqueEmail("m6-picker");
    created.push(email);
    const { data } = await service.auth.admin.createUser({ email, email_confirm: true });
    owner = data.user!.id;
    const region = async (code: string) => (await service.from("regions").select("id").eq("code", code).single()).data!.id as string;
    const rows = await service
      .from("listings")
      .insert([
        { owner_id: owner, kind: "helper", direction: "wanted", title: "Punktwahl groß", content_language: "de", region_id: await region("DE-14628") },
        { owner_id: owner, kind: "helper", direction: "wanted", title: "Punktwahl klein", content_language: "de", region_id: await region("DE-14612") },
        { owner_id: owner, kind: "helper", direction: "wanted", title: "Punktwahl zweite", content_language: "de", region_id: await region("DE-14628") },
      ])
      .select("id, title");
    for (const row of rows.data!) ids[row.title] = row.id;
  });

  test("Per Tastatur: Fadenkreuz setzen, speichern ergibt einen verfremdeten Punkt, nie vorbelegt", async ({ page }) => {
    await signIn(page.context(), email);
    await page.goto(`/de/account/listings/${ids["Punktwahl groß"]}/edit?step=location`);
    const setCentre = page.getByRole("button", { name: "Punkt in der Kartenmitte setzen" });
    await expect(setCentre).toBeVisible();
    await expect(setCentre).toBeEnabled({ timeout: 20_000 });
    await expect(page.locator('input[name="point"]')).toHaveValue("keep");
    await setCentre.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Punkt gewählt. Er wird beim Speichern übernommen.")).toBeVisible();
    const chosen = {
      lat: Number(await page.locator('input[name="lat"]').inputValue()),
      lng: Number(await page.locator('input[name="lng"]').inputValue()),
    };
    await page.getByRole("button", { name: "Speichern und weiter" }).click();
    await expect(page).toHaveURL(/saved=1/);

    // Entwurf ist nicht öffentlich: Punkt direkt aus der Tabelle (service_role, nur im Test)
    const row = await admin().from("listings").select("map_point").eq("id", ids["Punktwahl groß"]).single();
    const coords = parsePoint(row.data!.map_point);
    expect(coords).not.toBeNull();
    const d = distanceKm(coords!, chosen);
    expect(d).toBeGreaterThan(2.2);
    expect(d).toBeLessThan(5.8);

    // Erneut öffnen: Der gespeicherte Punkt erscheint nur als öffentlicher Marker, nie in den Eingabefeldern.
    await page.goto(`/de/account/listings/${ids["Punktwahl groß"]}/edit?step=location`);
    await expect(page.getByRole("img", { name: "So erscheint die Lage öffentlich (verfremdet)" })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('input[name="point"]')).toHaveValue("keep");
    await expect(page.locator('input[name="lat"]')).toHaveCount(0);
    // Unverändert speichern lässt den Punkt stehen
    await page.getByRole("button", { name: "Speichern und weiter" }).click();
    await expect(page).toHaveURL(/saved=1/);
    const again = await admin().from("listings").select("map_point").eq("id", ids["Punktwahl groß"]).single();
    expect(again.data!.map_point).toEqual(row.data!.map_point);
  });

  test("Hinweis bei weiterem Punkt im selben Kreis; Entfernen ergibt den Kreismittelpunkt", async ({ page }) => {
    await signIn(page.context(), email);
    await page.goto(`/de/account/listings/${ids["Punktwahl zweite"]}/edit?step=location`);
    await expect(page.getByText(/Mehrere Punkte in einem Kreis zeigen, wie deine Reviere zueinander liegen/)).toBeVisible();
    await page.goto(`/de/account/listings/${ids["Punktwahl groß"]}/edit?step=location`);
    await expect(page.getByRole("button", { name: "Punkt in der Kartenmitte setzen" })).toBeEnabled({ timeout: 20_000 });
    await page.getByRole("button", { name: "Punkt entfernen" }).click();
    await expect(page.locator('input[name="point"]')).toHaveValue("clear");
    await page.getByRole("button", { name: "Speichern und weiter" }).click();
    await expect(page).toHaveURL(/saved=1/);
    const row = await admin().from("listings").select("display_location").eq("id", ids["Punktwahl groß"]).single();
    expect(row.data!.display_location).toBeNull();
  });

  test("Kleiner Kreis (Dresden): keine Punktwahl, Erklärung", async ({ page }) => {
    await signIn(page.context(), email);
    await page.goto(`/de/account/listings/${ids["Punktwahl klein"]}/edit?step=location`);
    await expect(page.getByText(/In diesem Kreis ist kein Kartenpunkt möglich/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Punkt in der Kartenmitte setzen" })).toHaveCount(0);
  });
});

test.describe("Punktwahl: Barrierefreiheit (M6)", () => {
  test.skip(!local, "Lokale Supabase nötig");

  test("axe ohne schwere Verstöße im Schritt Ort mit Karte", async ({ page }) => {
    const { default: AxeBuilder } = await import("@axe-core/playwright");
    const service = admin();
    const email = uniqueEmail("m6-axe");
    created.push(email);
    const { data } = await service.auth.admin.createUser({ email, email_confirm: true });
    const region = (await service.from("regions").select("id").eq("code", "DE-14628").single()).data!.id;
    const row = await service.from("listings").insert({ owner_id: data.user!.id, kind: "helper", direction: "wanted", title: "Axe Ort", content_language: "de", region_id: region }).select("id").single();
    await signIn(page.context(), email);
    await page.goto(`/de/account/listings/${row.data!.id}/edit?step=location`);
    await expect(page.getByRole("button", { name: "Punkt in der Kartenmitte setzen" })).toBeEnabled({ timeout: 20_000 });
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).exclude(".maplibregl-canvas").analyze();
    expect(result.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
});
