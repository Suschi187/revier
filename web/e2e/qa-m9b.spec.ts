import { expect, test, type Browser, type Page } from "@playwright/test";
import { admin, deleteTestUsers, local } from "./cleanup";
import { createAccount, createPublicListing, sessionCookies, signInAs, type TestAccount } from "./session";
import { enrollTotp, localSql, makeAdmin } from "../integration/totp";

// QA M9b – Abnahme (docs/QA-REPORT.md, Abschnitt „M9b – Abnahme“). Proben über die Oberfläche:
// - Magic Bytes vor der Anzeige: HTML als image/png wird im Admin nicht angezeigt, sondern markiert (Review A6).
// - Header der Dokumentansicht (no-store, Referrer-Policy).
// - Melden, Meine Meldungen und Entscheidungen für ein gesperrtes Konto ohne aktuelle Zustimmung, ohne JavaScript.
// - Statischer Melde-Link: anonym und angemeldet derselbe, Login-Umweg mit Ziel im Pfad (Anbieter).
// - F5: „Anzeige entfernen“ mit einem Grund aus der Gruppe „Konto“ scheitert (test.fail).
// - axe (WCAG 2 A/AA, ernst/kritisch), keine rohen Schlüssel und kein Überlauf bei 360 px auf den neuen Konto- und
//   Admin-Seiten in en/cs/pl, inklusive Audit-Log (Nachtrag 3c74b6e).

const created: string[] = [];
test.afterAll(() => deleteTestUsers(created));
test.use({ javaScriptEnabled: false });

async function axe(page: Page, label: string) {
  const { default: AxeBuilder } = await import("@axe-core/playwright");
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(result.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${label} ${v.id}: ${v.nodes.length}`)).toEqual([]);
}
async function noOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, label).toBeLessThanOrEqual(0);
}
async function adminAccount(label: string, name: string): Promise<TestAccount> {
  const mod = await createAccount(label, name, created);
  makeAdmin(mod.id);
  await enrollTotp(mod.client);
  return { ...mod, cookies: await sessionCookies(mod.client) };
}
async function contextFor(browser: Browser, account: TestAccount, javaScriptEnabled = false) {
  // axe und page.evaluate brauchen JavaScript; die übrigen Proben laufen ohne.
  const context = await browser.newContext({ javaScriptEnabled });
  await signInAs(context, account);
  return context;
}
const RAW_KEY = /\b(Admin|Report|Reports|Decisions|Appeal|Verification|Moderation|Account)\.[a-z][A-Za-z]+/;

test.describe("QA M9b", () => {
  test.skip(!local, "Lokale Supabase nötig");
  test.setTimeout(240_000);

  test("Magic Bytes: HTML als image/png wird im Admin nicht angezeigt; Dokumentansicht mit no-store", async ({ browser }) => {
    const owner = await createAccount("qa9b-mb", "QA9b Magic", created);
    const mod = await adminAccount("qa9b-mbmod", "QA9b Mod");
    const begun = (await owner.client.rpc("begin_verification", { p_document_type: "jagdschein" })).data as { id: string; path: string };
    const html = new TextEncoder().encode("<html><body>kein Dokument</body></html>");
    expect((await owner.client.storage.from("verification-docs").upload(begun.path, html, { contentType: "image/png" })).error).toBeNull();
    expect((await owner.client.rpc("submit_verification", { p_id: begun.id })).error).toBeNull();

    const context = await contextFor(browser, mod);
    const page = await context.newPage();
    await page.goto(`/de/admin/verifications/${begun.id}`);
    await page.getByRole("button", { name: "Dokument anzeigen" }).click();
    await expect(page).toHaveURL(new RegExp(`/de/admin/verifications/${begun.id}\\?document=1`));
    await expect(page.getByRole("alert").filter({ hasText: "Der Inhalt der Datei passt zu keinem erlaubten Typ" })).toBeVisible();
    await expect(page.locator("#document img")).toHaveCount(0);
    expect(await page.locator("#document a[href*='/storage/']").count()).toBe(0);
    expect(await page.content()).not.toContain("/storage/v1/object/sign/");

    const response = await page.request.get(`/de/admin/verifications/${begun.id}?document=1`);
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"] ?? "").toMatch(/no-store/);
    expect(response.headers()["x-robots-tag"] ?? (await response.text())).toMatch(/noindex/);
    await context.close();
    await admin().storage.from("verification-docs").remove([begun.path]);
  });

  test("Gesperrt und ohne aktuelle Zustimmung: Melden, Meine Meldungen, Entscheidungen (ohne JavaScript)", async ({ browser }) => {
    const owner = await createAccount("qa9b-own", "QA9b Besitzerin", created);
    const listing = await createPublicListing(owner.id, "QA9b Meldeziel");
    const user = await createAccount("qa9b-blk", "QA9b Gesperrt", created);
    localSql(`delete from public.legal_acceptances where user_id = '${user.id}'`);
    localSql(`update public.profiles set is_blocked = true where user_id = '${user.id}'`);
    const context = await contextFor(browser, user);
    const page = await context.newPage();
    await page.goto(`/de/account/report/listing/${listing}`);
    await expect(page).toHaveURL(`/de/account/report/listing/${listing}`);
    await page.getByLabel("Betrug oder Betrugsversuch").check();
    await page.getByLabel(/Ich bestätige/).check();
    await page.getByRole("button", { name: "Meldung senden" }).click();
    await expect(page).toHaveURL("/de/account/reports?notice=sent");
    for (const path of ["/de/account/reports", "/de/account/decisions"]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(200);
      await expect(page, path).toHaveURL(path);
    }
    // Zusicherung und Rechtsbehelfe als Platzhalter markiert
    await page.goto(`/de/account/report/profile/${owner.id}`);
    await expect(page.getByText(/^\[Vorläufiger Wortlaut\] Ich bestätige/)).toBeVisible();
    await page.goto("/de/account/decisions");
    await expect(page.getByText("[Vorläufiger Hinweis] Angaben zur außergerichtlichen Streitbeilegung")).toBeVisible();
    await context.close();
  });

  test("Melde-Links sind statisch und führen über den Login mit Ziel im Pfad", async ({ browser }) => {
    const owner = await createAccount("qa9b-link", "QA9b Anbieter", created);
    const listing = await createPublicListing(owner.id, "QA9b Linkprobe");
    const anon = await browser.newPage();
    await anon.goto(`/de/anzeige/${listing}`);
    const anonHref = await anon.getByRole("link", { name: "Anzeige melden" }).getAttribute("href");
    expect(await anon.getByRole("link", { name: "Anzeige melden" }).getAttribute("rel")).toBe("nofollow");
    await anon.goto(`/de/anbieter/${owner.id}`);
    await anon.getByRole("link", { name: "Anbieter melden" }).click();
    await expect(anon).toHaveURL(new RegExp(`/de/login\\?next=%2Fde%2Faccount%2Freport%2Fprofile%2F${owner.id}$`));
    await anon.close();

    const viewer = await createAccount("qa9b-view", "QA9b Leser", created);
    const context = await contextFor(browser, viewer);
    const page = await context.newPage();
    await page.goto(`/de/anzeige/${listing}`);
    expect(await page.getByRole("link", { name: "Anzeige melden" }).getAttribute("href")).toBe(anonHref);
    // Auch der Besitzer sieht denselben Link (keine Personalisierung); die Meldeseite lehnt ab.
    const ownContext = await contextFor(browser, owner);
    const own = await ownContext.newPage();
    await own.goto(`/de/anzeige/${listing}`);
    expect(await own.getByRole("link", { name: "Anzeige melden" }).getAttribute("href")).toBe(anonHref);
    await own.goto(anonHref!);
    await expect(own.getByText("Dieser Inhalt lässt sich (nicht mehr) melden.")).toBeVisible();
    await Promise.all([context.close(), ownContext.close()]);
  });

  test("F5: Anzeige entfernen mit einem Grund aus der Gruppe „Konto“", async ({ browser }) => {
    test.fail(true, "F5: Die Auswahl bietet Konto-Codes an, listings.reject_code lehnt sie ab (23514 → „Bitte wähle einen Grund“)");
    const owner = await createAccount("qa9b-f5o", "QA9b F5", created);
    const listing = await createPublicListing(owner.id, "QA9b Betrugsanzeige");
    const reporter = await createAccount("qa9b-f5r", "QA9b F5 Melder", created);
    expect((await reporter.client.from("reports").insert({ target_type: "listing", target_id: listing, reason: "scam" })).error).toBeNull();
    const mod = await adminAccount("qa9b-f5m", "QA9b F5 Mod");
    const context = await contextFor(browser, mod);
    const page = await context.newPage();
    await page.goto(`/de/admin/reports/listing/${listing}`);
    await page.getByLabel("Anzeige entfernen").check();
    await page.getByLabel("Grund").selectOption({ label: "Betrug oder Betrugsversuch" });
    await page.getByLabel("Begründung für die Betroffenen").fill("Vorkasse per Gutschein verlangt.");
    await page.getByRole("button", { name: "Meldungen erledigen" }).click();
    await expect(page).toHaveURL("/de/admin/reports?notice=resolved", { timeout: 5_000 });
    await context.close();
  });

  test("axe, rohe Schlüssel und 360 px: neue Konto- und Admin-Seiten in en/cs/pl", async ({ browser }) => {
    test.setTimeout(600_000);
    const owner = await createAccount("qa9b-a11y", "QA9b Barrierefrei", created);
    const listing = await createPublicListing(owner.id, "QA9b A11y-Anzeige");
    const reporter = await createAccount("qa9b-a11yr", "QA9b Melderin", created);
    const mod = await adminAccount("qa9b-a11ym", "QA9b Admin");
    const modB = await adminAccount("qa9b-a11yb", "QA9b Admin B");
    // Daten für alle Seiten: Antrag, Meldung mit Entscheidung, Sperre mit Beschwerde
    const begun = (await owner.client.rpc("begin_verification", { p_document_type: "jagdschein" })).data as { id: string; path: string };
    await owner.client.storage.from("verification-docs").upload(begun.path, new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0xff, 0xd9]), { contentType: "image/jpeg" });
    await owner.client.rpc("submit_verification", { p_id: begun.id });
    await reporter.client.from("reports").insert({ target_type: "listing", target_id: listing, reason: "weapons", note: "QA9b Notiz" });
    await reporter.client.from("reports").insert({ target_type: "profile", target_id: owner.id, reason: "harassment" });
    await modB.client.rpc("admin_warn_account", { p_user_id: owner.id, p_code: "spam", p_note: "QA9b Verwarnung mit längerer Begründung" });
    const decision = ((await owner.client.rpc("my_decisions")).data ?? [])[0] as { id: string };
    const appeal = (await owner.client.rpc("submit_appeal", { p_decision_id: decision.id, p_text: "QA9b Beschwerde mit genug Text." })).data as string;

    const ownerContext = await contextFor(browser, owner, true);
    const reporterContext = await contextFor(browser, reporter, true);
    const modContext = await contextFor(browser, mod, true);
    const pages: [Page, string[]][] = [
      [await ownerContext.newPage(), ["account/verification", "account/decisions", `account/decisions/${decision.id}/appeal`, "account/decisions?notice=appealed"]],
      [await reporterContext.newPage(), ["account/reports", "account/reports?notice=sent", `account/report/listing/${listing}`, `account/report/profile/${owner.id}`,
        `account/report/listing/${listing}?error=goodFaith`]],
      [await modContext.newPage(), ["admin", "admin/verifications", `admin/verifications/${begun.id}`, "admin/reports", `admin/reports/listing/${listing}`,
        `admin/reports/profile/${owner.id}`, "admin/users", `admin/users/${owner.id}`, "admin/appeals", `admin/appeals/${appeal}`, "admin/audit"]],
    ];
    for (const [page, paths] of pages) {
      await page.setViewportSize({ width: 360, height: 800 });
      for (const lang of ["en", "cs", "pl"]) {
        for (const path of paths) {
          const label = `${lang}/${path}`;
          const response = await page.goto(`/${lang}/${path}`);
          expect(response?.status(), label).toBe(200);
          await expect(page.locator("main h1"), label).toBeVisible();
          expect(await page.locator("main").innerText(), `${label} roher Schlüssel`).not.toMatch(RAW_KEY);
          await axe(page, label);
          await noOverflow(page, label);
        }
      }
    }
    await Promise.all([ownerContext.close(), reporterContext.close(), modContext.close()]);
    await admin().storage.from("verification-docs").remove([begun.path]);
  });
});
