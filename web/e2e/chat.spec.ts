import { expect, test } from "@playwright/test";
import { deleteTestUsers, local } from "./cleanup";
import { createAccount, createPublicListing, signInAs, type TestAccount } from "./session";

// M7 Chat (ADR 017): Kontakt aus dem Detail mit Login-Rücksprung, Senden mit und ohne JavaScript, Liste mit
// Zähler, Gelesen, gleiche Antwort für fremde und unbekannte Unterhaltungen, Status 404/410, Nonce-CSP, Text als Text.

const created: string[] = [];
test.afterAll(() => deleteTestUsers(created));
test.describe.configure({ mode: "serial" });

test.describe("Chat (M7)", () => {
  test.skip(!local, "Lokale Supabase nötig");
  let owner: TestAccount;
  let interested: TestAccount;
  let stranger: TestAccount;
  let listing = "";
  let paused = "";
  let conversation = "";

  test.beforeAll(async () => {
    owner = await createAccount("chat-owner", "Olga Anbieterin", created);
    interested = await createAccount("chat-int", "Ingo Interessent", created);
    stranger = await createAccount("chat-fremd", "Fritz Fremd", created);
    listing = await createPublicListing(owner.id, "Chat Begehungsschein");
    paused = await createPublicListing(owner.id, "Chat pausiert", "paused");
  });

  test("Kontakt aus dem Detail: abgemeldet zum Login mit Rücksprung, dann erste Nachricht", async ({ page }) => {
    await page.goto(`/de/anzeige/${listing}`);
    await page.getByRole("link", { name: "Anbieter kontaktieren (Anmeldung nötig)" }).click();
    await expect(page).toHaveURL(new RegExp(`/de/login\\?next=${encodeURIComponent(`/de/account/messages/new/${listing}`)}`));

    await signInAs(page.context(), interested);
    await page.goto(`/de/anzeige/${listing}`);
    await page.getByRole("link", { name: "Nachricht schreiben" }).click();
    await expect(page.getByRole("heading", { name: "Nachricht zu dieser Anzeige" })).toBeVisible();
    await expect(page.getByText(/Zahle nie im Voraus/)).toBeVisible();
    await page.getByLabel("Deine Nachricht").fill("Guten Tag,\nist der Begehungsschein noch frei?");
    await page.getByRole("button", { name: "Senden" }).click();
    await expect(page).toHaveURL(/\/de\/account\/messages\/[0-9a-f-]{36}#latest$/);
    conversation = /messages\/([0-9a-f-]{36})/.exec(page.url())![1];
    await expect(page.getByRole("log").getByText("ist der Begehungsschein noch frei?")).toBeVisible();
    await expect(page.getByRole("log").getByText("Gesendet")).toBeVisible();

    // Zweiter Besuch der Kontaktseite führt in die bestehende Unterhaltung
    await page.goto(`/de/account/messages/new/${listing}`);
    await expect(page).toHaveURL(new RegExp(`/de/account/messages/${conversation}$`));
  });

  test("Besitzer: Zähler in der Navigation und Liste, Öffnen markiert gelesen, Absender sieht „Gelesen“", async ({ page }) => {
    await signInAs(page.context(), owner);
    await page.goto("/de");
    await expect(page.getByRole("link", { name: "Nachrichten, 1 ungelesen" })).toBeVisible();
    await page.goto("/de/account/messages");
    const item = page.getByRole("link", { name: /Ingo Interessent, 1 ungelesene Nachricht/ });
    await expect(item).toContainText("Zu deiner Anzeige: Chat Begehungsschein");
    await item.click();
    await expect(page.getByRole("heading", { name: "Ingo Interessent" })).toBeVisible();
    await page.goto("/de");
    await expect(page.getByRole("link", { name: "Nachrichten", exact: true })).toBeVisible();

    await signInAs(page.context(), interested);
    await page.goto(`/de/account/messages/${conversation}`);
    await expect(page.getByRole("log").getByText("Gelesen")).toBeVisible();
  });

  test("Ohne JavaScript: Senden per Formular; Fehler als Code in der URL, nie der Text", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    await signInAs(context, owner);
    const page = await context.newPage();
    await page.goto(`/de/account/messages/${conversation}`);
    await page.getByLabel("Deine Nachricht").fill("Ja, noch frei. Wann passt es Ihnen?");
    await page.getByRole("button", { name: "Senden" }).click();
    await expect(page.getByRole("log").getByText("Ja, noch frei. Wann passt es Ihnen?")).toBeVisible();
    const invalid = `Geheim ${String.fromCharCode(0x202e)}`;
    await page.getByLabel("Deine Nachricht").fill(invalid);
    await page.getByRole("button", { name: "Senden" }).click();
    await expect(page).toHaveURL(new RegExp(`/de/account/messages/${conversation}\\?error=body(#latest)?$`));
    await expect(page.locator("#composer-error")).toHaveText("Die Nachricht ist leer, zu lang oder enthält unzulässige Zeichen.");
    expect(page.url()).not.toContain("Geheim");
    await context.close();
  });

  test("Mit JavaScript: Fehler behält den Entwurf, ohne Neuladen", async ({ page }) => {
    await signInAs(page.context(), owner);
    await page.goto(`/de/account/messages/${conversation}`);
    const invalid = `Entwurf bleibt ${String.fromCharCode(0x202e)}`;
    await page.getByLabel("Deine Nachricht").fill(invalid);
    await page.getByRole("button", { name: "Senden" }).click();
    await expect(page.locator("#composer-error")).toHaveText("Die Nachricht ist leer, zu lang oder enthält unzulässige Zeichen.");
    await expect(page.getByLabel("Deine Nachricht")).toHaveValue(invalid);
    expect(page.url()).not.toContain("error=");
  });

  test("Text bleibt Text: HTML und Skripte werden nicht ausgeführt", async ({ page }) => {
    const dialogs: string[] = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await signInAs(page.context(), interested);
    await page.goto(`/de/account/messages/${conversation}`);
    const payload = `<img src=x onerror="alert('xss')"><script>alert('xss')</script>`;
    await page.getByLabel("Deine Nachricht").fill(payload);
    await page.getByRole("button", { name: "Senden" }).click();
    await expect(page.getByRole("log").getByText(payload)).toBeVisible();
    await expect(page.locator('ol[role="log"] img')).toHaveCount(0);
    expect(dialogs).toEqual([]);
  });

  test("Fremde, unbekannte und ungültige Unterhaltung; Kontakt zu nicht öffentlichen Anzeigen", async ({ page, request }) => {
    await signInAs(page.context(), stranger);
    for (const id of [conversation, crypto.randomUUID()]) {
      const response = await page.goto(`/de/account/messages/${id}`);
      expect(response?.headers()["cache-control"]).toContain("no-store");
      await expect(page.getByText("Diese Unterhaltung gibt es nicht, oder sie gehört nicht zu deinem Konto.")).toBeVisible();
      await expect(page.getByRole("log")).toHaveCount(0);
    }
    expect((await page.goto("/de/account/messages/abc"))?.status()).toBe(404);
    expect((await page.goto(`/de/account/messages/new/${crypto.randomUUID()}`))?.status()).toBe(404);
    expect((await page.goto(`/de/account/messages/new/${paused}`))?.status()).toBe(404);
    // Abgemeldet: Login, nie Inhalte
    const anonymous = await request.get(`/de/account/messages/${conversation}`, { maxRedirects: 0 });
    expect(anonymous.status()).toBe(307);
  });

  test("Eigene Anzeige: kein Eingabefeld", async ({ page }) => {
    await signInAs(page.context(), owner);
    await page.goto(`/de/account/messages/new/${listing}`);
    await expect(page.getByText("Das ist deine eigene Anzeige.")).toBeVisible();
    await expect(page.getByLabel("Deine Nachricht")).toHaveCount(0);
  });

  test("Nonce-CSP auf Chat-Seiten, ohne CSP-Verletzungen", async ({ page }) => {
    const violations: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" && /Content Security Policy/i.test(message.text())) violations.push(message.text());
    });
    await signInAs(page.context(), interested);
    for (const path of ["/de/account/messages", `/de/account/messages/${conversation}`]) {
      const response = await page.goto(path);
      expect(response?.headers()["content-security-policy"]).toMatch(/script-src 'nonce-[^']+' 'strict-dynamic'/);
      expect(response?.headers()["x-robots-tag"]).toContain("noindex");
    }
    await page.getByLabel("Deine Nachricht").fill("Mit Nonce gesendet");
    await page.keyboard.press("Control+Enter");
    await expect(page.getByRole("log").getByText("Mit Nonce gesendet")).toBeVisible();
    expect(violations).toEqual([]);
  });
});
