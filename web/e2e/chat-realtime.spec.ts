import { expect, test } from "@playwright/test";
import { deleteTestUsers, local } from "./cleanup";
import { createAccount, createPublicListing, signInAs, type TestAccount } from "./session";

// M7 Akzeptanz a (ADR 017): Zwei Browser-Sitzungen tauschen Nachrichten in Echtzeit. Gesendet wird erst, wenn
// das Abo steht (data-realtime="subscribed", Review H10). Dazu: Liste und „Gelesen“ ohne Neuladen.

const created: string[] = [];
test.afterAll(() => deleteTestUsers(created));
test.describe.configure({ mode: "serial" });

test.describe("Chat in Echtzeit (M7, Akzeptanz a)", () => {
  test.skip(!local, "Lokale Supabase nötig");
  let owner: TestAccount;
  let interested: TestAccount;
  let conversation = "";

  test.beforeAll(async () => {
    owner = await createAccount("rt-owner", "Rita Revier", created);
    interested = await createAccount("rt-int", "Paul Pächter", created);
    const listing = await createPublicListing(owner.id, "Echtzeit Pacht");
    const { data, error } = await interested.client.rpc("start_conversation", { p_listing_id: listing, p_body: "Erste Frage" });
    if (error) throw new Error(error.message);
    conversation = data as string;
  });

  test("Nachrichten erscheinen beim Gegenüber ohne Neuladen, in beide Richtungen", async ({ browser }) => {
    const ownerContext = await browser.newContext();
    const interestedContext = await browser.newContext();
    await signInAs(ownerContext, owner);
    await signInAs(interestedContext, interested);
    const ownerPage = await ownerContext.newPage();
    const interestedPage = await interestedContext.newPage();
    await ownerPage.goto(`/de/account/messages/${conversation}`);
    await interestedPage.goto(`/de/account/messages/${conversation}`);
    await expect(ownerPage.getByRole("main").locator('[data-realtime="subscribed"]')).toBeAttached({ timeout: 15_000 });
    await expect(interestedPage.getByRole("main").locator('[data-realtime="subscribed"]')).toBeAttached({ timeout: 15_000 });
    let ownerLoads = 0;
    ownerPage.on("load", () => ownerLoads++);

    await interestedPage.getByLabel("Deine Nachricht").fill("Ist die Pacht ab April frei?");
    await interestedPage.getByRole("button", { name: "Senden" }).click();
    await expect(ownerPage.getByRole("log").getByText("Ist die Pacht ab April frei?")).toBeVisible({ timeout: 10_000 });

    // Der Besitzer hat die Unterhaltung offen: Der Absender sieht „Gelesen“ ohne Neuladen.
    const last = interestedPage.getByRole("log").locator("li").last();
    await expect(last).toContainText("Gelesen", { timeout: 10_000 });

    await ownerPage.getByLabel("Deine Nachricht").fill("Ja, ab 1. April.");
    await ownerPage.keyboard.press("Control+Enter");
    await expect(interestedPage.getByRole("log").getByText("Ja, ab 1. April.")).toBeVisible({ timeout: 10_000 });
    expect(ownerLoads).toBe(0);

    await ownerContext.close();
    await interestedContext.close();
  });

  test("Liste und Zähler aktualisieren sich ohne Neuladen", async ({ browser }) => {
    const ownerContext = await browser.newContext();
    await signInAs(ownerContext, owner);
    const ownerPage = await ownerContext.newPage();
    await ownerPage.goto("/de/account/messages");
    await expect(ownerPage.getByRole("main").locator('[data-realtime="subscribed"]')).toBeAttached({ timeout: 15_000 });
    await expect(ownerPage.getByRole("link", { name: /Paul Pächter, 1 ungelesene/ })).toHaveCount(0);

    const { error } = await interested.client.rpc("send_message", { p_conversation_id: conversation, p_body: "Noch eine Frage zur Fläche" });
    expect(error).toBeNull();
    await expect(ownerPage.getByRole("link", { name: /Paul Pächter, 1 ungelesene Nachricht/ })).toBeVisible({ timeout: 10_000 });
    await expect(ownerPage.getByText("Noch eine Frage zur Fläche")).toBeVisible();
    await expect(ownerPage.getByRole("link", { name: "Nachrichten, 1 ungelesen" })).toBeVisible();
    await ownerContext.close();
  });

  test("Verborgener Tab markiert nicht gelesen, erst beim Sichtbarwerden", async ({ browser }) => {
    const ownerContext = await browser.newContext();
    await signInAs(ownerContext, owner);
    const ownerPage = await ownerContext.newPage();
    await ownerPage.goto(`/de/account/messages/${conversation}`);
    await expect(ownerPage.getByRole("main").locator('[data-realtime="subscribed"]')).toBeAttached({ timeout: 15_000 });
    // Den Abruf nach dem Abo abwarten, dann verbergen
    await ownerPage.waitForLoadState("networkidle");
    await ownerPage.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const { data: sent } = await interested.client.rpc("send_message", { p_conversation_id: conversation, p_body: "Im Hintergrund" });
    await ownerPage.waitForTimeout(2000);
    const { data: row } = await interested.client.from("messages").select("read_at").eq("id", sent as string).single();
    expect(row?.read_at).toBeNull();
    await ownerPage.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(ownerPage.getByRole("log").getByText("Im Hintergrund")).toBeVisible({ timeout: 10_000 });
    await expect
      .poll(async () => (await interested.client.from("messages").select("read_at").eq("id", sent as string).single()).data?.read_at, { timeout: 10_000 })
      .not.toBeNull();
    await ownerContext.close();
  });
});
