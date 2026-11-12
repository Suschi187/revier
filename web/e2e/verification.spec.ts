import { expect, test } from "@playwright/test";
import { admin, deleteTestUsers, local } from "./cleanup";
import { createAccount, createPublicListing, sessionCookies, signInAs } from "./session";
import { JPEG } from "../integration/helpers";
import { enrollTotp, makeAdmin } from "../integration/totp";

// M9b (ADR 020), Akzeptanz 1 und 4: Upload eines Dokuments → Entscheidung im Admin → Badge „verifiziert“ öffentlich
// sichtbar, nach Widerruf wieder weg. Das Dokument erscheint im Admin erst nach dem Klick (Audit, Review B3).

const created: string[] = [];
test.afterAll(() => deleteTestUsers(created));

test("Verifizierung: Upload, Dokument mit Audit, Entscheidung, Badge, Widerruf", async ({ browser }) => {
  test.skip(!local, "Lokale Supabase nötig");
  test.setTimeout(120_000);
  const owner = await createAccount("verif", "Revierpächter Vogt", created);
  const listing = await createPublicListing(owner.id, "M9b Badge-Probe");
  const mod = await createAccount("verifmod", "Moderatorin", created);
  makeAdmin(mod.id);
  await enrollTotp(mod.client);
  const modCookies = await sessionCookies(mod.client);

  const ownerContext = await browser.newContext();
  await signInAs(ownerContext, owner);
  const page = await ownerContext.newPage();
  await page.goto("/de/account");
  await page.getByRole("link", { name: "Verifizierung" }).click();
  await expect(page).toHaveURL("/de/account/verification");
  await expect(page.getByRole("heading", { name: "Status: Nicht verifiziert" })).toBeVisible();
  // Kein Gewerbenachweis für private Konten
  await expect(page.getByLabel("Dokument").locator("option")).toHaveText(["Jagdschein", "Jagdkarte", "Revierbescheinigung"]);

  // Umbenannte Datei fällt in der Vorprüfung durch (Typ nach den ersten Bytes).
  await page.getByLabel("Datei").setInputFiles({ name: "jagdschein.jpg", mimeType: "image/jpeg", buffer: Buffer.from("<html>kein Bild</html>") });
  await page.getByRole("button", { name: "Hochladen und einreichen" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Bitte wähle eine JPEG-, PNG- oder PDF-Datei." })).toBeVisible();

  await page.getByLabel("Dokument").selectOption({ label: "Jagdkarte" });
  await page.getByLabel("Datei").setInputFiles({ name: "jagdkarte.jpg", mimeType: "image/jpeg", buffer: Buffer.from(JPEG) });
  await page.getByRole("button", { name: "Hochladen und einreichen" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Dein Antrag ist eingereicht" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Status: In Prüfung" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Antrag zurückziehen" })).toBeVisible();

  const service = admin();
  const request = (await service.from("verifications").select("id, document_type").eq("user_id", owner.id).single()).data!;
  expect(request.document_type).toBe("jagdkarte");

  const modContext = await browser.newContext();
  await modContext.addCookies(modCookies.map((c) => ({ ...c, url: "http://localhost:3000", sameSite: "Lax" as const })));
  const adminPage = await modContext.newPage();
  await adminPage.goto("/de/admin");
  await expect(adminPage.getByText("1 Verifizierung zur Prüfung.")).toBeVisible();
  await adminPage.getByRole("link", { name: "Verifizierungen prüfen" }).click();
  await adminPage.getByRole("link", { name: "Jagdkarte von Revierpächter Vogt" }).click();
  await expect(adminPage).toHaveURL(`/de/admin/verifications/${request.id}`);
  await expect(adminPage.getByRole("img", { name: /Hochgeladenes Dokument/ })).toHaveCount(0);
  const viewed = async () =>
    (await service.from("audit_log").select("id", { count: "exact", head: true }).eq("action", "verification.document_viewed").eq("target_id", request.id)).count;
  expect(await viewed()).toBe(0);

  await adminPage.getByRole("button", { name: "Dokument anzeigen" }).click();
  await expect(adminPage.getByRole("img", { name: "Hochgeladenes Dokument: Jagdkarte" })).toBeAttached();
  expect(await viewed()).toBe(1);
  const src = await adminPage.getByRole("img", { name: "Hochgeladenes Dokument: Jagdkarte" }).getAttribute("src");
  expect(src).toContain("/storage/v1/object/sign/verification-docs/");

  await adminPage.getByLabel("Verifizieren").check();
  await adminPage.getByRole("button", { name: "Entscheidung speichern" }).click();
  await expect(adminPage).toHaveURL("/de/admin/verifications?notice=verified");
  await expect(adminPage.getByRole("status").filter({ hasText: "Konto verifiziert." })).toBeVisible();

  // Öffentlich: Badge auf der Anbieterseite und am Detail
  const anon = await browser.newPage();
  await anon.goto(`/de/anbieter/${owner.id}`);
  await expect(anon.getByText("verifiziert", { exact: true }).first()).toBeVisible();
  await anon.goto(`/de/anzeige/${listing}`);
  await expect(anon.getByText("verifiziert", { exact: true }).first()).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Status: Verifiziert" })).toBeVisible();

  // Widerruf: Badge weg
  await adminPage.goto(`/de/admin/verifications/${request.id}`);
  await adminPage.getByLabel("Grund").selectOption({ label: "Verdacht auf Missbrauch" });
  await adminPage.getByLabel("Begründung für den Nutzer").fill("Nach einer Meldung geprüft.");
  await adminPage.getByRole("button", { name: "Widerrufen" }).click();
  await expect(adminPage).toHaveURL("/de/admin/verifications?notice=revoked");

  await anon.goto(`/de/anbieter/${owner.id}`);
  await expect(anon.getByRole("heading", { name: "Revierpächter Vogt" })).toBeVisible();
  await expect(anon.getByText("verifiziert", { exact: true })).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Status: Nicht verifiziert" })).toBeVisible();
  await expect(page.getByText(/Deine Verifizierung wurde am .* widerrufen\. Grund: Verdacht auf Missbrauch\./)).toBeVisible();

  await Promise.all([ownerContext.close(), modContext.close(), anon.close()]);
});

test("Ohne Login zur Anmeldung; Admin-Seiten der Verifizierung für Nicht-Admins 403", async ({ page, context }) => {
  test.skip(!local, "Lokale Supabase nötig");
  await page.goto("/de/account/verification");
  await expect(page).toHaveURL(/\/de\/login\?next=/);
  const user = await createAccount("verifplain", "Ohne Rolle", created);
  await signInAs(context, user);
  const response = await page.goto("/de/admin/verifications");
  expect(response?.status()).toBe(403);
});
