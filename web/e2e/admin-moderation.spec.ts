import { expect, test, type Browser } from "@playwright/test";
import { admin, deleteTestUsers, local } from "./cleanup";
import { createAccount, createPublicListing, sessionCookies, signInAs, type TestAccount } from "./session";
import { enrollTotp, makeAdmin } from "../integration/totp";

// M9b (ADR 020) über die Admin-Oberfläche, ohne JavaScript:
// - Akzeptanz 2: Meldung einer Anzeige → Entfernen im Admin (Mails prüft integration/trust-mails.test.ts).
// - Akzeptanz 3: Sperre eines Kontos → Beschwerde des Betroffenen → Entsperrung durch einen anderen Admin; der Admin
//   der ursprünglichen Entscheidung darf nicht, solange ein anderer verfügbar ist.
// - Gemeldete Chat-Nachricht nur hinter einem Klick, jeder Abruf auditiert.

const created: string[] = [];
test.afterAll(() => deleteTestUsers(created));
test.use({ javaScriptEnabled: false });

async function adminContext(browser: Browser, account: TestAccount) {
  const context = await browser.newContext({ javaScriptEnabled: false });
  await context.addCookies((await sessionCookies(account.client)).map((c) => ({ ...c, url: "http://localhost:3000", sameSite: "Lax" as const })));
  return context;
}

test("Meldung → Entfernen, Sperre → Beschwerde → Entsperrung durch einen anderen Admin", async ({ browser }) => {
  test.skip(!local, "Lokale Supabase nötig");
  test.setTimeout(180_000);
  const owner = await createAccount("adm-owner", "Jäger Brandt", created);
  const listing = await createPublicListing(owner.id, "M9b Entfernprobe");
  const reporter = await createAccount("adm-rep", "Hinweisgeberin", created);
  const modA = await createAccount("adm-a", "Admin Anna", created);
  const modB = await createAccount("adm-b", "Admin Bernd", created);
  for (const mod of [modA, modB]) {
    makeAdmin(mod.id);
    await enrollTotp(mod.client);
  }
  expect((await reporter.client.from("reports").insert({ target_type: "listing", target_id: listing, reason: "weapons", note: "Patronen" })).error).toBeNull();

  // Akzeptanz 2: Entfernen über die Oberfläche
  const a = await adminContext(browser, modA);
  const pa = await a.newPage();
  await pa.goto("/de/admin");
  await expect(pa.getByText("1 offene Meldung.")).toBeVisible();
  await pa.getByRole("link", { name: "Meldungen prüfen" }).click();
  await pa.getByRole("link", { name: "Anzeige: M9b Entfernprobe" }).click();
  await expect(pa.getByText("Patronen")).toBeVisible();
  await expect(pa.getByText("Hinweisgeberin")).toHaveCount(0);
  await pa.getByLabel("Anzeige entfernen").check();
  await pa.getByLabel("Grund").selectOption({ label: "Waffen oder Munition angeboten" });
  await pa.getByLabel("Begründung für die Betroffenen").fill("Im Text werden Patronen angeboten.");
  await pa.getByRole("button", { name: "Meldungen erledigen" }).click();
  await expect(pa).toHaveURL("/de/admin/reports?notice=resolved");
  const service = admin();
  expect((await service.from("listings").select("status").eq("id", listing).single()).data?.status).toBe("removed");
  const anon = await browser.newPage();
  const gone = await anon.goto(`/de/anzeige/${listing}`);
  expect(gone?.status()).toBe(410);
  await anon.close();

  // Akzeptanz 3: Admin A sperrt über die Kontosuche
  await pa.goto("/de/admin/users");
  await pa.getByLabel("E-Mail-Adresse oder Konto-ID").fill(owner.email);
  await pa.getByRole("button", { name: "Suchen" }).click();
  await expect(pa).toHaveURL(`/de/admin/users/${owner.id}`);
  await expect(pa.getByRole("heading", { name: "Jäger Brandt" })).toBeVisible();
  expect(pa.url()).not.toContain("@");
  await pa.getByLabel("Sperren").check();
  await pa.getByLabel("Grund").selectOption({ label: "Belästigung oder Beleidigung" });
  await pa.getByLabel("Begründung für das Konto").fill("Beleidigende Nachrichten an andere Nutzer.");
  await pa.getByRole("button", { name: "Ausführen" }).click();
  await expect(pa.getByRole("status").filter({ hasText: "Konto gesperrt." })).toBeVisible();
  // Konten mit Rolle: kein Formular
  await pa.goto(`/de/admin/users/${modB.id}`);
  await expect(pa.getByText("Dieses Konto hat eine Rolle.")).toBeVisible();
  await expect(pa.getByRole("button", { name: "Ausführen" })).toHaveCount(0);

  // Betroffener: Beschwerde trotz Sperre
  const o = await browser.newContext({ javaScriptEnabled: false });
  await signInAs(o, owner);
  const po = await o.newPage();
  await po.goto("/de/account/decisions");
  await expect(po.getByText("Konto gesperrt")).toBeVisible();
  await expect(po.getByText("Begründung: Beleidigende Nachrichten an andere Nutzer.")).toBeVisible();
  const block = po.locator("li").filter({ hasText: "Konto gesperrt" });
  await block.getByRole("link", { name: "Entscheidung anfechten" }).click();
  await po.getByLabel("Deine Begründung").fill("Die Nachrichten waren sachlich, bitte noch einmal prüfen.");
  await po.getByRole("button", { name: "Beschwerde einlegen" }).click();
  await expect(po).toHaveURL("/de/account/decisions?notice=appealed");

  // Admin A (ursprüngliche Entscheidung) darf nicht entscheiden
  await pa.goto("/de/admin/appeals");
  await pa.getByRole("link", { name: "Konto gesperrt: Jäger Brandt" }).click();
  await expect(pa.getByText("Deine eigene ursprüngliche Entscheidung").first()).toBeVisible();
  await pa.getByLabel("Beschwerde stattgeben (Maßnahme zurücknehmen)").check();
  await pa.getByLabel("Begründung für die Person").fill("Neu geprüft.");
  await pa.getByRole("button", { name: "Entscheidung speichern" }).click();
  await expect(pa.getByRole("alert")).toHaveText("Ein anderer Admin muss entscheiden: Du hast die ursprüngliche Entscheidung getroffen.");

  // Admin B entsperrt per Beschwerde
  const b = await adminContext(browser, modB);
  const pb = await b.newPage();
  await pb.goto("/de/admin/appeals");
  await pb.getByRole("link", { name: "Konto gesperrt: Jäger Brandt" }).click();
  await expect(pb.getByText("Die Nachrichten waren sachlich")).toBeVisible();
  await pb.getByLabel("Beschwerde stattgeben (Maßnahme zurücknehmen)").check();
  await pb.getByLabel("Begründung für die Person").fill("Die Nachrichten waren keine Beleidigung.");
  await pb.getByRole("button", { name: "Entscheidung speichern" }).click();
  await expect(pb).toHaveURL("/de/admin/appeals?notice=reversed");
  expect((await service.from("profiles").select("is_blocked").eq("user_id", owner.id).single()).data?.is_blocked).toBe(false);
  await po.goto("/de/account/decisions");
  await expect(po.getByText("Beschwerde geprüft: Die Entscheidung wurde aufgehoben")).toBeVisible();
  await Promise.all([a.close(), b.close(), o.close()]);
});

test("Gemeldete Chat-Nachricht: erst nach Klick sichtbar, jeder Abruf auditiert", async ({ browser }) => {
  test.skip(!local, "Lokale Supabase nötig");
  test.setTimeout(120_000);
  const owner = await createAccount("msg-owner", "Revierinhaber", created);
  const listing = await createPublicListing(owner.id, "M9b Chatprobe");
  const interested = await createAccount("msg-int", "Interessent", created);
  const mod = await createAccount("msg-mod", "Admin Chat", created);
  makeAdmin(mod.id);
  await enrollTotp(mod.client);
  const conversation = (await interested.client.rpc("start_conversation", { p_listing_id: listing, p_body: "Hallo" })).data as string;
  const sent = await owner.client.rpc("send_message", { p_conversation_id: conversation, p_body: "Zahl vorab per Gutschein" });
  expect(sent.error).toBeNull();
  const message = (await admin().from("messages").select("id").eq("conversation_id", conversation).eq("sender_id", owner.id).single()).data!.id as string;
  const report = await interested.client.from("reports").insert({ target_type: "message", target_id: message, reason: "scam" }).select("id").single();
  expect(report.error).toBeNull();

  const context = await adminContext(browser, mod);
  const page = await context.newPage();
  await page.goto(`/de/admin/reports/message/${message}`);
  await expect(page.getByRole("heading", { name: "Nachricht: Revierinhaber" })).toBeVisible();
  await expect(page.getByText("Zahl vorab per Gutschein")).toHaveCount(0);
  const viewed = async () => (await admin().from("audit_log").select("id", { count: "exact", head: true }).eq("action", "report.message_viewed").eq("target_id", report.data!.id)).count;
  expect(await viewed()).toBe(0);
  await page.getByRole("button", { name: "Gemeldete Nachricht anzeigen" }).click();
  await expect(page.getByText("Zahl vorab per Gutschein")).toBeVisible();
  expect(await viewed()).toBe(1);
  // Keine Maßnahme gegen Inhalte bei Nachrichten
  await expect(page.getByLabel("Anzeige entfernen")).toHaveCount(0);
  await page.getByLabel("Konto verwarnen").check();
  await page.getByLabel("Grund").selectOption({ label: "Betrug oder Betrugsversuch" });
  await page.getByRole("button", { name: "Meldungen erledigen" }).click();
  await expect(page).toHaveURL("/de/admin/reports?notice=resolved");
  expect((await admin().from("audit_log").select("action").eq("action", "profile.warned").eq("target_id", owner.id)).data).toHaveLength(1);
  await context.close();
});
