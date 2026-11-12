import { expect, test } from "@playwright/test";
import { deleteTestUsers, local } from "./cleanup";
import { createAccount, createPublicListing, signInAs } from "./session";
import { enrollTotp, makeAdmin } from "../integration/totp";

// M9b (ADR 020), Nutzerseite: Melden von Anzeige und Profil mit Login-Rücksprung, Zusicherung, Eingangsbestätigung in
// „Meine Meldungen“, Ergebnis nach der Entscheidung, Entscheidungen mit Begründung, Beschwerde. Ohne JavaScript.

const created: string[] = [];
test.afterAll(() => deleteTestUsers(created));
test.use({ javaScriptEnabled: false });

test("Melden, Ergebnis, Entscheidung und Beschwerde (ohne JavaScript)", async ({ browser }) => {
  test.skip(!local, "Lokale Supabase nötig");
  test.setTimeout(120_000);
  const owner = await createAccount("rep-owner", "Förster Kühn", created);
  const listing = await createPublicListing(owner.id, "M9b Meldeprobe");
  const reporter = await createAccount("rep-user", "Melderin", created);
  const mod = await createAccount("rep-mod", "Moderator", created);
  makeAdmin(mod.id);
  await enrollTotp(mod.client);

  // Anonym: Link „Melden“ führt über den Login zurück auf das Ziel (Pfad statt Query).
  const anon = await browser.newPage();
  await anon.goto(`/de/anzeige/${listing}`);
  await anon.getByRole("link", { name: "Anzeige melden" }).click();
  await expect(anon).toHaveURL(new RegExp(`/de/login\\?next=%2Fde%2Faccount%2Freport%2Flisting%2F${listing}`));
  await anon.close();

  const context = await browser.newContext({ javaScriptEnabled: false });
  await signInAs(context, reporter);
  const page = await context.newPage();
  await page.goto(`/de/account/report/listing/${listing}`);
  await expect(page.getByRole("heading", { name: "Anzeige melden" })).toBeVisible();
  await expect(page.getByText("M9b Meldeprobe")).toBeVisible();
  await page.getByLabel("Waffen oder Munition").check();
  await page.getByLabel("Angaben (freiwillig)").fill("Im Text werden Patronen angeboten.");
  // Ohne Zusicherung blockiert das required-Attribut; ohne JavaScript prüft der Server zusätzlich.
  await page.getByLabel(/Ich bestätige/).check();
  await page.getByRole("button", { name: "Meldung senden" }).click();
  await expect(page).toHaveURL("/de/account/reports?notice=sent");
  await expect(page.getByRole("status")).toHaveText("Danke. Deine Meldung ist eingegangen und wird geprüft.");
  await expect(page.getByText("Anzeige · Waffen oder Munition")).toBeVisible();
  await expect(page.getByText("In Prüfung")).toBeVisible();

  // Zweite Meldung zum selben Ziel: Hinweis statt Duplikat
  await page.goto(`/de/account/report/listing/${listing}`);
  await page.getByLabel("Betrug oder Betrugsversuch").check();
  await page.getByLabel(/Ich bestätige/).check();
  await page.getByRole("button", { name: "Meldung senden" }).click();
  await expect(page.getByRole("alert")).toHaveText("Du hast diesen Inhalt schon gemeldet. Deine Meldung wird geprüft.");

  // Eigene Anzeige und unbekannte Ziele: dieselbe Seite
  await page.goto(`/de/account/report/profile/${reporter.id}`);
  await expect(page.getByText("Dieser Inhalt lässt sich (nicht mehr) melden.")).toBeVisible();
  await page.goto("/de/account/report/listing/3f2b8c1e-6a4d-4e7b-9c10-5d8e2f1a0b7c");
  await expect(page.getByText("Dieser Inhalt lässt sich (nicht mehr) melden.")).toBeVisible();

  // Anbieter melden
  await page.goto(`/de/anbieter/${owner.id}`);
  await page.getByRole("link", { name: "Anbieter melden" }).click();
  await page.getByLabel("Belästigung oder Beleidigung").check();
  await page.getByLabel(/Ich bestätige/).check();
  await page.getByRole("button", { name: "Meldung senden" }).click();
  await expect(page.getByText("Profil · Belästigung oder Beleidigung")).toBeVisible();

  // Entscheidung durch die Moderation (RPC mit aal2), Ergebnis bei der Meldenden
  const target = (await mod.client.rpc("admin_report_target", { p_target_type: "listing", p_target_id: listing })).data as { listing: { version: string } };
  const resolved = await mod.client.rpc("resolve_reports", {
    p_target_type: "listing", p_target_id: listing, p_outcome: "content_removed", p_code: "weapons", p_note: "Munition im Angebot", p_expected_version: target.listing.version,
  });
  expect(resolved.error).toBeNull();
  await page.goto("/de/account/reports");
  await expect(page.getByText(/Geprüft am .*: Inhalt entfernt/)).toBeVisible();

  // Besitzer: Entscheidung mit Grund und Begründung, Beschwerde einlegen
  const ownerContext = await browser.newContext({ javaScriptEnabled: false });
  await signInAs(ownerContext, owner);
  const own = await ownerContext.newPage();
  await own.goto("/de/account");
  await own.getByRole("link", { name: "Entscheidungen und Beschwerden" }).click();
  await expect(own.getByText("Anzeige entfernt")).toBeVisible();
  await expect(own.getByText("Grund: Waffen oder Munition angeboten")).toBeVisible();
  await expect(own.getByText("Begründung: Munition im Angebot")).toBeVisible();
  await own.getByRole("link", { name: "Entscheidung anfechten" }).click();
  await own.getByLabel("Deine Begründung").fill("kurz");
  await own.getByLabel("Deine Begründung").evaluate((el) => el.removeAttribute("minlength"));
  await own.getByRole("button", { name: "Beschwerde einlegen" }).click();
  await expect(own.getByRole("alert")).toHaveText("Bitte schreibe zwischen 10 und 2000 Zeichen.");
  await own.getByLabel("Deine Begründung").fill("Es waren keine Patronen, sondern ein Foto vom Schießstand.");
  await own.getByRole("button", { name: "Beschwerde einlegen" }).click();
  await expect(own).toHaveURL("/de/account/decisions?notice=appealed");
  await expect(own.getByText("Beschwerde eingelegt, in Prüfung")).toBeVisible();

  // Die Melderin sieht dieselbe Entscheidung als „Entscheidung zu deiner Meldung“
  await page.goto("/de/account/decisions");
  await expect(page.getByText("Entscheidung zu deiner Meldung")).toBeVisible();
  await expect(page.getByText("Anzeige · Inhalt entfernt")).toBeVisible();
  await Promise.all([context.close(), ownerContext.close()]);
});
