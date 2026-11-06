import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { admin, deleteTestUsers, local } from "./cleanup";
import { createAccount, createPublicListing, signInAs, type TestAccount } from "./session";

// M8 Suchaufträge (ADR 018, Plan M8 5 und 7): Suche speichern aus Liste und Karte (mit Kartenausschnitt), anonym
// zum Login, Konto-Seite (Takt, E-Mail, Pausieren/Fortsetzen, Umbenennen, Löschen zweistufig, Ergebnisse ansehen,
// Verlängern nur im Fenster), Limit 25, Abbestellseite mit Token aus einer echten Mail (mit und ohne JavaScript, ohne
// Token), axe auf allen neuen Seiten, 360 px in vier Sprachen ohne Überbreite.

const created: string[] = [];
test.afterAll(() => deleteTestUsers(created));
test.describe.configure({ mode: "serial" });

const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
const RUN = Array.from({ length: 10 }, () => "bcdfghjklmnpqrstvwxz"[Math.floor(Math.random() * 20)]).join("");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** SQL gegen den lokalen Stack (CLI ohne --remote), nur feste Anweisungen mit geprüften IDs. */
function sql(query: string): string {
  return execFileSync("supabase", ["db", "query", "-o", "json", query], {
    cwd: path.resolve(process.cwd(), ".."), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000,
  });
}
function rows<T>(query: string): T[] {
  const out = sql(query);
  const parsed = JSON.parse(out.slice(out.search(/[[{]/))) as T[] | { rows?: T[] };
  return Array.isArray(parsed) ? parsed : (parsed.rows ?? []);
}
function id(value: string): string {
  if (!UUID.test(value)) throw new Error("uuid");
  return value;
}

async function searchesOf(account: TestAccount) {
  const { data } = await admin().from("saved_searches")
    .select("id, name, filters, cadence, notify_email, paused_at, expires_at").eq("user_id", account.id).order("created_at");
  return data ?? [];
}

async function noOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, label).toBeLessThanOrEqual(0);
}

async function axe(page: Page, label: string) {
  const { default: AxeBuilder } = await import("@axe-core/playwright");
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(result.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${label} ${v.id}: ${v.nodes.length}`)).toEqual([]);
}

test.describe("Suchaufträge (M8)", () => {
  test.skip(!local, "Lokale Supabase nötig");
  let searcher: TestAccount;
  let full: TestAccount;
  let owner: TestAccount;
  let unsubscribeLink = "";

  test.beforeAll(async () => {
    searcher = await createAccount("m8-e2e", "Sabine Suchende", created);
    full = await createAccount("m8-e2e-voll", "Volker Voll", created);
    owner = await createAccount("m8-e2e-owner", "Otto Anbieter", created);
  });

  test("Anonym: Link zum Login mit Rücksprung auf die Suche, ohne Suchtext", async ({ page }) => {
    await page.goto(`/de/suche?kind=helper&q=${RUN}`);
    const link = page.getByRole("link", { name: "Anmelden, um diese Suche zu speichern" });
    await expect(link).toBeVisible();
    const href = (await link.getAttribute("href"))!;
    expect(href).toMatch(/^\/de\/login\?next=/);
    const next = decodeURIComponent(new URL(href, "http://x").searchParams.get("next")!);
    expect(next.startsWith("/de/suche")).toBe(true);
    expect(next).not.toContain(RUN); // H10: kein Suchtext in der Login-URL
    await expect(page.getByRole("button", { name: "Suchauftrag speichern" })).toHaveCount(0);
  });

  test("Suche speichern aus der Liste: Name vorbelegt, Takt täglich, Weiterleitung auf die Konto-Seite", async ({ page }) => {
    await signInAs(page.context(), searcher);
    await page.goto(`/de/suche?kind=helper&q=${RUN}&sort=newest`);
    await page.getByText("Suche speichern", { exact: true }).click();
    await expect(page.getByText("Filter dieses Suchauftrags")).toBeVisible();
    const name = page.getByLabel("Name", { exact: true });
    await expect(name).toHaveValue(new RegExp(RUN));
    await name.fill(`Liste ${RUN}`);
    await page.getByRole("radio", { name: /Täglich/ }).check();
    await page.getByRole("button", { name: "Suchauftrag speichern" }).click();
    await expect(page).toHaveURL(/\/de\/account\/searches\?notice=created#search-[0-9a-f-]{36}$/);
    await expect(page.getByRole("status")).toHaveText("Dein Suchauftrag ist gespeichert.");
    const [row] = await searchesOf(searcher);
    expect(row).toMatchObject({ name: `Liste ${RUN}`, cadence: "daily", notify_email: true, paused_at: null, filters: { v: 1, kind: "helper", q: RUN } });
    const item = page.locator(`#search-${row.id}`);
    await expect(item.getByRole("heading", { name: `Liste ${RUN}` })).toBeVisible();
    await expect(item).toContainText(/Aktiv, läuft bis/);
    await expect(item).toContainText("Täglich");
    // Die Konto-Übersicht verlinkt die Seite
    await page.goto("/de/account");
    await page.getByRole("link", { name: "Suchaufträge" }).click();
    await expect(page).toHaveURL(/\/de\/account\/searches$/);
    await expect(page.getByRole("heading", { level: 1, name: "Suchaufträge" })).toBeVisible();
  });

  test("Suche speichern aus der Karte: Kartenausschnitt sichtbar, mitgespeichert, Ergebnisse öffnen die Karte", async ({ page }) => {
    await signInAs(page.context(), searcher);
    await page.goto(`/de/suche?view=map&q=${RUN}&bbox=13,50.5,14.8,51.4`);
    await page.getByText("Suche speichern", { exact: true }).click();
    await expect(page.getByText(/Der Kartenausschnitt wird mitgespeichert/)).toBeVisible();
    await expect(page.locator("details").getByText("Kartenausschnitt", { exact: true })).toBeVisible();
    await page.getByLabel("Name", { exact: true }).fill(`Karte ${RUN}`);
    await page.getByRole("button", { name: "Suchauftrag speichern" }).click();
    await expect(page).toHaveURL(/\/de\/account\/searches\?notice=created/);
    const map = (await searchesOf(searcher)).find((s) => s.name === `Karte ${RUN}`)!;
    expect(map.filters).toEqual({ v: 1, q: RUN, bbox: [13, 50.5, 14.8, 51.4] });
    expect(map.cadence).toBe("instant");
    const results = page.locator(`#search-${map.id}`).getByRole("link", { name: "Ergebnisse ansehen" });
    const href = (await results.getAttribute("href"))!;
    expect(href).toMatch(/^\/de\/suche\?/);
    const params = new URL(href, "http://x").searchParams;
    expect(params.get("view")).toBe("map");
    expect(params.get("bbox")).toBe("13,50.5,14.8,51.4");
    expect(params.get("q")).toBe(RUN);
  });

  test("Ohne JavaScript speichern (PRG) und Fehler „Suchbegriff zu lang“ bzw. ungültige Filter", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    await signInAs(context, searcher);
    const page = await context.newPage();
    await page.goto(`/de/suche?kind=permit&q=${RUN}`);
    await page.getByText("Suche speichern", { exact: true }).click();
    await page.getByLabel("Name", { exact: true }).fill(`Ohne JS ${RUN}`);
    await page.getByRole("button", { name: "Suchauftrag speichern" }).click();
    await expect(page).toHaveURL(/\/de\/account\/searches\?notice=created/);
    expect((await searchesOf(searcher)).some((s) => s.name === `Ohne JS ${RUN}`)).toBe(true);

    // Manipulierte Filter im versteckten Feld: Fehler ohne JS über ?error=, Formular offen
    await page.goto(`/de/suche?kind=permit&q=${RUN}`);
    await page.locator('input[name="filters"]').evaluate((el: HTMLInputElement) => { el.value = '{"v":1,"unknown":true}'; });
    await page.getByText("Suche speichern", { exact: true }).click();
    await page.getByRole("button", { name: "Suchauftrag speichern" }).click();
    await expect(page).toHaveURL(/error=invalid/);
    await expect(page.locator("details").getByRole("alert")).toContainText("Diese Filter lassen sich nicht speichern");

    // Suchbegriff mit mehr als 32 Knoten (B3): die DB lehnt ab, das Web zeigt „Suchbegriff zu lang“.
    const long = Array.from({ length: 40 }, (_, n) => `w${String.fromCharCode(97 + (n % 26))}${String.fromCharCode(97 + Math.floor(n / 26))}x`).join(" ");
    await page.goto(`/de/suche?kind=permit&q=${RUN}`);
    await page.locator('input[name="filters"]').evaluate((el: HTMLInputElement, q) => { el.value = JSON.stringify({ v: 1, q }); }, long);
    await page.getByText("Suche speichern", { exact: true }).click();
    await page.getByRole("button", { name: "Suchauftrag speichern" }).click();
    await expect(page).toHaveURL(/error=queryTooLong/);
    await expect(page.locator("details").getByRole("alert")).toContainText("Der Suchbegriff ist zu lang zum Speichern.");
    await context.close();
  });

  test("Konto-Seite: Takt, E-Mail, Pausieren/Fortsetzen, Umbenennen, Löschen zweistufig", async ({ page }) => {
    await signInAs(page.context(), searcher);
    const row = (await searchesOf(searcher)).find((s) => s.name === `Liste ${RUN}`)!;
    await page.goto("/de/account/searches");
    const item = page.locator(`#search-${row.id}`);

    await item.getByRole("button", { name: "Auf sofort umstellen" }).click();
    await expect(page.getByRole("status")).toHaveText("Die Häufigkeit der E-Mails ist geändert.");
    await expect(item).toContainText("Sofort");
    expect((await searchesOf(searcher)).find((s) => s.id === row.id)!.cadence).toBe("instant");

    await item.getByRole("button", { name: "E-Mail ausschalten" }).click();
    await expect(page.getByRole("status")).toHaveText("E-Mails sind ausgeschaltet.");
    expect((await searchesOf(searcher)).find((s) => s.id === row.id)!.notify_email).toBe(false);
    await item.getByRole("button", { name: "E-Mail einschalten" }).click();
    await expect(page.getByRole("status")).toHaveText("E-Mails sind eingeschaltet.");
    expect((await searchesOf(searcher)).find((s) => s.id === row.id)!.notify_email).toBe(true);

    await item.getByRole("button", { name: "Pausieren" }).click();
    await expect(page.getByRole("status")).toHaveText("Der Suchauftrag ist pausiert.");
    await expect(item).toContainText(/Pausiert, läuft trotzdem am .* ab/);
    await expect(item).toContainText("Pausieren hält die Laufzeit nicht an.");
    expect((await searchesOf(searcher)).find((s) => s.id === row.id)!.paused_at).not.toBeNull();
    await item.getByRole("button", { name: "Fortsetzen" }).click();
    await expect(page.getByRole("status")).toHaveText("Der Suchauftrag ist wieder aktiv.");
    expect((await searchesOf(searcher)).find((s) => s.id === row.id)!.paused_at).toBeNull();

    await item.getByText("Umbenennen", { exact: true }).click();
    await item.getByLabel("Name", { exact: true }).fill(`Umbenannt ${RUN}`);
    await item.getByRole("button", { name: "Namen speichern" }).click();
    await expect(page.getByRole("status")).toHaveText("Der Name ist gespeichert.");
    await expect(item.getByRole("heading", { name: `Umbenannt ${RUN}` })).toBeVisible();

    // Ergebnisse ansehen: dieselben Filter in der Liste
    const href = (await item.getByRole("link", { name: "Ergebnisse ansehen" }).getAttribute("href"))!;
    const params = new URL(href, "http://x").searchParams;
    expect([params.get("kind"), params.get("q"), params.get("view")]).toEqual(["helper", RUN, null]);

    // Löschen: erst die Rückfrage, Abbrechen behält, dann endgültig
    await item.getByRole("link", { name: "Löschen" }).click();
    await expect(page).toHaveURL(new RegExp(`delete=${row.id}`));
    await expect(item.getByText(`„Umbenannt ${RUN}“ löschen?`)).toBeVisible();
    await item.getByRole("link", { name: "Abbrechen" }).click();
    await expect(item.getByRole("button", { name: "Endgültig löschen" })).toHaveCount(0);
    expect((await searchesOf(searcher)).some((s) => s.id === row.id)).toBe(true);
    await item.getByRole("link", { name: "Löschen" }).click();
    await item.getByRole("button", { name: "Endgültig löschen" }).click();
    await expect(page.getByRole("status")).toHaveText("Der Suchauftrag ist gelöscht.");
    expect((await searchesOf(searcher)).some((s) => s.id === row.id)).toBe(false);
    await expect(page.locator(`#search-${row.id}`)).toHaveCount(0);
  });

  test("Verlängern: außerhalb des Fensters nur der Hinweis, im Fenster der Button (+6 Wochen)", async ({ page }) => {
    await signInAs(page.context(), searcher);
    const row = (await searchesOf(searcher)).find((s) => s.name === `Karte ${RUN}`)!;
    await page.goto("/de/account/searches");
    const item = page.locator(`#search-${row.id}`);
    await expect(item.getByRole("button", { name: "Um 6 Wochen verlängern" })).toHaveCount(0);
    await expect(item).toContainText(/Verlängern kannst du ab \d/);

    // Server-Pfad: Ablauf in 5 Tagen (Fenster 14 Tage)
    await admin().from("saved_searches").update({ expires_at: new Date(Date.now() + 5 * 864e5).toISOString() }).eq("id", row.id);
    await page.reload();
    await expect(item).toContainText(/Läuft ab am/);
    await item.getByRole("button", { name: "Um 6 Wochen verlängern" }).click();
    await expect(page.getByRole("status")).toHaveText("Der Suchauftrag läuft jetzt weitere 6 Wochen.");
    const after = new Date((await searchesOf(searcher)).find((s) => s.id === row.id)!.expires_at).getTime();
    expect(Math.abs(after - (Date.now() + 42 * 864e5))).toBeLessThan(60 * 60 * 1000);
    await expect(item.getByRole("button", { name: "Um 6 Wochen verlängern" })).toHaveCount(0);

    // Abgelaufen: Status mit Löschdatum, Verlängern möglich, kein Pausieren
    await admin().from("saved_searches").update({ expires_at: new Date(Date.now() - 864e5).toISOString() }).eq("id", row.id);
    await page.reload();
    await expect(item).toContainText(/Abgelaufen am .* gelöscht/);
    await expect(item.getByRole("button", { name: "Um 6 Wochen verlängern" })).toBeVisible();
    await expect(item.getByRole("button", { name: "Pausieren" })).toHaveCount(0);
  });

  test("Limit 25: Fehlertext beim 26. Suchauftrag mit Link zur Verwaltung", async ({ page }) => {
    const service = admin();
    const inserts = Array.from({ length: 25 }, (_, n) => ({ user_id: full.id, name: `Voll ${n}`, filters: { v: 1, q: `${RUN}${n}` } }));
    expect((await service.from("saved_searches").insert(inserts)).error).toBeNull();
    await signInAs(page.context(), full);
    await page.goto(`/de/suche?q=${RUN}`);
    await page.getByText("Suche speichern", { exact: true }).click();
    await page.getByRole("button", { name: "Suchauftrag speichern" }).click();
    const alert = page.locator("main").getByRole("alert");
    await expect(alert).toContainText("Du kannst höchstens 25 Suchaufträge haben, abgelaufene zählen mit.");
    await expect(alert.getByRole("link", { name: "Suchaufträge verwalten" })).toHaveAttribute("href", "/de/account/searches");
    expect((await searchesOf(full)).length).toBe(25);
    await page.goto("/de/account/searches");
    await expect(page.getByText("25 von 25 Suchaufträgen")).toBeVisible();
  });

  test("Abbestellen mit Token aus der Mail: GET ändert nichts, Seite noindex/no-referrer, ohne JavaScript per Button", async ({ browser }) => {
    // Echte Mail: Auftrag, öffentliche Anzeige (Server-Pfad setzt published_at), Function, Treffer fällig machen.
    const word = `${RUN}abb`;
    const { data: search } = await admin().from("saved_searches")
      .insert({ user_id: searcher.id, name: `Abbestellen ${RUN}`, filters: { v: 1, q: word } }).select("id").single();
    await createPublicListing(owner.id, `Mail ${word}`);
    const secret = rows<{ s: string }>("select decrypted_secret as s from vault.decrypted_secrets where name = 'search_notifications_secret'")[0].s;
    const run = () => fetch(`${local!.url}/functions/v1/send-search-notifications`, { method: "POST", headers: { "x-search-notify-secret": secret } });
    expect((await run()).status).toBe(200);
    sql(`update private.saved_search_matches set due_at = now() - interval '1 minute' where user_id = '${id(searcher.id)}' and done_at is null`);
    expect((await run()).status).toBe(200);
    let text = "";
    await expect.poll(async () => {
      const found = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${searcher.email}"`)}`)).json() as { messages: { ID: string }[] };
      if (!found.messages.length) return false;
      text = ((await (await fetch(`${MAILPIT}/api/v1/message/${found.messages[0].ID}`)).json()) as { Text: string }).Text;
      return true;
    }, { timeout: 15_000 }).toBe(true);
    unsubscribeLink = /http:\/\/localhost:3000(\/de\/unsubscribe\?t=[0-9a-f]{64})/.exec(text)![1];

    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    const response = await page.goto(unsubscribeLink);
    expect(response!.status()).toBe(200);
    const h = response!.headers();
    expect(h["referrer-policy"]).toBe("no-referrer");
    expect(h["x-robots-tag"]).toContain("noindex");
    expect(h["cache-control"]).toMatch(/no-store/);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.getByRole("heading", { name: "E-Mails abbestellen" })).toBeVisible();
    // Der GET ändert nichts
    expect((await searchesOf(searcher)).find((s) => s.id === search!.id)!.notify_email).toBe(true);

    await page.getByRole("button", { name: "Abbestellen" }).click();
    await expect(page.getByRole("status")).toHaveText("Erledigt. Wenn der Link gültig war, bekommst du diese E-Mails nicht mehr.");
    expect(page.url()).toMatch(/\/api\/unsubscribe$/);
    await expect(page.getByRole("link", { name: "Impressum" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Datenschutzerklärung" })).toBeVisible();
    expect((await searchesOf(searcher)).find((s) => s.id === search!.id)!.notify_email).toBe(false);
    await context.close();
  });

  test("One-Click (RFC 8058): POST ohne Cookies an genau die URL aus List-Unsubscribe, immer 200", async ({ playwright }) => {
    const word = `${RUN}one`;
    const { data: search } = await admin().from("saved_searches")
      .insert({ user_id: searcher.id, name: `One-Click ${RUN}`, filters: { v: 1, q: word } }).select("id").single();
    await createPublicListing(owner.id, `Mail ${word}`);
    const secret = rows<{ s: string }>("select decrypted_secret as s from vault.decrypted_secrets where name = 'search_notifications_secret'")[0].s;
    const run = () => fetch(`${local!.url}/functions/v1/send-search-notifications`, { method: "POST", headers: { "x-search-notify-secret": secret } });
    expect((await run()).status).toBe(200);
    sql(`update private.saved_search_matches set due_at = now() - interval '1 minute' where user_id = '${id(searcher.id)}' and done_at is null`);
    sql(`update private.search_notification_state set last_sent_at = now() - interval '1 hour' where user_id = '${id(searcher.id)}'`);
    expect((await run()).status).toBe(200);
    let header = "";
    let post = "";
    await expect.poll(async () => {
      const found = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${searcher.email}" ${word}`)}`)).json() as { messages: { ID: string }[] };
      if (!found.messages.length) return false;
      const headers = await (await fetch(`${MAILPIT}/api/v1/message/${found.messages[0].ID}/headers`)).json() as Record<string, string[]>;
      header = headers["List-Unsubscribe"]?.[0] ?? "";
      post = headers["List-Unsubscribe-Post"]?.[0] ?? "";
      return true;
    }, { timeout: 15_000 }).toBe(true);
    expect(post).toBe("List-Unsubscribe=One-Click");
    const url = /^<(http:\/\/localhost:3000\/api\/unsubscribe\?t=[0-9a-f]{64})>$/.exec(header)![1];

    // Wie ein Mail-Client: eigener Kontext ohne Cookies, Formular-Body nach RFC 8058
    const client = await playwright.request.newContext();
    const invalid = await client.post(url.replace(/t=[0-9a-f]{64}/, `t=${"0".repeat(64)}`), { form: { "List-Unsubscribe": "One-Click" }, maxRedirects: 0 });
    const valid = await client.post(url, { form: { "List-Unsubscribe": "One-Click" }, maxRedirects: 0 });
    expect(valid.status()).toBe(200);
    expect(invalid.status()).toBe(200);
    expect(await valid.text()).toBe(await invalid.text());
    expect(valid.headers()["cache-control"]).toMatch(/no-store/);
    expect(valid.headers()["set-cookie"]).toBeUndefined();
    expect((await searchesOf(searcher)).find((s) => s.id === search!.id)!.notify_email).toBe(false);
    await client.dispose();
  });

  test("Abbestellseite ohne Token: Hinweis, kein Formular; mit JavaScript ebenso abbestellbar", async ({ page }) => {
    await page.goto("/de/unsubscribe");
    await expect(page.locator("main").getByRole("alert")).toHaveText("Dieser Link ist unvollständig. Bitte öffne den Link aus der E-Mail erneut.");
    await expect(page.getByRole("button", { name: "Abbestellen" })).toHaveCount(0);
    await page.goto("/de/unsubscribe?t=nicht-hex");
    await expect(page.locator("main").getByRole("alert")).toBeVisible();
    // Ungültiger Token im richtigen Format: dieselbe Bestätigung (kein Orakel)
    await page.goto(`/de/unsubscribe?t=${"0".repeat(64)}`);
    await page.getByRole("button", { name: "Abbestellen" }).click();
    await expect(page.getByRole("status")).toHaveText("Erledigt. Wenn der Link gültig war, bekommst du diese E-Mails nicht mehr.");
    // Sprache aus dem Formular: en
    await page.goto(`/en/unsubscribe?t=${"0".repeat(64)}`);
    await page.getByRole("button", { name: "Unsubscribe" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });

  test("axe ohne schwere Verstöße auf Konto-Seite, Speichern-Formular (Liste, Karte) und Abbestellseiten", async ({ page }) => {
    await signInAs(page.context(), searcher);
    await page.goto("/de/account/searches");
    await axe(page, "account/searches");
    await page.goto(`/de/account/searches?delete=${(await searchesOf(searcher))[0].id}`);
    await axe(page, "account/searches?delete");
    await page.goto(`/de/suche?q=${RUN}`);
    await page.getByText("Suche speichern", { exact: true }).click();
    await axe(page, "suche (Formular)");
    await page.goto(`/de/suche?view=map&q=${RUN}&bbox=13,50.5,14.8,51.4`);
    await page.getByText("Suche speichern", { exact: true }).click();
    await axe(page, "suche Karte (Formular)");
    await page.goto(unsubscribeLink || `/de/unsubscribe?t=${"0".repeat(64)}`);
    await axe(page, "unsubscribe (Token)");
    await page.goto("/de/unsubscribe");
    await axe(page, "unsubscribe (ohne Token)");
    await page.goto(`/de/unsubscribe?t=${"0".repeat(64)}`);
    await page.getByRole("button", { name: "Abbestellen" }).click();
    await expect(page.getByRole("status")).toBeVisible();
    await axe(page, "api/unsubscribe (Bestätigung)");
  });

  for (const locale of ["de", "en", "cs", "pl"] as const) {
    test(`${locale}: 360 px ohne Überbreite, keine rohen Schlüssel`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: 360, height: 800 } });
      await signInAs(context, searcher);
      const page = await context.newPage();
      const first = (await searchesOf(searcher))[0].id;
      const paths = ["/account/searches", `/account/searches?delete=${first}`, `/unsubscribe?t=${"0".repeat(64)}`, "/unsubscribe"];
      for (const p of paths) {
        await page.goto(`/${locale}${p}`);
        await noOverflow(page, `${locale}${p}`);
        expect(await page.locator("body").innerText(), `${locale}${p}`).not.toMatch(/\b(SavedSearches|Unsubscribe)\.[a-zA-Z]+/);
      }
      // Suche mit geöffnetem Formular (das längste Formular)
      const search = { de: "suche", en: "search", cs: "hledani", pl: "szukaj" }[locale];
      await page.goto(`/${locale}/${search}?q=${RUN}&kind=driven_hunt`);
      const open = { de: "Suche speichern", en: "Save search", cs: "Uložit hledání", pl: "Zapisz wyszukiwanie" }[locale];
      await page.locator("summary").filter({ hasText: open }).click();
      await expect(page.locator('input[name="filters"]')).toHaveCount(1);
      await noOverflow(page, `${locale}/${search} Formular`);
      expect(await page.locator("body").innerText()).not.toMatch(/\bSavedSearches\.[a-zA-Z]+/);
      // Bestätigungsseite nach dem POST
      await page.goto(`/${locale}/unsubscribe?t=${"0".repeat(64)}`);
      await page.locator('form[action="/api/unsubscribe"] button[type="submit"]').click();
      await expect(page.getByRole("status")).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await noOverflow(page, `${locale} api/unsubscribe`);
      await context.close();
    });
  }
});
