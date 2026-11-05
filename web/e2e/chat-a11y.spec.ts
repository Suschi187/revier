import { expect, test } from "@playwright/test";
import { deleteTestUsers, local } from "./cleanup";
import { createAccount, createPublicListing, signInAs, type TestAccount } from "./session";

// M7 Abschluss (ADR 017, Plan M7 Commit 9): axe ohne schwere Verstöße, 360 px ohne Überbreite, vier Sprachen ohne
// rohe Schlüssel auf allen Chat-Seiten.

const created: string[] = [];
test.afterAll(() => deleteTestUsers(created));
test.describe.configure({ mode: "serial" });

const LOCALES = [
  { locale: "de", nav: "Nachrichten", send: "Senden" },
  { locale: "en", nav: "Messages", send: "Send" },
  { locale: "cs", nav: "Zprávy", send: "Odeslat" },
  { locale: "pl", nav: "Wiadomości", send: "Wyślij" },
] as const;

test.describe("Chat: Barrierefreiheit und Sprachen (M7)", () => {
  test.skip(!local, "Lokale Supabase nötig");
  let owner: TestAccount;
  let interested: TestAccount;
  let conversation = "";
  let foreignMessage = "";
  let listing = "";

  test.beforeAll(async () => {
    owner = await createAccount("a11y-owner", "Anna Anbieterin mit einem sehr langen Namen ohne Leerzeichenumbruchmöglichkeit", created);
    interested = await createAccount("a11y-int", "Igor", created);
    listing = await createPublicListing(owner.id, "Barrierefreie Pacht");
    conversation = (await interested.client.rpc("start_conversation", { p_listing_id: listing, p_body: "Frage\nmit zwei Zeilen" })).data as string;
    foreignMessage = (await owner.client.rpc("send_message", { p_conversation_id: conversation, p_body: "x".repeat(300) })).data as string;
  });

  const paths = () => [
    "/account/messages",
    `/account/messages/${conversation}`,
    `/account/messages/${conversation}/report?message=${foreignMessage}`,
    `/account/messages/new/${listing}`,
    "/account/blocked",
  ];

  test("axe ohne schwere Verstöße auf allen Chat-Seiten", async ({ page }) => {
    const { default: AxeBuilder } = await import("@axe-core/playwright");
    await signInAs(page.context(), interested);
    for (const path of paths()) {
      await page.goto(`/de${path}`);
      const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
      expect(result.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${path} ${v.id}: ${v.nodes.length}`)).toEqual([]);
    }
  });

  for (const { locale, nav, send } of LOCALES) {
    test(`${locale}: 360 px ohne Überbreite, übersetzt, keine rohen Schlüssel`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: 360, height: 800 } });
      await signInAs(context, interested);
      const page = await context.newPage();
      for (const path of paths()) {
        await page.goto(`/${locale}${path}`);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `${locale}${path}`).toBeLessThanOrEqual(0);
        const text = await page.locator("body").innerText();
        expect(text, `${locale}${path}`).not.toMatch(/\bChat\.[a-z]+/);
      }
      await page.goto(`/${locale}/account/messages/${conversation}`);
      await expect(page.getByRole("link", { name: new RegExp(`^${nav}`) }).first()).toBeVisible();
      await expect(page.getByRole("button", { name: send, exact: true })).toBeVisible();
      await context.close();
    });
  }
});
