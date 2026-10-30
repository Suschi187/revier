import { expect, test, type Page } from "@playwright/test";
import { admin, deleteTestUsers, local } from "./cleanup";
import { latestMail, uniqueEmail } from "./mailpit";
import { makeAdmin, nextTotpWindow, totp } from "../integration/totp";

// M4 (ADR 014): Zugang zum Admin-Bereich. Nicht-Admins bekommen einen echten HTTP-Status 403
// (Akzeptanz c), Admins richten TOTP per POST ein (Review B3) und kommen danach mit aal2 hinein.
// Seiten unter /admin tragen die Nonce-CSP aus dem Proxy, ohne CSP-Verletzungen.

// Optional gegen einen Produktions-Build (`npx next start -p 3456`): QA_BASE_URL=http://localhost:3456
if (process.env.QA_BASE_URL) test.use({ baseURL: process.env.QA_BASE_URL });

const created: string[] = [];
test.afterAll(() => deleteTestUsers(created));

let cspViolations: string[] = [];
test.beforeEach(({ page }) => {
  cspViolations = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /Content Security Policy/i.test(message.text())) cspViolations.push(message.text());
  });
});
test.afterEach(() => {
  expect(cspViolations).toEqual([]);
});

async function signUp(page: Page, name: string): Promise<{ email: string; id: string }> {
  const email = uniqueEmail("admin");
  created.push(email);
  await page.goto("/de/login?next=/de/account");
  const since = new Date(Date.now() - 1000);
  await page.getByLabel("E-Mail-Adresse").fill(email);
  await page.getByRole("button", { name: "Anmelde-E-Mail senden" }).click();
  const mail = await latestMail(email, since);
  await page.getByLabel("Anmeldecode").fill(mail.code);
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
  await expect(page).toHaveURL(/\/de\/welcome/);
  await page.getByLabel("Anzeigename").fill(name);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Speichern und weiter" }).click();
  await expect(page).toHaveURL("/de/account");
  const { data } = await admin().auth.admin.listUsers({ perPage: 1000 });
  const id = data.users.find((u) => u.email === email)!.id;
  return { email, id };
}

const ADMIN_PAGES = ["/de/admin", "/de/admin/mfa"];

test("Anonym: Admin-Seiten leiten zur Anmeldung", async ({ page }) => {
  for (const path of ADMIN_PAGES) {
    await page.goto(path);
    await expect(page).toHaveURL(new RegExp(`/de/login\\?next=${encodeURIComponent(path).replace(/%2F/g, "(%2F|/)")}`));
  }
});

test("Nicht-Admin: HTTP 403 auf allen Admin-Seiten (Akzeptanz c)", async ({ page }) => {
  await signUp(page, "Kein Admin");
  for (const path of ADMIN_PAGES) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(403);
    await expect(page.getByRole("heading", { name: "Kein Zugriff" })).toBeVisible();
    expect(response?.headers()["x-robots-tag"], path).toBe("noindex");
  }
  // Kein Link „Admin“ im Kopf
  await page.goto("/de/account");
  await expect(page.getByRole("link", { name: "Admin", exact: true })).toHaveCount(0);
});

test("Admin: TOTP einrichten per POST, danach Zugang mit aal2 und Nonce-CSP", async ({ page }) => {
  test.skip(!local, "Lokale Supabase nötig");
  test.setTimeout(120_000);
  const { id } = await signUp(page, "Admin Erst");
  makeAdmin(id);

  // Ohne 2FA zur MFA-Seite; mehrfaches Laden legt keinen Faktor an (B3).
  await page.goto("/de/admin");
  await expect(page).toHaveURL(/\/de\/admin\/mfa/);
  await page.reload();
  await page.goto("/de/admin/mfa");
  const factors = async () => (await admin().auth.admin.mfa.listFactors({ userId: id })).data?.factors ?? [];
  expect(await factors()).toHaveLength(0);

  // Einrichtung zweimal starten: Der erste, unbestätigte Faktor wird ersetzt.
  await page.getByRole("button", { name: "Authenticator einrichten" }).click();
  await expect(page.getByRole("img", { name: "QR-Code für die Authenticator-App" })).toBeVisible();
  await page.goto("/de/admin/mfa");
  await page.getByRole("button", { name: "Authenticator einrichten" }).click();
  const secret = (await page.locator("code").textContent())!.trim();
  expect(await factors()).toHaveLength(1);

  // Falscher Code: lokalisierte Meldung; der Faktor bleibt unbestätigt, die Einrichtung startet neu.
  await page.getByLabel("6-stelliger Code aus der App").fill("000000");
  await page.getByRole("button", { name: "Bestätigen" }).click();
  await expect(page.getByText("Der Code stimmt nicht oder ist abgelaufen.")).toBeVisible();
  await page.getByRole("button", { name: "Authenticator einrichten" }).click();
  const secret2 = (await page.locator("code").textContent())!.trim();
  expect(secret2).not.toBe(secret);
  await page.getByLabel("6-stelliger Code aus der App").fill(totp(secret2));
  await page.getByRole("button", { name: "Bestätigen" }).click();
  await expect(page).toHaveURL("/de/admin");
  await expect(page.getByRole("heading", { name: "Admin-Bereich" })).toBeVisible();
  expect((await factors()).filter((f) => f.status === "verified")).toHaveLength(1);

  // Nonce-CSP auf /admin: keine unsafe-inline-Skripte, jedes Skript mit Nonce
  const doc = await page.goto("/de/admin");
  const csp = doc!.headers()["content-security-policy"];
  expect(csp).toMatch(/script-src 'nonce-[^']+' 'strict-dynamic'/);
  expect(csp).not.toContain("'unsafe-inline' 'self'");
  // Jedes Skript im ausgelieferten HTML trägt die Nonce; später eingefügte (z. B. Dev-HMR) erlaubt strict-dynamic.
  const nonce = /'nonce-([^']+)'/.exec(csp)![1];
  const tags = (await doc!.text()).match(/<script\b[^>]*>/g) ?? [];
  expect(tags.length).toBeGreaterThan(0);
  expect(tags.filter((tag) => !tag.includes(`nonce="${nonce}"`))).toEqual([]);

  // Neue Session ohne aal2: Code-Eingabe für den bestätigten Faktor statt Einrichtung
  await page.context().clearCookies();
  await signIn(page, created.at(-1)!);
  await page.goto("/de/admin");
  await expect(page).toHaveURL(/\/de\/admin\/mfa/);
  await expect(page.getByRole("button", { name: "Authenticator einrichten" })).toHaveCount(0);
  await nextTotpWindow();
  await page.getByLabel("6-stelliger Code aus der App").fill(totp(secret2));
  await page.getByRole("button", { name: "Bestätigen" }).click();
  await expect(page).toHaveURL("/de/admin");
  await expect(page.getByRole("link", { name: "Admin", exact: true })).toBeVisible();
});

async function signIn(page: Page, email: string) {
  await page.goto("/de/login?next=/de/account");
  const since = new Date(Date.now() - 1000);
  await page.getByLabel("E-Mail-Adresse").fill(email);
  await page.getByRole("button", { name: "Anmelde-E-Mail senden" }).click();
  const mail = await latestMail(email, since);
  await page.getByLabel("Anmeldecode").fill(mail.code);
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
  await expect(page).toHaveURL("/de/account");
}

/** Admin mit eingerichtetem TOTP (über die UI); liefert das Secret für weitere Codes. */
async function becomeAdmin(page: Page, name: string): Promise<string> {
  const { id } = await signUp(page, name);
  makeAdmin(id);
  await page.goto("/de/admin/mfa");
  await page.getByRole("button", { name: "Authenticator einrichten" }).click();
  const secret = (await page.locator("code").textContent())!.trim();
  await page.getByLabel("6-stelliger Code aus der App").fill(totp(secret));
  await page.getByRole("button", { name: "Bestätigen" }).click();
  await expect(page).toHaveURL("/de/admin");
  return secret;
}

/** Eingereichte Anzeige eines eigenen Testkontos (Server-Pfad); liefert die id. */
async function submittedListing(title: string): Promise<string> {
  const client = admin();
  const email = uniqueEmail("owner");
  created.push(email);
  const user = await client.auth.admin.createUser({ email, email_confirm: true });
  const { data: region } = await client.from("regions").select("id").eq("code", "DE-14612").single();
  const { data, error } = await client
    .from("listings")
    .insert({
      owner_id: user.data.user!.id, kind: "helper", direction: "wanted", title, content_language: "pl", region_id: region!.id,
      description: "Szukam pomocy przy budowie ambony wiosną, dwa weekendy.", attributes: { tasks: ["Ambona"] }, status: "pending_review",
    })
    .select("id")
    .single();
  expect(error).toBeNull();
  return data!.id;
}

test("Warteschlange: Freigeben, Bearbeitung anfordern, Ablehnen mit Grund, geänderter Stand", async ({ page }) => {
  test.skip(!local, "Lokale Supabase nötig");
  test.setTimeout(120_000);
  const approveId = await submittedListing("Freigabe E2E");
  const returnId = await submittedListing("Zurückgeben E2E");
  const changedId = await submittedListing("Geändert E2E");
  await becomeAdmin(page, "Admin Moderation");

  await page.goto("/de/admin/listings");
  for (const title of ["Freigabe E2E", "Zurückgeben E2E", "Geändert E2E"]) {
    await expect(page.getByRole("link", { name: title })).toBeVisible();
  }

  // Freigeben
  await page.getByRole("link", { name: "Freigabe E2E" }).click();
  await expect(page.getByText("Sprache der Anzeige: Polski")).toBeVisible();
  await page.getByLabel("Freigeben").check();
  await page.getByRole("button", { name: "Entscheidung speichern" }).click();
  await expect(page.getByText("Die Anzeige ist freigegeben.")).toBeVisible();
  const { data: approved } = await admin().from("listings").select("status").eq("id", approveId).single();
  expect(approved!.status).toBe("active");

  // Bearbeitung anfordern: ohne Grund Fehler, mit Grund zurück in den Entwurf
  await page.goto(`/de/admin/listings/${returnId}`);
  await page.getByLabel("Bearbeitung anfordern").check();
  await page.getByRole("button", { name: "Entscheidung speichern" }).click();
  await expect(page.getByText("Bitte wähle einen Grund.")).toBeVisible();
  await page.getByLabel("Bearbeitung anfordern").check();
  await page.getByLabel("Grund", { exact: true }).selectOption({ label: "Kontaktdaten im Text" });
  await page.getByLabel("Hinweis an den Inserenten (optional)").fill("Bitte die Telefonnummer entfernen.");
  await page.getByRole("button", { name: "Entscheidung speichern" }).click();
  await expect(page.getByText("Die Anzeige ist zur Bearbeitung zurückgegeben.")).toBeVisible();
  const { data: returned } = await admin().from("listings").select("status, reject_code, reject_reason").eq("id", returnId).single();
  expect(returned).toEqual({ status: "draft", reject_code: "contact_in_text", reject_reason: "Bitte die Telefonnummer entfernen." });

  // Geänderter Stand nach dem Öffnen: Hinweis statt Entscheidung (B1)
  await page.goto(`/de/admin/listings/${changedId}`);
  await admin().from("listings").update({ title: "Geändert E2E (neu)" }).eq("id", changedId);
  await page.getByLabel("Ablehnen").check();
  await page.getByLabel("Grund", { exact: true }).selectOption({ label: "Doppelte Anzeige" });
  await page.getByRole("button", { name: "Entscheidung speichern" }).click();
  await expect(page.getByText("Der Inserent hat die Anzeige inzwischen geändert.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Geändert E2E (neu)" })).toBeVisible();
  await page.getByLabel("Ablehnen").check();
  await page.getByLabel("Grund", { exact: true }).selectOption({ label: "Doppelte Anzeige" });
  await page.getByRole("button", { name: "Entscheidung speichern" }).click();
  await expect(page.getByText("Die Anzeige ist abgelehnt.")).toBeVisible();
  for (const title of ["Freigabe E2E", "Zurückgeben E2E", "Geändert E2E (neu)"]) {
    await expect(page.getByRole("link", { name: title })).toHaveCount(0);
  }
});
