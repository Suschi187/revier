import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { admin, deleteTestUsers, local } from "./cleanup";
import { createAccount, createPublicListing, signInAs } from "./session";
import { localRows, localSql } from "../integration/totp";

// QA M9a – Abnahme (docs/QA-REPORT.md). Header der Export- und Foto-Route (F4), Erreichbarkeit von Löschen und
// Export für gesperrte Konten ohne Zustimmung, Bedienung ohne JavaScript, Rechtstexte als Platzhalter mit noindex,
// /sources indexierbar, Footer, axe und 360 px in en/cs/pl.

const created: string[] = [];
const BASE = "http://localhost:3000";
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);
let setUrl = false;

test.beforeAll(() => {
  if (!local) return;
  if (localRows<{ n: number }>("select count(*)::int as n from vault.secrets where name = 'account_deletion_url'")[0].n === 0) {
    localSql("select vault.create_secret('http://kong:8000/functions/v1/delete-account', 'account_deletion_url')");
    setUrl = true;
  }
});
test.afterAll(async () => {
  if (setUrl) localSql("delete from vault.secrets where name = 'account_deletion_url'");
  await deleteTestUsers(created);
});

async function axe(page: Page, label: string) {
  const { default: AxeBuilder } = await import("@axe-core/playwright");
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(result.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${label} ${v.id}: ${v.nodes.length}`)).toEqual([]);
}
async function noOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, label).toBeLessThanOrEqual(0);
}

test.describe("QA M9a", () => {
  test.skip(!local, "Lokale Supabase nötig");

  test("F4: Foto-Route liefert Referrer-Policy no-referrer (ADR 019)", async ({ request }) => {
    const response = await request.get(`/api/account/photos/${crypto.randomUUID()}`, { maxRedirects: 0 });
    expect(response.headers()["cache-control"]).toBe("private, no-store");
    expect(response.headers()["referrer-policy"]).toBe("no-referrer");
  });

  test("Foto-Route: eigenes unverarbeitetes, fremdes und unbekanntes Foto ergeben dieselbe 404", async ({ context, browser }) => {
    const owner = await createAccount("qa9a-photo-owner", "QA9a Foto", created);
    const other = await createAccount("qa9a-photo-other", "QA9a Fremd", created);
    const listing = await createPublicListing(owner.id, `QA9a Foto ${Date.now()}`);
    const service = admin();
    const pending = (await service.from("listing_photos").insert({ listing_id: listing, sort_order: 0 }).select("id").single()).data!.id as string;
    const done = (await service.from("listing_photos").insert({ listing_id: listing, sort_order: 1, processed_at: new Date().toISOString(), width: 8, height: 8, alt_text: "F" })
      .select("id, storage_path").single()).data!;
    await service.storage.from("listing-photos").upload(done.storage_path as string, JPEG, { contentType: "image/jpeg", upsert: true });
    await signInAs(context, owner);
    const own = await context.request.get(`/api/account/photos/${pending}`, { maxRedirects: 0 });
    const unknown = await context.request.get(`/api/account/photos/${crypto.randomUUID()}`, { maxRedirects: 0 });
    const otherContext = await browser.newContext();
    await signInAs(otherContext, other);
    const foreign = await otherContext.request.get(`/api/account/photos/${done.id}`, { maxRedirects: 0 });
    const shapes = await Promise.all([own, unknown, foreign].map(async (r) => `${r.status()} ${(await r.body()).length} ${r.headers()["content-type"] ?? ""}`));
    expect(new Set(shapes).size).toBe(1);
    expect(own.status()).toBe(404);
    expect((await context.request.get(`/api/account/photos/${done.id}`, { maxRedirects: 0 })).status()).toBe(303);
    await otherContext.close();
    await service.storage.from("listing-photos").remove([done.storage_path as string]);
  });

  test("Export-Route: Origin und Sec-Fetch-Site, nur POST, Header des Downloads, kein Set-Cookie", async ({ context, request }) => {
    const user = await createAccount("qa9a-export", "QA9a Export", created);
    await signInAs(context, user);
    const post = (headers: Record<string, string>) => context.request.post("/api/account/export", { headers, form: { locale: "en" }, maxRedirects: 0 });
    expect((await post({ Origin: BASE, "Sec-Fetch-Site": "cross-site" })).status()).toBe(403);
    expect((await post({ Origin: BASE, "Sec-Fetch-Site": "same-site" })).status()).toBe(403);
    expect((await post({ Origin: "http://localhost:3000.evil.example", "Sec-Fetch-Site": "same-origin" })).status()).toBe(403);
    expect((await post({ Origin: "null" })).status()).toBe(403);
    expect((await context.request.get("/api/account/export", { maxRedirects: 0 })).status()).toBe(405);
    const ok = await post({ Origin: BASE, "Sec-Fetch-Site": "same-origin" });
    expect(ok.status()).toBe(200);
    const h = ok.headers();
    expect(h["content-type"]).toBe("application/json; charset=utf-8");
    expect(h["content-disposition"]).toMatch(/^attachment; filename="revier-export-\d{4}-\d{2}-\d{2}\.json"$/);
    expect(h["cache-control"]).toBe("no-store");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(ok.headersArray().filter((x) => x.name.toLowerCase() === "set-cookie")).toEqual([]);
    // Hinweis H: ohne Sec-Fetch-Site (ältere Clients) genügt der Origin.
    expect((await post({ Origin: BASE })).status()).toBe(200);
    // Ohne Session: 303 zum Login mit Sprache aus dem Formular.
    const anonymous = await request.post("/api/account/export", { headers: { Origin: BASE, "Sec-Fetch-Site": "same-origin" }, form: { locale: "cs" }, maxRedirects: 0 });
    expect(anonymous.status()).toBe(303);
    expect(anonymous.headers()["location"]).toBe("/cs/login?next=%2Fcs%2Faccount%2Fdata");
  });

  test("gesperrt und ohne Zustimmung: Löschen und Export erreichbar, Export lädt herunter", async ({ page, context }) => {
    const user = await createAccount("qa9a-blocked", "QA9a Gesperrt", created);
    await admin().from("profiles").update({ is_blocked: true }).eq("user_id", user.id);
    localSql(`delete from public.legal_acceptances where user_id = '${user.id}'`);
    await signInAs(context, user);
    for (const path of ["/de/account/delete", "/de/account/data"]) {
      const response = await page.goto(path);
      expect(response!.status(), path).toBe(200);
      await expect(page, path).toHaveURL(path);
    }
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Daten herunterladen (JSON)" }).click()]);
    const data = JSON.parse(await readFile((await download.path())!, "utf8"));
    expect(data.profile.is_blocked).toBe(true);
    expect(data.legal_acceptances).toEqual([]);
  });

  test("ohne JavaScript: Export lädt herunter, Löschen mit frischer Anmeldung geht bis zum gelöschten Konto", async ({ browser }) => {
    const user = await createAccount("qa9a-nojs", "QA9a Ohne JS", created);
    const context = await browser.newContext({ javaScriptEnabled: false, acceptDownloads: true });
    await signInAs(context, user);
    const page = await context.newPage();
    await page.goto("/de/account/data");
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Daten herunterladen (JSON)" }).click()]);
    expect(download.suggestedFilename()).toMatch(/^revier-export-/);
    await page.goto("/de/account/delete");
    // Der Code-Schritt braucht JavaScript; der Hinweis steht im noscript. Die Anmeldung aus createAccount ist frisch.
    await expect(page.locator("noscript")).toHaveCount(1);
    await page.getByRole("checkbox", { name: /endgültig gelöscht werden/ }).check();
    await page.getByRole("button", { name: "Konto endgültig löschen" }).click();
    await expect(page).toHaveURL("/de?deleted=1");
    await expect.poll(async () => (await admin().auth.admin.getUserById(user.id)).data.user, { timeout: 20_000 }).toBeNull();
    await context.close();
  });

  test("Rechtstexte: Platzhalter markiert und noindex in 4 Sprachen; /sources indexierbar; Footer mit 6 Links", async ({ page }) => {
    for (const lang of ["de", "en", "cs", "pl"]) {
      for (const slug of ["privacy", "terms", "guidelines", "cookies"]) {
        await page.goto(`/${lang}/${slug}`);
        await expect(page.getByRole("note"), `${lang}/${slug} Platzhalter`).toBeVisible();
        expect(await page.locator('meta[name="robots"]').getAttribute("content"), `${lang}/${slug}`).toMatch(/noindex/);
      }
      await page.goto(`/${lang}/sources`);
      expect(await page.locator('meta[name="robots"]').count(), `${lang}/sources`).toBe(0);
      expect(await page.locator("footer nav a").count(), `${lang} Footer`).toBe(6);
    }
    for (const path of ["/de/gibt-es-nicht", "/de/login", "/de/imprint"]) {
      await page.goto(path);
      expect(await page.locator("footer nav a").count(), path).toBe(6);
    }
  });

  test("axe und 360 px: Löschen, Export, Cookies, Datenquellen, Richtlinien in en/cs/pl", async ({ page, context }) => {
    const user = await createAccount("qa9a-a11y", "QA9a A11y", created);
    await signInAs(context, user);
    await page.setViewportSize({ width: 360, height: 800 });
    for (const lang of ["en", "cs", "pl"]) {
      for (const path of ["account/delete", "account/data", "account/data?error=rate_limited&retry=2026-11-12T10:00:00Z", "account/delete?error=reauth",
        "sources", "guidelines", "privacy"]) {
        await page.goto(`/${lang}/${path}`);
        await expect(page.locator("main h1")).toBeVisible();
        const text = await page.locator("main").innerText();
        expect(text, `${lang}/${path} roher Schlüssel`).not.toMatch(/\b(AccountDelete|DataExport|Cookies|Legal|Sources)\.[a-z]/);
        await axe(page, `${lang}/${path}`);
        await noOverflow(page, `${lang}/${path}`);
      }
    }
  });

  test("F5: /cookies bei 360 px ohne axe-Befund (Tabelle scrollt waagerecht)", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    for (const lang of ["en", "cs", "pl"]) {
      await page.goto(`/${lang}/cookies`);
      await noOverflow(page, `${lang}/cookies`);
      await axe(page, `${lang}/cookies`);
    }
  });
});
