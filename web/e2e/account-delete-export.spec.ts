import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { admin, deleteTestUsers } from "./cleanup";
import { latestMail } from "./mailpit";
import { createAccount, createPublicListing, signInAs } from "./session";
import { localRows, localSql, makeAdmin } from "../integration/totp";

// M9a (ADR 019): Datenexport als Download (Foto-Links mit Login, Limit, Origin-Prüfung) und Konto löschen über die
// Oberfläche (frischer Code an die Adresse der Session, Bestätigung, Abmeldung, Hinweis „wird gelöscht“, Konto weg).
// Das Löschen läuft über die echte Function: Ohne Vault-URL setzt der Test sie für seine Dauer.

const created: string[] = [];
const BASE = "http://localhost:3000";
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);
let setUrl = false;

test.beforeAll(() => {
  const url = localRows<{ n: number }>("select count(*)::int as n from vault.secrets where name = 'account_deletion_url'")[0].n;
  if (url === 0) {
    localSql("select vault.create_secret('http://kong:8000/functions/v1/delete-account', 'account_deletion_url')");
    setUrl = true;
  }
});
test.afterAll(async () => {
  if (setUrl) localSql("delete from vault.secrets where name = 'account_deletion_url'");
  await deleteTestUsers(created);
});

/** Verarbeitetes Foto (Server-Pfad, nur im Test): Datei im Bucket und Zeile mit processed_at. */
async function processedPhoto(ownerId: string, listingId: string): Promise<string> {
  const service = admin();
  // storage_path setzt der Pfad-Trigger ({owner}/{listing}/{id}.jpg); die Datei kommt danach an genau diesen Pfad.
  const { data } = await service.from("listing_photos")
    .insert({ listing_id: listingId, sort_order: 0, alt_text: "Foto", processed_at: new Date().toISOString(), width: 8, height: 8 })
    .select("id, storage_path").single();
  await service.storage.from("listing-photos").upload(data!.storage_path as string, JPEG, { contentType: "image/jpeg", upsert: true });
  return data!.id as string;
}

test("Datenexport: Download mit Foto-Links, Link nur mit Login und Eigentum, Limit, Origin-Prüfung", async ({ page, context, browser, request }) => {
  const owner = await createAccount("export-owner", "Export Olga", created);
  const other = await createAccount("export-other", "Export Otto", created);
  const listing = await createPublicListing(owner.id, `Export ${Date.now()}`);
  const photo = await processedPhoto(owner.id, listing);
  await signInAs(context, owner);

  await page.goto("/de/account");
  await page.getByRole("link", { name: "Meine Daten herunterladen" }).click();
  await expect(page).toHaveURL("/de/account/data");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Daten herunterladen (JSON)" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^revier-export-\d{4}-\d{2}-\d{2}\.json$/);
  const data = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(data.format).toBe("revier-export");
  expect(data.account.email).toBe(owner.email);
  const url = `${BASE}/api/account/photos/${photo}`;
  expect(data.listings[0].photos[0].download_url).toBe(url);
  expect(JSON.stringify(data)).not.toContain(other.id);

  // Foto-Link: Eigentümer → 303 auf eine signierte URL, fremd → 404, ohne Login → Login.
  const own = await context.request.get(url, { maxRedirects: 0 });
  expect(own.status()).toBe(303);
  expect(own.headers()["location"]).toContain("/storage/v1/object/sign/listing-photos/");
  expect(own.headers()["cache-control"]).toBe("private, no-store");
  const otherContext = await browser.newContext();
  await signInAs(otherContext, other);
  expect((await otherContext.request.get(url, { maxRedirects: 0 })).status()).toBe(404);
  await otherContext.close();
  const anonymous = await request.get(url, { maxRedirects: 0 });
  expect(anonymous.status()).toBe(303);
  expect(anonymous.headers()["location"]).toMatch(/^\/de\/login\?next=/);

  // Origin-Prüfung: fremde Herkunft und fehlender Origin → 403.
  for (const headers of [{ Origin: "https://evil.example" }, {}] as Record<string, string>[]) {
    expect((await context.request.post("/api/account/export", { headers, form: { locale: "de" }, maxRedirects: 0 })).status()).toBe(403);
  }

  // Limit: 3 je 24 h. Zwei weitere gehen, der vierte führt mit Hinweis zurück auf die Seite.
  for (let i = 0; i < 2; i++) {
    await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Daten herunterladen (JSON)" }).click()]);
  }
  await page.getByRole("button", { name: "Daten herunterladen (JSON)" }).click();
  await expect(page).toHaveURL(/\/de\/account\/data\?error=rate_limited/);
  await expect(page.getByRole("alert").filter({ hasText: "Limit erreicht" })).toBeVisible();
});

test("Konto löschen: frischer Code, Bestätigung, abgemeldet, Konto und Dateien weg", async ({ page, context }) => {
  const user = await createAccount("delete-ui", "Lösch Lena", created);
  const listing = await createPublicListing(user.id, `Löschen ${Date.now()}`);
  await processedPhoto(user.id, listing);
  await signInAs(context, user);

  await page.goto("/de/account");
  await page.getByRole("link", { name: "Konto löschen" }).click();
  await expect(page).toHaveURL("/de/account/delete");
  await expect(page.getByRole("heading", { name: "Was bleibt (pseudonymisiert)" })).toBeVisible();

  // Sperrfrist von GoTrue zwischen zwei Mails an dieselbe Adresse (lokal wenige Sekunden): Der Test-Login hat eben
  // erst einen Link erzeugt. Die Seite zeigt sie an; danach geht die Anforderung durch.
  const since = new Date(Date.now() - 1000);
  await page.getByRole("button", { name: "Code senden" }).click();
  const tooSoon = page.getByRole("alert").filter({ hasText: "Bitte warte einen Moment" });
  await expect(tooSoon.or(page.getByText("Wir haben einen Code an"))).toBeVisible();
  if (await tooSoon.isVisible()) {
    await page.waitForTimeout(6_000);
    await page.getByRole("button", { name: "Code senden" }).click();
  }
  const mail = await latestMail(user.email, since);
  await page.getByLabel("Anmeldecode").fill(mail.code);
  await page.getByRole("button", { name: "Bestätigen" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Anmeldung bestätigt" })).toBeVisible();

  await page.getByRole("checkbox", { name: /endgültig gelöscht werden/ }).check();
  await page.getByRole("button", { name: "Konto endgültig löschen" }).click();
  await expect(page).toHaveURL("/de?deleted=1");
  await expect(page.getByRole("status").filter({ hasText: "Dein Konto wird gelöscht" })).toBeVisible();
  expect((await context.cookies()).filter((c) => c.name.startsWith("sb-")).map((c) => c.name)).toEqual([]);

  // Die Function löscht im Hintergrund (pg_net); danach gibt es weder Konto noch Dateien.
  await expect.poll(async () => (await admin().auth.admin.getUserById(user.id)).data.user, { timeout: 20_000 }).toBeNull();
  await expect.poll(() => localRows<{ n: number }>(`select count(*)::int as n from storage.objects where name like '${user.id}/%'`)[0].n, { timeout: 10_000 }).toBe(0);
});

test("Konto löschen: Konto mit Admin-Rolle wird abgewiesen", async ({ page, context }) => {
  const user = await createAccount("delete-admin", "Admin Anna", created);
  makeAdmin(user.id);
  await signInAs(context, user);
  await page.goto("/de/account/delete");
  await page.getByRole("checkbox", { name: /endgültig gelöscht werden/ }).check();
  await page.getByRole("button", { name: "Konto endgültig löschen" }).click();
  await expect(page).toHaveURL("/de/account/delete?error=admin_role");
  await expect(page.getByRole("alert").filter({ hasText: "Admin-Rolle" })).toBeVisible();
  expect((await admin().auth.admin.getUserById(user.id)).data.user).not.toBeNull();
});
