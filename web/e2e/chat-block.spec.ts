import { expect, test } from "@playwright/test";
import { admin, deleteTestUsers, local } from "./cleanup";
import { createAccount, createPublicListing, signInAs, type TestAccount } from "./session";

// M7 Akzeptanz b (ADR 017): Ein blockierter Nutzer kann nicht mehr schreiben, in beide Richtungen, auch per API.
// Dazu Liste blockierter Personen, Entsperren, Melden aus dem Chat mit Kopie, Hinweise vor dem Senden.

const created: string[] = [];
test.afterAll(() => deleteTestUsers(created));
test.describe.configure({ mode: "serial" });

test.describe("Blockieren und Melden im Chat (M7, Akzeptanz b)", () => {
  test.skip(!local, "Lokale Supabase nötig");
  let owner: TestAccount;
  let interested: TestAccount;
  let conversation = "";
  let ownerMessage = "";

  test.beforeAll(async () => {
    owner = await createAccount("bl-owner", "Berta Besitz", created);
    interested = await createAccount("bl-int", "Ingo Interesse", created);
    const listing = await createPublicListing(owner.id, "Blockieren Pacht");
    conversation = (await interested.client.rpc("start_conversation", { p_listing_id: listing, p_body: "Hallo, noch frei?" })).data as string;
    ownerMessage = (await owner.client.rpc("send_message", { p_conversation_id: conversation, p_body: "Zahle bitte vorab 500 €" })).data as string;
  });

  test("Akzeptanz b: Nach dem Blockieren schreibt niemand mehr, auch nicht per API", async ({ browser }) => {
    // Ohne JavaScript: Menü als <details>, Blockieren als Formular
    const ownerContext = await browser.newContext({ javaScriptEnabled: false });
    await signInAs(ownerContext, owner);
    const ownerPage = await ownerContext.newPage();
    await ownerPage.goto(`/de/account/messages/${conversation}`);
    await ownerPage.getByText("Aktionen").click();
    await ownerPage.getByRole("button", { name: "Person blockieren" }).click();
    await expect(ownerPage.getByText("Du hast diese Person blockiert. Sie kann dir nicht mehr schreiben.")).toBeVisible();
    await expect(ownerPage.getByText("Du hast diese Person blockiert.", { exact: true })).toBeVisible();
    await expect(ownerPage.getByLabel("Deine Nachricht")).toHaveCount(0);

    const interestedContext = await browser.newContext();
    await signInAs(interestedContext, interested);
    const interestedPage = await interestedContext.newPage();
    await interestedPage.goto(`/de/account/messages/${conversation}`);
    await expect(interestedPage.getByText("In dieser Unterhaltung kann nicht mehr geschrieben werden.")).toBeVisible();
    await expect(interestedPage.getByLabel("Deine Nachricht")).toHaveCount(0);
    // Kein Hinweis darauf, wer blockiert hat
    await expect(interestedPage.getByText(/blockiert/)).toHaveCount(0);

    for (const account of [interested, owner]) {
      const { error } = await account.client.rpc("send_message", { p_conversation_id: conversation, p_body: "Trotzdem?" });
      expect(error?.code).toBe("42501");
    }
    await ownerContext.close();
    await interestedContext.close();
  });

  test("Liste blockierter Personen und Entsperren", async ({ page }) => {
    await signInAs(page.context(), owner);
    await page.goto("/de/account");
    await page.getByRole("link", { name: "Blockierte Personen" }).click();
    const row = page.getByRole("listitem").filter({ hasText: "Ingo Interesse" });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Blockierung aufheben" }).click();
    await expect(page.getByText("Du hast die Blockierung aufgehoben.")).toBeVisible();
    await expect(page.getByText("Du hast niemanden blockiert.")).toBeVisible();
    const { error } = await interested.client.rpc("send_message", { p_conversation_id: conversation, p_body: "Wieder möglich" });
    expect(error).toBeNull();
  });

  test("Nachricht melden: Grund, Hinweis, Kopie für die Moderation", async ({ page }) => {
    await signInAs(page.context(), interested);
    await page.goto(`/de/account/messages/${conversation}`);
    const message = page.getByRole("log").locator("li").filter({ hasText: "Zahle bitte vorab 500 €" });
    await message.getByRole("link", { name: "Nachricht melden" }).click();
    await expect(page.getByRole("heading", { name: "Nachricht melden" })).toBeVisible();
    await expect(page.locator("blockquote")).toHaveText("Zahle bitte vorab 500 €");
    await page.getByLabel("Betrug oder Vorkasse-Masche").check();
    await page.getByLabel("Hinweis (optional)").fill("Will Vorkasse");
    await page.getByRole("button", { name: "Meldung senden" }).click();
    await expect(page.getByText("Danke. Deine Meldung ist bei der Moderation eingegangen.")).toBeVisible();
    const { data } = await admin().from("reports").select("reason, note, target_type").eq("target_id", ownerMessage).single();
    expect(data).toEqual({ reason: "scam", note: "Will Vorkasse", target_type: "message" });

    // Eigene Nachrichten haben keinen Melden-Link
    const own = page.getByRole("log").locator("li").filter({ hasText: "Hallo, noch frei?" });
    await expect(own.getByRole("link", { name: "Nachricht melden" })).toHaveCount(0);
    // Profil melden
    await page.getByText("Aktionen").click();
    await page.getByRole("link", { name: "Profil melden" }).click();
    await page.getByLabel("Belästigung oder Beleidigung").check();
    await page.getByRole("button", { name: "Meldung senden" }).click();
    await expect(page.getByText("Danke. Deine Meldung ist bei der Moderation eingegangen.")).toBeVisible();
  });

  test("Hinweise vor dem Senden: Kontaktdaten für alle, Lage nur für den Besitzer", async ({ browser }) => {
    const interestedContext = await browser.newContext();
    await signInAs(interestedContext, interested);
    const page = await interestedContext.newPage();
    await page.goto(`/de/account/messages/${conversation}`);
    const contact = page.getByText(/Deine Nachricht enthält Kontaktdaten/);
    const location = page.getByText(/genaue Lage zu enthalten/);
    await page.getByLabel("Deine Nachricht").fill("Ruf an: 0171 2345678");
    await expect(contact).toBeVisible();
    await page.getByLabel("Deine Nachricht").fill("Treffpunkt 50.9512, 13.9481");
    await expect(contact).toHaveCount(0);
    await expect(location).toHaveCount(0);
    await interestedContext.close();

    const ownerContext = await browser.newContext();
    await signInAs(ownerContext, owner);
    const ownerPage = await ownerContext.newPage();
    await ownerPage.goto(`/de/account/messages/${conversation}`);
    await ownerPage.getByLabel("Deine Nachricht").fill("Treffpunkt 50.9512, 13.9481");
    await expect(ownerPage.getByText(/genaue Lage zu enthalten/)).toBeVisible();
    // Senden bleibt möglich
    await ownerPage.getByRole("button", { name: "Senden" }).click();
    await expect(ownerPage.getByRole("log").getByText("Treffpunkt 50.9512, 13.9481")).toBeVisible();
    await ownerContext.close();
  });
});
