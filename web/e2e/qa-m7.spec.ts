import { expect, test, type Page } from "@playwright/test";
import { admin, deleteTestUsers, local } from "./cleanup";
import { createAccount, createPublicListing, signInAs, type TestAccount } from "./session";

// QA M7 Abnahme (docs/QA-REPORT.md „M7 – Abnahme“): Proben über die Web-App. F1–F3 behoben (normale Tests); bekannte Fehler sonst als test.fail mit
// Fund-Nummer. Konten auf @test.local, am Ende gelöscht.

const created: string[] = [];
test.afterAll(() => deleteTestUsers(created));
test.describe.configure({ mode: "serial" });

const XSS_NAME = `<img src=x onerror="window.__xss='name'">Xaver`;
const XSS_TITLE = `<script>window.__xss='title'</script>Pacht XSS`;
const XSS_BODY = `<svg onload="window.__xss='body'"></svg>`;

async function noXss(page: Page): Promise<void> {
  expect(await page.evaluate(() => (window as unknown as { __xss?: string }).__xss ?? null)).toBeNull();
  await expect(page.locator("main img[src='x'], main svg[onload], main script:not([src]):not([nonce])")).toHaveCount(0);
}

test.describe("QA M7: Web-Proben", () => {
  test.skip(!local, "Lokale Supabase nötig");
  let owner: TestAccount;
  let interested: TestAccount;
  let evil: TestAccount;
  let listing = "";
  let conversation = "";
  let evilConversation = "";
  let ownerMessage = "";
  let evilMessage = "";
  let gone = "";

  test.beforeAll(async () => {
    owner = await createAccount("qa7w-owner", "Olga Ortlieb", created);
    interested = await createAccount("qa7w-int", "Ingo Imhof", created);
    evil = await createAccount("qa7w-evil", XSS_NAME, created);
    listing = await createPublicListing(owner.id, XSS_TITLE);
    conversation = (await interested.client.rpc("start_conversation", { p_listing_id: listing, p_body: "Hallo, noch frei?" })).data as string;
    ownerMessage = (await owner.client.rpc("send_message", { p_conversation_id: conversation, p_body: "Ja, noch frei." })).data as string;
    evilConversation = (await evil.client.rpc("start_conversation", { p_listing_id: listing, p_body: XSS_BODY })).data as string;
    evilMessage = (await admin().from("messages").select("id").eq("conversation_id", evilConversation).single()).data!.id as string;
    // Einmal öffentliche, jetzt pausierte Anzeige: Detail und „Nachricht schreiben“ antworten 410
    gone = await createPublicListing(owner.id, "Früher öffentlich");
    await admin().from("listings").update({ status: "paused" }).eq("id", gone);
  });

  test("Header: Nonce-CSP, noindex und private, no-store auf allen Chat-Routen", async ({ page }) => {
    await signInAs(page.context(), interested);
    const paths = [
      "/de/account/messages",
      `/de/account/messages/${conversation}`,
      `/de/account/messages/${conversation}/report?message=${ownerMessage}`,
      `/de/account/messages/new/${listing}`,
      "/de/account/blocked",
      `/de/account/messages/${crypto.randomUUID()}`,
    ];
    for (const path of paths) {
      const response = await page.request.get(path, { maxRedirects: 0 });
      const headers = response.headers();
      // new/<id> mit bestehender Unterhaltung leitet um; die Umleitung selbst trägt die Header ebenfalls
      expect(headers["content-security-policy"], path).toMatch(/script-src 'nonce-[^']+' 'strict-dynamic'/);
      expect(headers["x-robots-tag"], path).toContain("noindex");
      expect(headers["cache-control"], path).toContain("no-store");
    }
  });

  test("Proxy: 410 für eine früher öffentliche Anzeige, 404 für unbekannte und Großbuchstaben-IDs und Unterpfade", async ({ page }) => {
    await signInAs(page.context(), interested);
    const goneResponse = await page.request.get(`/de/account/messages/new/${gone}`, { maxRedirects: 0 });
    expect(goneResponse.status()).toBe(410);
    expect(goneResponse.headers()["x-robots-tag"]).toContain("noindex");
    expect(goneResponse.headers()["cache-control"]).toContain("no-store");
    const missing = await page.request.get(`/de/account/messages/new/${crypto.randomUUID()}`, { maxRedirects: 0 });
    expect(missing.status()).toBe(404);
    expect(missing.headers()["x-robots-tag"]).toContain("noindex");
    expect((await page.request.get(`/de/account/messages/new/${listing.toUpperCase()}`, { maxRedirects: 0 })).status()).toBe(404);
    expect((await page.request.get(`/de/account/messages/${conversation}/foo`, { maxRedirects: 0 })).status()).toBe(404);
    expect((await page.request.get(`/de/account/messages/new`, { maxRedirects: 0 })).status()).toBe(404);
    // Abgemeldet: Login mit Rücksprung auf genau diesen Pfad, ohne Statusprüfung vorab (kein Orakel ohne Sitzung)
    const anonymous = await page.context().browser()!.newContext();
    const login = await anonymous.request.get(`/de/account/messages/new/${gone}`, { maxRedirects: 0 });
    expect(login.status()).toBe(307);
    expect(new URL(login.headers().location, "http://localhost:3000").searchParams.get("next")).toBe(`/de/account/messages/new/${gone}`);
    await anonymous.close();
  });

  test("404 für unbekannte Anzeige auf new/<id>: auch private, no-store", async ({ page }) => {
    await signInAs(page.context(), interested);
    const missing = await page.request.get(`/de/account/messages/new/${crypto.randomUUID()}`, { maxRedirects: 0 });
    expect(missing.status()).toBe(404);
    expect(missing.headers()["cache-control"] ?? "").toContain("no-store");
  });

  test("Öffentliche Detailseite: Personalisierung nur im dynamischen Teil, nie im Dokument eines anderen", async ({ browser }) => {
    // Besitzer sieht seinen Hinweis (seit M5 per Sitzung), Interessent den Link; danach anonym: nur der Login-Link.
    const ownerContext = await browser.newContext();
    await signInAs(ownerContext, owner);
    const ownerPage = await ownerContext.newPage();
    await ownerPage.goto(`/de/anzeige/${listing}`);
    await expect(ownerPage.getByText("Das ist deine Anzeige.")).toBeVisible();
    await ownerContext.close();
    const intContext = await browser.newContext();
    await signInAs(intContext, interested);
    const intPage = await intContext.newPage();
    await intPage.goto(`/de/anzeige/${listing}`);
    await expect(intPage.locator(`a[href="/de/account/messages/new/${listing}"]`)).toHaveText("Nachricht schreiben");
    await intContext.close();
    const anonymous = await browser.newContext();
    const anonPage = await anonymous.newPage();
    const response = await anonPage.goto(`/de/anzeige/${listing}`);
    await expect(anonPage.locator(`a[href="/de/account/messages/new/${listing}"]`)).toHaveText("Anbieter kontaktieren (Anmeldung nötig)");
    const html = await anonPage.content();
    expect(html).not.toContain("Ingo Imhof");
    // Der Satz selbst steht in den mitgeschickten Übersetzungen; sichtbar sein darf er nicht.
    await expect(anonPage.getByText("Das ist deine Anzeige.")).toHaveCount(0);
    expect(html).not.toMatch(/Nachrichten, \d+ ungelesen/);
    expect(response!.headers()["set-cookie"] ?? "").toBe("");
    await anonymous.close();
  });

  test("XSS: Anzeigename, Anzeigentitel und Nachricht bleiben Text auf Liste, Chat, Melden, Neu und Blockiert", async ({ page }) => {
    await signInAs(page.context(), owner);
    await page.goto("/de/account/messages");
    await expect(page.getByText("Xaver").first()).toBeVisible();
    await noXss(page);
    await page.goto(`/de/account/messages/${evilConversation}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(XSS_NAME);
    await expect(page.getByRole("log").getByText(XSS_BODY)).toBeVisible();
    await noXss(page);
    await page.goto(`/de/account/messages/${evilConversation}/report?message=${evilMessage}`);
    await expect(page.locator("blockquote")).toHaveText(XSS_BODY);
    await noXss(page);
    await signInAs(page.context(), interested);
    await page.goto(`/de/account/messages/${conversation}`);
    await expect(page.getByText(XSS_TITLE)).toBeVisible();
    await noXss(page);
    // Blockiert-Liste mit dem XSS-Namen (Owner blockiert evil per RPC, danach wieder entsperrt)
    await owner.client.rpc("block_in_conversation", { p_conversation_id: evilConversation });
    await signInAs(page.context(), owner);
    await page.goto("/de/account/blocked");
    await expect(page.getByText(XSS_NAME)).toBeVisible();
    await noXss(page);
    await owner.client.rpc("unblock_in_conversation", { p_conversation_id: evilConversation });
  });

  test("Melden ohne JavaScript, mit XSS in der Notiz; Fehlercodes in der URL werden nicht gespiegelt", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    await signInAs(context, interested);
    const page = await context.newPage();
    await page.goto(`/de/account/messages/${conversation}/report?message=${ownerMessage}`);
    await page.getByLabel("Betrug oder Vorkasse-Masche").check();
    await page.locator("#report-note").fill(`<img src=x onerror="window.__xss='note'">`);
    await page.getByRole("button", { name: "Meldung senden" }).click();
    await expect(page).toHaveURL(new RegExp(`/de/account/messages/${conversation}\\?notice=reported`));
    const { data } = await admin().from("reports").select("note").eq("target_id", ownerMessage).single();
    expect(data?.note).toBe(`<img src=x onerror="window.__xss='note'">`);
    // Beliebige Werte in error/notice: kein Spiegeln, kein roher Schlüssel
    await page.goto(`/de/account/messages/${conversation}?error=%3Cb%3Ex%3C/b%3E&notice=%3Cb%3Ey%3C/b%3E`);
    expect(await page.content()).not.toContain("<b>x</b>");
    expect(await page.content()).not.toContain("<b>y</b>");
    await expect(page.locator("#composer-error")).toHaveCount(0);
    await context.close();
  });

  test("Ohne JavaScript: Blockieren und Aufheben aus der Unterhaltung", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    await signInAs(context, interested);
    const page = await context.newPage();
    await page.goto(`/de/account/messages/${conversation}`);
    await page.getByText("Aktionen").click();
    await page.getByRole("button", { name: "Person blockieren" }).click();
    await expect(page.getByText("Du hast diese Person blockiert. Sie kann dir nicht mehr schreiben.")).toBeVisible();
    await expect(page.getByLabel("Deine Nachricht")).toHaveCount(0);
    await page.getByRole("button", { name: "Blockierung aufheben" }).click();
    await expect(page.getByText("Du hast die Blockierung aufgehoben.")).toBeVisible();
    await expect(page.getByLabel("Deine Nachricht")).toBeVisible();
    await context.close();
  });

  test("Tastatur: Aktionen-Menü, Blockieren und Aufheben nur mit der Tastatur; Zähler mit aria-label", async ({ page }) => {
    await signInAs(page.context(), interested);
    // Ungelesene Nachricht für den Zähler
    await owner.client.rpc("send_message", { p_conversation_id: conversation, p_body: "Neue Nachricht für den Zähler" });
    await page.goto("/de");
    await expect(page.getByRole("link", { name: "Nachrichten, 1 ungelesen" })).toBeVisible();
    await page.goto(`/de/account/messages/${conversation}`);
    const summary = page.locator("summary", { hasText: "Aktionen" });
    await summary.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Person blockieren" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Du hast diese Person blockiert. Sie kann dir nicht mehr schreiben.")).toBeVisible();
    await page.getByRole("button", { name: "Blockierung aufheben" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Du hast die Blockierung aufgehoben.")).toBeVisible();
  });

  test("Realtime: ein Ereignis ergibt wenige Abrufe und keine Schleife", async ({ browser }) => {
    const context = await browser.newContext();
    await signInAs(context, owner);
    const page = await context.newPage();
    await page.goto(`/de/account/messages/${conversation}`);
    await expect(page.getByRole("main").locator('[data-realtime="subscribed"]')).toBeAttached({ timeout: 15_000 });
    await page.waitForTimeout(1500);
    let rsc = 0;
    page.on("request", (request) => {
      // Ohne Prefetches (Produktions-Build lädt sie nach jedem Refresh neu; QA M7 Nachprüfung)
      if ((request.headers()["rsc"] === "1" || request.url().includes("_rsc=")) && request.headers()["next-router-prefetch"] !== "1") rsc++;
    });
    await interested.client.rpc("send_message", { p_conversation_id: conversation, p_body: "Schleifentest" });
    await expect(page.getByRole("log").getByText("Schleifentest")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(4000);
    const settled = rsc;
    await page.waitForTimeout(4000);
    expect(rsc).toBe(settled);
    expect(settled).toBeLessThanOrEqual(3);
    await context.close();
  });

  test("Realtime: nach Verbindungsabbruch kommt die verpasste Nachricht ohne Neuladen", async ({ browser }) => {
    // Abbruch per routeWebSocket (setOffline trennt bestehende WebSockets in Chromium nicht): Verbindung schließen,
    // Wiederverbinden zunächst blockieren, in der Lücke senden, dann freigeben. Nach SUBSCRIBED lädt die Seite nach.
    test.setTimeout(120_000);
    const context = await browser.newContext();
    await signInAs(context, owner);
    const page = await context.newPage();
    let blocked = false;
    let connections = 0;
    const open: { close: () => Promise<void> }[] = [];
    await page.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => {
      connections++;
      open.push({ close: () => ws.close({ code: 4000, reason: "qa" }) });
      if (!blocked) ws.connectToServer();
    });
    await page.goto(`/de/account/messages/${conversation}`);
    await expect(page.getByRole("main").locator('[data-realtime="subscribed"]')).toBeAttached({ timeout: 15_000 });
    let loads = 0;
    page.on("load", () => loads++);
    blocked = true;
    for (const c of open.splice(0)) await c.close();
    await expect(page.getByRole("main").locator('[data-realtime="offline"]')).toBeAttached({ timeout: 30_000 });
    // Ein Abruf direkt nach dem Abbruch kann noch laufen; erst danach in der Lücke senden.
    await page.waitForTimeout(3000);
    await interested.client.rpc("send_message", { p_conversation_id: conversation, p_body: "Während der Trennung gesendet" });
    await page.waitForTimeout(1500);
    await expect(page.getByRole("log").getByText("Während der Trennung gesendet")).toHaveCount(0);
    blocked = false;
    for (const c of open.splice(0)) await c.close();
    await expect(page.getByRole("log").getByText("Während der Trennung gesendet")).toBeVisible({ timeout: 60_000 });
    expect(connections).toBeGreaterThan(2);
    expect(loads).toBe(0);
    await context.close();
  });

  test("Schlägt der Abruf nach einem Ereignis einmal fehl, erscheint die Nachricht trotzdem", async ({ browser }) => {
    const context = await browser.newContext();
    await signInAs(context, owner);
    const page = await context.newPage();
    await page.goto(`/de/account/messages/${conversation}`);
    await expect(page.getByRole("main").locator('[data-realtime="subscribed"]')).toBeAttached({ timeout: 15_000 });
    await page.waitForTimeout(1500);
    // Genau einen RSC-Abruf scheitern lassen (kurzer Netzfehler, 502 vom Proxy o. Ä.)
    let failed = 0;
    await page.route(/.*/, async (route) => {
      const request = route.request();
      if (failed === 0 && (request.headers()["rsc"] === "1" || request.url().includes("_rsc="))) {
        failed++;
        return route.abort("connectionfailed");
      }
      return route.fallback();
    });
    await interested.client.rpc("send_message", { p_conversation_id: conversation, p_body: "Nach gescheitertem Abruf" });
    await expect.poll(() => failed, { timeout: 10_000 }).toBe(1);
    await expect(page.getByRole("log").getByText("Nach gescheitertem Abruf")).toBeVisible({ timeout: 20_000 });
    await context.close();
  });

  test("Öffentliche Seiten öffnen keine Realtime-Verbindung (A13)", async ({ browser }) => {
    const context = await browser.newContext();
    await signInAs(context, owner);
    const page = await context.newPage();
    let sockets = 0;
    page.on("websocket", (ws) => {
      if (ws.url().includes("/realtime/")) sockets++;
    });
    await page.goto("/de");
    await page.goto("/de/account");
    await page.waitForTimeout(2000);
    expect(sockets).toBe(0);
    await context.close();
  });

  test("F2 (behoben): Zähler außerhalb des Chats wird beim Fokus neu gelesen (A13)", async ({ browser }) => {
    const context = await browser.newContext();
    await signInAs(context, interested);
    const page = await context.newPage();
    await owner.client.rpc("send_message", { p_conversation_id: conversation, p_body: "Fokus 1" });
    await page.goto("/de");
    const before = await page.getByRole("link", { name: /^Nachrichten/ }).first().getAttribute("aria-label");
    await owner.client.rpc("send_message", { p_conversation_id: conversation, p_body: "Fokus 2" });
    await page.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    });
    await expect.poll(async () => page.getByRole("link", { name: /^Nachrichten/ }).first().getAttribute("aria-label"), { timeout: 5000 }).not.toBe(before);
    await context.close();
  });

  test("Gesperrtes Konto (mit Zustimmung): Unterhaltung öffnen, blockieren und melden geht, schreiben nicht", async ({ page }) => {
    await admin().from("profiles").update({ is_blocked: true }).eq("user_id", interested.id);
    try {
      await signInAs(page.context(), interested);
      await page.goto(`/de/account/messages/${conversation}`);
      await expect(page.getByText("In dieser Unterhaltung kann nicht mehr geschrieben werden.")).toBeVisible();
      await expect(page.getByLabel("Deine Nachricht")).toHaveCount(0);
      await page.getByText("Aktionen").click();
      await page.getByRole("button", { name: "Person blockieren" }).click();
      await expect(page.getByText("Du hast diese Person blockiert. Sie kann dir nicht mehr schreiben.")).toBeVisible();
      await page.goto(`/de/account/messages/${conversation}/report?message=${ownerMessage}`);
      await page.getByLabel("Belästigung").check().catch(async () => page.locator('input[name="reason"]').first().check());
      await page.getByRole("button", { name: "Meldung senden" }).click();
      await expect(page).toHaveURL(/notice=reported/);
    } finally {
      await admin().from("profiles").update({ is_blocked: false }).eq("user_id", interested.id);
      await admin().from("blocks").delete().eq("blocker_id", interested.id);
    }
  });

  test("F1 (behoben): Ohne aktuelle Zustimmung: Unterhaltung öffnen und blockieren (ADR 017: ohne Legal-Gate)", async ({ page }) => {
    // Neue Version der Rechtstexte simuliert: Zustimmungen dieses Testkontos entfernen
    const backup = (await admin().from("legal_acceptances").select("*").eq("user_id", owner.id)).data ?? [];
    await admin().from("legal_acceptances").delete().eq("user_id", owner.id);
    try {
      await signInAs(page.context(), owner);
      const response = await page.goto(`/de/account/messages/${evilConversation}`);
      expect(new URL(page.url()).pathname).toBe(`/de/account/messages/${evilConversation}`);
      expect(response?.status()).toBe(200);
      await page.getByText("Aktionen").click();
      await page.getByRole("button", { name: "Person blockieren" }).click();
      await expect(page.getByText("Du hast diese Person blockiert. Sie kann dir nicht mehr schreiben.")).toBeVisible();
    } finally {
      if (backup.length) await admin().from("legal_acceptances").insert(backup);
      await admin().from("blocks").delete().eq("blocker_id", owner.id);
    }
  });

  test("Ohne aktuelle Zustimmung: Melden per Direktlink und die Liste blockierter Personen bleiben erreichbar", async ({ page }) => {
    const backup = (await admin().from("legal_acceptances").select("*").eq("user_id", owner.id)).data ?? [];
    await admin().from("legal_acceptances").delete().eq("user_id", owner.id);
    try {
      await signInAs(page.context(), owner);
      // F1 behoben: Die Unterhaltung bleibt erreichbar, statt der Eingabe der Weg zur Zustimmung
      await page.goto(`/de/account/messages/${evilConversation}`);
      expect(new URL(page.url()).pathname).toBe(`/de/account/messages/${evilConversation}`);
      await expect(page.getByText(/stimme bitte zuerst den aktuellen Nutzungsbedingungen zu/)).toBeVisible();
      await expect(page.getByLabel("Deine Nachricht")).toHaveCount(0);
      await page.goto(`/de/account/messages/${evilConversation}/report?message=${evilMessage}`);
      expect(new URL(page.url()).pathname).toBe(`/de/account/messages/${evilConversation}/report`);
      await page.locator('input[name="reason"]').first().check();
      await page.getByRole("button", { name: "Meldung senden" }).click();
      // F1 behoben: zurück in die Unterhaltung mit Bestätigung
      await expect(page).toHaveURL(/notice=reported/);
      await expect(page.getByText("Danke. Deine Meldung ist bei der Moderation eingegangen.")).toBeVisible();
      await expect.poll(async () => (await admin().from("reports").select("id", { count: "exact", head: true }).eq("target_id", evilMessage)).count).toBe(1);
      await page.goto("/de/account/blocked");
      expect(new URL(page.url()).pathname).toBe("/de/account/blocked");
    } finally {
      if (backup.length) await admin().from("legal_acceptances").insert(backup);
    }
  });

  test("Onboarding-Rücksprung: Ohne Zustimmung über welcome zurück zu new/<id>", async ({ page }) => {
    const fresh = await createAccount("qa7w-fresh", "Fritz Frisch", created);
    await admin().from("legal_acceptances").delete().eq("user_id", fresh.id);
    const other = await createPublicListing(interested.id, "Rücksprung Pacht");
    await signInAs(page.context(), fresh);
    await page.goto(`/de/account/messages/new/${other}`);
    await expect(page).toHaveURL(/\/de\/welcome\?next=/);
    expect(new URL(page.url()).searchParams.get("next")).toBe(`/de/account/messages/new/${other}`);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Speichern und weiter" }).click();
    await expect(page).toHaveURL(new RegExp(`/de/account/messages/new/${other}$`));
    await expect(page.getByLabel("Deine Nachricht")).toBeVisible();
  });
  test("Abmelden verlässt den Kanal (phx_leave)", async ({ browser }) => {
    // Abmelden widerruft die Sitzung: eigenes Konto, damit die übrigen Proben angemeldet bleiben.
    const leaver = await createAccount("qa7w-leave", "Lea Abmeldung", created);
    const own = (await leaver.client.rpc("start_conversation", { p_listing_id: listing, p_body: "Abmeldetest" })).data as string;
    const context = await browser.newContext();
    await signInAs(context, leaver);
    const page = await context.newPage();
    const frames: string[] = [];
    page.on("websocket", (ws) => {
      if (!ws.url().includes("/realtime/")) return;
      ws.on("framesent", (frame) => frames.push(String(frame.payload)));
    });
    await page.goto(`/de/account/messages/${own}`);
    await expect(page.getByRole("main").locator('[data-realtime="subscribed"]')).toBeAttached({ timeout: 15_000 });
    await page.getByRole("button", { name: "Abmelden" }).click();
    await expect(page).toHaveURL(/\/de$/);
    await expect.poll(() => frames.some((f) => f.includes("phx_leave") && f.includes(`user:${leaver.id}`)), { timeout: 10_000 }).toBe(true);
    await context.close();
  });

  test("F3 (behoben): Nach Abmelden oder Verlassen des Chats schließt die WebSocket (A13)", async ({ browser }) => {
    // Abmelden widerruft die Sitzung: eigenes Konto, damit die übrigen Proben angemeldet bleiben.
    const leaver = await createAccount("qa7w-leave", "Lea Abmeldung", created);
    const own = (await leaver.client.rpc("start_conversation", { p_listing_id: listing, p_body: "Abmeldetest" })).data as string;
    const context = await browser.newContext();
    await signInAs(context, leaver);
    const page = await context.newPage();
    const sockets: { closed: boolean }[] = [];
    page.on("websocket", (ws) => {
      if (!ws.url().includes("/realtime/")) return;
      const entry = { closed: false };
      sockets.push(entry);
      ws.on("close", () => (entry.closed = true));
    });
    await page.goto(`/de/account/messages/${own}`);
    await expect(page.getByRole("main").locator('[data-realtime="subscribed"]')).toBeAttached({ timeout: 15_000 });
    await page.getByRole("button", { name: "Abmelden" }).click();
    await expect(page).toHaveURL(/\/de$/);
    await expect.poll(() => sockets.length > 0 && sockets.every((s) => s.closed), { timeout: 40_000 }).toBe(true);
    await context.close();
  });

});
