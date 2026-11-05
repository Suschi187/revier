import { expect, test, type Page, type Request } from "@playwright/test";
import { admin, deleteTestUsers, local } from "./cleanup";
import { createAccount, createPublicListing, signInAs, type TestAccount } from "./session";

// QA M7 Nachprüfung (docs/QA-REPORT.md „M7 – Nachprüfung“): Regressionen der Korrekturen F1 (Chat ohne Legal-Gate),
// F2 (UnreadRefresh), F3 (WebSocket schließen). Neue Funde als test.fail mit Fund-Nummer. Konten auf @test.local.

const created: string[] = [];
test.afterAll(() => deleteTestUsers(created));
test.describe.configure({ mode: "serial" });

/**
 * RSC-Abrufe (router.refresh, Navigation) einer Seite zählen, ohne Prefetches: Im Produktions-Build lädt Next.js nach
 * jedem Refresh die Link-Prefetches neu (statische Segmente, `s-maxage`, ohne Personalisierung geprüft).
 */
function countRsc(page: Page): { count: () => number; requests: Request[] } {
  const requests: Request[] = [];
  page.on("request", (request) => {
    const headers = request.headers();
    if (headers["rsc"] === "1" && headers["next-router-prefetch"] !== "1") requests.push(request);
  });
  return { count: () => requests.length, requests };
}

async function returnToTab(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });
}

async function withoutConsent<T>(account: TestAccount, run: () => Promise<T>): Promise<T> {
  const backup = (await admin().from("legal_acceptances").select("*").eq("user_id", account.id)).data ?? [];
  await admin().from("legal_acceptances").delete().eq("user_id", account.id);
  try {
    return await run();
  } finally {
    await admin().from("legal_acceptances").delete().eq("user_id", account.id);
    if (backup.length) await admin().from("legal_acceptances").insert(backup);
  }
}

async function messageCount(conversation: string): Promise<number> {
  return (await admin().from("messages").select("id", { count: "exact", head: true }).eq("conversation_id", conversation)).count ?? -1;
}

test.describe("QA M7 Nachprüfung", () => {
  test.skip(!local, "Lokale Supabase nötig");
  let owner: TestAccount;
  let interested: TestAccount;
  let listing = "";
  let conversation = "";

  test.beforeAll(async () => {
    owner = await createAccount("qa7n-owner", "Otto Nachprüfung", created);
    interested = await createAccount("qa7n-int", "Ilse Nachprüfung", created);
    listing = await createPublicListing(owner.id, "Nachprüfung Pacht");
    conversation = (await interested.client.rpc("start_conversation", { p_listing_id: listing, p_body: "Hallo Otto" })).data as string;
    await owner.client.rpc("send_message", { p_conversation_id: conversation, p_body: "Hallo Ilse" });
  });

  // ---------------------------------------------------------------------------------------------------------------
  // F1: Chat nur mit Anmeldung – was die Zustimmung verlangt, bleibt gesperrt
  // ---------------------------------------------------------------------------------------------------------------

  test("F1: Zustimmung fällt weg, während die Eingabe offen ist: Senden (mit JS) führt zur Zustimmung, keine Nachricht", async ({ page }) => {
    await signInAs(page.context(), interested);
    await page.goto(`/de/account/messages/${conversation}`);
    await expect(page.getByLabel("Deine Nachricht")).toBeVisible();
    // Erst nach dem Abo und dessen Refresh die Zustimmung entfernen: Ein späterer Refresh zeigte sonst schon den Hinweis
    await expect(page.locator('[data-realtime="subscribed"]')).toBeAttached({ timeout: 15_000 });
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);
    const before = await messageCount(conversation);
    await withoutConsent(interested, async () => {
      await page.getByLabel("Deine Nachricht").fill("Ohne Zustimmung gesendet");
      await page.getByRole("button", { name: "Senden" }).click();
      await expect(page).toHaveURL(/\/de\/welcome\?next=/);
      expect(new URL(page.url()).searchParams.get("next")).toBe(`/de/account/messages/${conversation}`);
      expect(await messageCount(conversation)).toBe(before);
      // Zustimmen führt zurück in die Unterhaltung mit Eingabe
      await page.getByRole("checkbox").check();
      await page.getByRole("button", { name: "Speichern und weiter" }).click();
      await expect(page).toHaveURL(new RegExp(`/de/account/messages/${conversation}$`));
      await expect(page.getByLabel("Deine Nachricht")).toBeVisible();
    });
  });

  test("F1: Ohne JavaScript: Senden ohne Zustimmung führt zur Zustimmung, keine Nachricht", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    await signInAs(context, interested);
    const page = await context.newPage();
    await page.goto(`/de/account/messages/${conversation}`);
    const before = await messageCount(conversation);
    await withoutConsent(interested, async () => {
      await page.getByLabel("Deine Nachricht").fill("Ohne Zustimmung, ohne JS");
      await page.getByRole("button", { name: "Senden" }).click();
      await expect(page).toHaveURL(/\/de\/welcome\?next=/);
      expect(await messageCount(conversation)).toBe(before);
    });
    await context.close();
  });

  test("F1: RPC ohne Zustimmung: send_message und start_conversation scheitern mit RV001", async () => {
    const other = await createPublicListing(owner.id, "Nachprüfung Zweite");
    await withoutConsent(interested, async () => {
      const sent = await interested.client.rpc("send_message", { p_conversation_id: conversation, p_body: "RPC ohne Zustimmung" });
      expect(sent.error?.code).toBe("RV001");
      const started = await interested.client.rpc("start_conversation", { p_listing_id: other, p_body: "RPC ohne Zustimmung" });
      expect(started.error?.code).toBe("RV001");
    });
  });

  test("F1: Hinweis-Link führt über welcome zurück in die Unterhaltung; Liste ohne Zustimmung erreichbar", async ({ page }) => {
    await signInAs(page.context(), interested);
    await withoutConsent(interested, async () => {
      const list = await page.goto("/de/account/messages");
      expect(list?.status()).toBe(200);
      expect(new URL(page.url()).pathname).toBe("/de/account/messages");
      await expect(page.getByRole("link", { name: /Otto Nachprüfung/ })).toBeVisible();
      await page.goto(`/de/account/messages/${conversation}`);
      await expect(page.getByLabel("Deine Nachricht")).toHaveCount(0);
      await page.getByRole("link", { name: "Zu den Nutzungsbedingungen" }).click();
      await expect(page).toHaveURL(/\/de\/welcome\?next=/);
      await page.getByRole("checkbox").check();
      await page.getByRole("button", { name: "Speichern und weiter" }).click();
      await expect(page).toHaveURL(new RegExp(`/de/account/messages/${conversation}$`));
      await expect(page.getByLabel("Deine Nachricht")).toBeVisible();
    });
  });

  test("F1: new/<id> mit bestehender Unterhaltung ohne Zustimmung: erst Zustimmung, dann die Unterhaltung", async ({ page }) => {
    await signInAs(page.context(), interested);
    await withoutConsent(interested, async () => {
      await page.goto(`/de/account/messages/new/${listing}`);
      await expect(page).toHaveURL(/\/de\/welcome\?next=/);
      expect(new URL(page.url()).searchParams.get("next")).toBe(`/de/account/messages/new/${listing}`);
      await page.getByRole("checkbox").check();
      await page.getByRole("button", { name: "Speichern und weiter" }).click();
      await expect(page).toHaveURL(new RegExp(`/de/account/messages/${conversation}$`));
      await expect(page.getByLabel("Deine Nachricht")).toBeVisible();
    });
  });

  test("F1: Gesperrt und ohne Zustimmung: kein Weg zur Zustimmung, sondern „kann nicht schreiben“; Blockieren geht", async ({ page }) => {
    await admin().from("profiles").update({ is_blocked: true }).eq("user_id", interested.id);
    try {
      await signInAs(page.context(), interested);
      await withoutConsent(interested, async () => {
        await page.goto(`/de/account/messages/${conversation}`);
        await expect(page.getByText("In dieser Unterhaltung kann nicht mehr geschrieben werden.")).toBeVisible();
        await expect(page.getByRole("link", { name: "Zu den Nutzungsbedingungen" })).toHaveCount(0);
        await page.getByText("Aktionen").click();
        await page.getByRole("button", { name: "Person blockieren" }).click();
        await expect(page.getByText("Du hast diese Person blockiert. Sie kann dir nicht mehr schreiben.")).toBeVisible();
      });
    } finally {
      await admin().from("profiles").update({ is_blocked: false }).eq("user_id", interested.id);
      await admin().from("blocks").delete().eq("blocker_id", interested.id);
    }
  });

  test("F1: Hinweis ohne Zustimmung in en, cs, pl übersetzt", async ({ page }) => {
    await signInAs(page.context(), interested);
    const texts = {
      en: "To write, please first accept the current terms of use.",
      cs: "Abyste mohli psát, odsouhlaste nejprve aktuální podmínky užívání.",
      pl: "Aby pisać, zaakceptuj najpierw aktualny regulamin.",
    };
    await withoutConsent(interested, async () => {
      for (const [locale, text] of Object.entries(texts)) {
        await page.goto(`/${locale}/account/messages/${conversation}`);
        await expect(page.getByText(text)).toBeVisible();
        expect(await page.getByRole("status").filter({ hasText: text }).locator("a").getAttribute("href")).toBe(
          `/${locale}/welcome?next=${encodeURIComponent(`/${locale}/account/messages/${conversation}`)}`,
        );
      }
    });
  });

  test("F1: Ohne Zustimmung läuft das Lesen live weiter (Realtime im Chat)", async ({ page }) => {
    await signInAs(page.context(), interested);
    await withoutConsent(interested, async () => {
      await page.goto(`/de/account/messages/${conversation}`);
      await expect(page.locator('[data-realtime="subscribed"]')).toBeAttached({ timeout: 15_000 });
      await owner.client.rpc("send_message", { p_conversation_id: conversation, p_body: "Live ohne Zustimmung" });
      await expect(page.getByRole("log").getByText("Live ohne Zustimmung")).toBeVisible({ timeout: 10_000 });
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  // F2: UnreadRefresh – kein Sturm, nichts für Abgemeldete, Eingaben bleiben
  // ---------------------------------------------------------------------------------------------------------------

  test("F2: Zehn Rückkehren in den Tab in kurzer Folge ergeben genau einen Abruf", async ({ page }) => {
    await signInAs(page.context(), interested);
    await page.goto("/de");
    await page.waitForLoadState("networkidle");
    const rsc = countRsc(page);
    for (let i = 0; i < 10; i++) {
      await returnToTab(page);
      await page.waitForTimeout(300);
    }
    await page.waitForTimeout(1500);
    expect(rsc.count()).toBe(1);
  });

  test("F2: Nach 30 Sekunden wieder ein Abruf, davor keiner (Uhr)", async ({ page }) => {
    await page.clock.install();
    await signInAs(page.context(), interested);
    await page.goto("/de");
    await page.waitForLoadState("networkidle");
    const rsc = countRsc(page);
    await returnToTab(page);
    await expect.poll(rsc.count).toBe(1);
    await page.clock.fastForward(20_000);
    await returnToTab(page);
    await page.waitForTimeout(1000);
    expect(rsc.count()).toBe(1);
    await page.clock.fastForward(11_000);
    await returnToTab(page);
    await expect.poll(rsc.count).toBe(2);
  });

  test("F2: Drei Tabs: je Tab höchstens ein Abruf, keine Kettenreaktion", async ({ browser }) => {
    const context = await browser.newContext();
    await signInAs(context, interested);
    const pages = await Promise.all([context.newPage(), context.newPage(), context.newPage()]);
    const counters = pages.map(countRsc);
    for (const page of pages) await page.goto("/de");
    for (const page of pages) await page.waitForLoadState("networkidle");
    const base = counters.map((c) => c.count());
    for (let round = 0; round < 3; round++) {
      for (const page of pages) {
        await page.bringToFront();
        await returnToTab(page);
      }
    }
    await pages[0].waitForTimeout(2000);
    expect(counters.map((c, i) => c.count() - base[i])).toEqual([1, 1, 1]);
    await context.close();
  });

  test("F2: Abgemeldet kein Abruf und kein Cookie", async ({ page }) => {
    await page.goto("/de");
    await page.waitForLoadState("networkidle");
    const rsc = countRsc(page);
    await returnToTab(page);
    await page.waitForTimeout(1500);
    expect(rsc.count()).toBe(0);
    expect((await page.context().cookies()).filter((c) => c.name.startsWith("sb-"))).toEqual([]);
  });

  test("F2: Unter /account/messages kein Abruf durch UnreadRefresh", async ({ page }) => {
    await signInAs(page.context(), interested);
    await page.goto("/de/account/messages");
    await expect(page.locator('[data-realtime="subscribed"]')).toBeAttached({ timeout: 15_000 });
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);
    const rsc = countRsc(page);
    await returnToTab(page);
    await page.waitForTimeout(1500);
    expect(rsc.count()).toBe(0);
  });

  test("F2: Öffentliche Detailseite: Abruf beim Fokus nicht öffentlich cachebar, danach anonym ohne Personalisierung", async ({ page, browser }) => {
    await signInAs(page.context(), interested);
    await page.goto(`/de/anzeige/${listing}`);
    await page.waitForLoadState("networkidle");
    const responses: { cache: string; vary: string }[] = [];
    page.on("response", (response) => {
      if (response.request().headers()["rsc"] === "1" && response.request().headers()["next-router-prefetch"] !== "1") {
        const h = response.headers();
        responses.push({ cache: h["cache-control"] ?? "", vary: h["vary"] ?? "" });
      }
    });
    await returnToTab(page);
    await expect.poll(() => responses.length).toBe(1);
    expect(responses[0].cache).not.toMatch(/public|s-maxage/);
    const anonymous = await browser.newContext();
    const anon = await anonymous.newPage();
    await anon.goto(`/de/anzeige/${listing}`);
    await expect(anon.getByRole("link", { name: /^Nachrichten/ })).toHaveCount(0);
    await expect(anon.getByText("Ilse Nachprüfung")).toHaveCount(0);
    await anonymous.close();
  });

  test("F2: Eingaben bleiben beim Fokus erhalten: Profil, Assistent (neu) und Bearbeiten", async ({ page }) => {
    await signInAs(page.context(), owner);
    const draft = (await admin().from("listings").insert({
      owner_id: owner.id, kind: "helper", direction: "wanted", title: "Entwurf Fokus", content_language: "de",
      region_id: (await admin().from("regions").select("id").eq("code", "DE-14628").single()).data!.id, status: "draft",
    }).select("id").single()).data!.id as string;
    const cases: { path: string; field: string; value: string }[] = [
      { path: "/de/account/profile", field: 'input[name="displayName"]', value: "Ungespeicherter Name" },
      { path: "/de/account/listings/new", field: 'input[name="title"]', value: "Ungespeicherter Titel der Anzeige" },
      { path: `/de/account/listings/${draft}/edit?step=details`, field: 'textarea[name="description"]', value: "Ungespeicherte Beschreibung mit genug Text für die Prüfung." },
    ];
    for (const { path, field, value } of cases) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const rsc = countRsc(page);
      await page.locator(field).fill(value);
      // page.goto ist ein voller Seitenaufruf: UnreadRefresh beginnt neu, die erste Rückkehr lädt sofort.
      await returnToTab(page);
      await expect.poll(rsc.count, { message: path }).toBe(1);
      await page.waitForLoadState("networkidle");
      await expect(page.locator(field), path).toHaveValue(value);
    }
  });

  // ---------------------------------------------------------------------------------------------------------------
  // F3: WebSocket schließt; Wiederbetreten des Chats baut das Abo wieder auf
  // ---------------------------------------------------------------------------------------------------------------

  function trackSockets(page: Page): { open: () => number; total: () => number } {
    const sockets: { closed: boolean }[] = [];
    page.on("websocket", (ws) => {
      if (!ws.url().includes("/realtime/")) return;
      const entry = { closed: false };
      sockets.push(entry);
      ws.on("close", () => (entry.closed = true));
    });
    return { open: () => sockets.filter((s) => !s.closed).length, total: () => sockets.length };
  }

  test("F3: Unterhaltung → öffentliche Seite → Browser-Zurück: Socket zu, dann neues Abo und Live-Nachricht", async ({ page }) => {
    await signInAs(page.context(), interested);
    const ws = trackSockets(page);
    await page.goto(`/de/account/messages/${conversation}`);
    await expect(page.locator('[data-realtime="subscribed"]')).toBeAttached({ timeout: 15_000 });
    await page.getByRole("link", { name: "Nachprüfung Pacht" }).click();
    await expect(page).toHaveURL(new RegExp(`/de/anzeige/${listing}`));
    // Der Titel-Link ist ein voller Seitenwechsel: Das alte Dokument endet (Playwright meldet dafür kein close), die
    // öffentliche Seite öffnet keine eigene WebSocket.
    const opened = ws.total();
    await page.waitForTimeout(2000);
    expect(ws.total()).toBe(opened);
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/de/account/messages/${conversation}`));
    await expect(page.locator('[data-realtime="subscribed"]')).toBeAttached({ timeout: 15_000 });
    await owner.client.rpc("send_message", { p_conversation_id: conversation, p_body: "Nach dem Zurück" });
    await expect(page.getByRole("log").getByText("Nach dem Zurück")).toBeVisible({ timeout: 10_000 });
  });

  test("F3: Liste → Unterhaltung per Klick (Client-Navigation): Abo steht, Live-Nachricht kommt", async ({ page }) => {
    await signInAs(page.context(), interested);
    const ws = trackSockets(page);
    await page.goto("/de/account/messages");
    await expect(page.locator('[data-realtime="subscribed"]')).toBeAttached({ timeout: 15_000 });
    await page.getByRole("link", { name: /Otto Nachprüfung/ }).click();
    await expect(page).toHaveURL(new RegExp(`/de/account/messages/${conversation}`));
    await expect(page.locator('[data-realtime="subscribed"]')).toBeAttached({ timeout: 15_000 });
    await owner.client.rpc("send_message", { p_conversation_id: conversation, p_body: "Nach Klick aus der Liste" });
    await expect(page.getByRole("log").getByText("Nach Klick aus der Liste")).toBeVisible({ timeout: 10_000 });
    expect(ws.open()).toBeLessThanOrEqual(1);
  });

  test("F3: Unterhaltung → „Alle Nachrichten“ → Unterhaltung: Abo jeweils wieder da", async ({ page }) => {
    await signInAs(page.context(), interested);
    await page.goto(`/de/account/messages/${conversation}`);
    await expect(page.locator('[data-realtime="subscribed"]')).toBeAttached({ timeout: 15_000 });
    await page.getByRole("link", { name: "Alle Nachrichten" }).click();
    await expect(page).toHaveURL(/\/de\/account\/messages$/);
    await expect(page.locator('[data-realtime="subscribed"]')).toBeAttached({ timeout: 15_000 });
    await owner.client.rpc("send_message", { p_conversation_id: conversation, p_body: "In der Liste live" });
    await expect(page.getByText("In der Liste live")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("link", { name: /Otto Nachprüfung/ }).click();
    await expect(page.locator('[data-realtime="subscribed"]')).toBeAttached({ timeout: 15_000 });
    await owner.client.rpc("send_message", { p_conversation_id: conversation, p_body: "Wieder im Chat live" });
    await expect(page.getByRole("log").getByText("Wieder im Chat live")).toBeVisible({ timeout: 10_000 });
  });

  test("F3: Schnelles Hin und Her zwischen Liste und Unterhaltung (ohne auf das Abo zu warten): am Ende live, eine WebSocket", async ({ page }) => {
    await signInAs(page.context(), interested);
    const ws = trackSockets(page);
    await page.goto(`/de/account/messages/${conversation}`);
    for (let i = 0; i < 5; i++) {
      await page.getByRole("link", { name: "Alle Nachrichten" }).click();
      await expect(page).toHaveURL(/\/de\/account\/messages$/);
      await page.getByRole("link", { name: /Otto Nachprüfung/ }).click();
      await expect(page).toHaveURL(new RegExp(`/de/account/messages/${conversation}`));
    }
    await expect(page.locator('[data-realtime="subscribed"]')).toBeAttached({ timeout: 15_000 });
    await owner.client.rpc("send_message", { p_conversation_id: conversation, p_body: "Nach dem Hin und Her" });
    await expect(page.getByRole("log").getByText("Nach dem Hin und Her")).toBeVisible({ timeout: 10_000 });
    await expect.poll(ws.open, { timeout: 5_000 }).toBe(1);
  });

  test("F3: Zwei Tabs: Tab A verlässt den Chat, Tab B bleibt live", async ({ browser }) => {
    const context = await browser.newContext();
    await signInAs(context, interested);
    const [a, b] = await Promise.all([context.newPage(), context.newPage()]);
    const wsA = trackSockets(a);
    for (const page of [a, b]) {
      await page.goto(`/de/account/messages/${conversation}`);
      await expect(page.locator('[data-realtime="subscribed"]')).toBeAttached({ timeout: 15_000 });
    }
    // Client-Navigation aus dem Chat (Link „Alle Nachrichten“ wäre wieder Chat): Konto-Seite über die Kopfzeile
    await a.getByRole("link", { name: "Mein Konto", exact: true }).click();
    await expect(a).toHaveURL(/\/de\/account$/);
    await expect.poll(wsA.open, { timeout: 10_000 }).toBe(0);
    await owner.client.rpc("send_message", { p_conversation_id: conversation, p_body: "Nur Tab B" });
    await expect(b.getByRole("log").getByText("Nur Tab B")).toBeVisible({ timeout: 10_000 });
    await context.close();
  });
});
