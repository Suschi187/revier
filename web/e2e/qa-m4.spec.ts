import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { admin, deleteTestUsers, local } from "./cleanup";
import { uniqueEmail } from "./mailpit";
import { makeAdmin, totp } from "../integration/totp";

// QA M4 (docs/QA-REPORT.md, Abschnitt „M4 – Abnahme“): ergänzende Prüfungen zum Admin-Bereich.
// - Kodierte Schreibweisen von /admin landen per 308 auf der kanonischen Form (Status aus dem Proxy, A1, F1)
// - Nonce-CSP auf jedem Weg zu Admin-Seiten (A3)
// - Server Action als Nicht-Admin (A1, fehlte in admin.spec.ts)
// - Datensparsamkeit: fremde Entwürfe in der Prüfansicht (H6)
// - Ohne JavaScript: Entscheidung (Plan 4.1); die TOTP-Einrichtung ist gesperrt und nennt den Grund (F2)
// - Tastatur, 360 px und Texte in en/cs/pl
// Bekannte Fehler sind test.fail (Playwright meldet sie, sobald sie behoben sind). Sessions entstehen per
// Magic-Link-Token in Node (wie integration/helpers.ts), nicht per Mail, damit der Lauf kurz bleibt.
// Am Ende werden alle Testkonten samt Audit-Zeilen gelöscht (pgTAP-Zählungen bleiben stabil).

if (process.env.QA_BASE_URL) test.use({ baseURL: process.env.QA_BASE_URL });

const created: string[] = [];
test.afterAll(() => deleteTestUsers(created));

function anonKey(): string {
  const out = execFileSync("supabase", ["status", "-o", "env"], {
    cwd: path.resolve(process.cwd(), ".."), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 30_000,
  });
  const match = /^(?:ANON_KEY|PUBLISHABLE_KEY)="?([^"\n]+)"?$/m.exec(out);
  if (!match) throw new Error("ANON_KEY");
  return match[1];
}

type Account = { id: string; email: string; secret?: string };

/** Konto mit Profil und Zustimmung; optional Admin (zurückdatiert) und mit bestätigtem TOTP (aal2). */
async function account(context: BrowserContext, name: string, opts: { admin?: boolean; totp?: boolean } = {}): Promise<Account> {
  const service = admin();
  const email = uniqueEmail("qa-m4");
  created.push(email);
  const { data: user } = await service.auth.admin.createUser({ email, email_confirm: true });
  const id = user.user!.id;
  await service.from("profiles").update({ display_name: name }).eq("user_id", id);
  if (opts.admin) makeAdmin(id);
  const client = createClient(local!.url, anonKey(), { auth: { persistSession: false, autoRefreshToken: false } });
  const link = await service.auth.admin.generateLink({ type: "magiclink", email });
  const verified = await client.auth.verifyOtp({ token_hash: link.data.properties!.hashed_token, type: "email" });
  if (verified.error) throw verified.error;
  let secret: string | undefined;
  if (opts.totp) {
    const enrolled = await client.auth.mfa.enroll({ factorType: "totp" });
    if (enrolled.error) throw enrolled.error;
    secret = enrolled.data.totp.secret;
    const ok = await client.auth.mfa.challengeAndVerify({ factorId: enrolled.data.id, code: totp(secret) });
    if (ok.error) throw ok.error;
  }
  const { data } = await client.auth.getSession();
  await setSessionCookie(context, data.session!);
  return { id, email, secret };
}

/** Session-Cookie wie @supabase/ssr (base64-Präfix, Stücke ab 3180 Zeichen). */
async function setSessionCookie(context: BrowserContext, session: object) {
  const name = `sb-${new URL(local!.url).hostname.split(".")[0]}-auth-token`;
  const value = `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
  const chunks = value.length <= 3180 ? [value] : (value.match(/.{1,3180}/g) ?? []);
  const url = new URL(process.env.QA_BASE_URL ?? "http://localhost:3000").origin;
  await context.addCookies(
    chunks.map((chunk, i) => ({ name: chunks.length === 1 ? name : `${name}.${i}`, value: chunk, url, sameSite: "Lax" as const })),
  );
}

async function pendingListing(title: string, status: "pending_review" | "draft" = "pending_review"): Promise<string> {
  const service = admin();
  const email = uniqueEmail("qa-m4-owner");
  created.push(email);
  const { data: user } = await service.auth.admin.createUser({ email, email_confirm: true });
  await service.from("profiles").update({ display_name: "QA Inserent" }).eq("user_id", user.user!.id);
  const { data: region } = await service.from("regions").select("id").eq("code", "DE-14612").single();
  const { data, error } = await service
    .from("listings")
    .insert({
      owner_id: user.user!.id, kind: "helper", direction: "wanted", title, content_language: "de", region_id: region!.id,
      description: "Privater Text des Inserenten, mehr als dreißig Zeichen lang.", attributes: { tasks: ["Ansitz"] }, status,
    })
    .select("id")
    .single();
  expect(error).toBeNull();
  return data!.id;
}

const ENCODED = ["/de/%61dmin", "/de/%61dmin/listings", "/de/%61dmin/audit", "/de/%61dmin/admins", "/de/admi%6E/mfa"];

test.describe("Admin-Zugang auf Umwegen", () => {
  test.skip(!local, "Lokale Supabase nötig");

  test("Nicht-Admin: kodierter Pfad leitet auf die kanonische Form, dort HTTP 403 (A1, F1)", async ({ page }) => {
    await account(page.context(), "QA Kein Admin");
    for (const pathname of ENCODED) {
      const response = await page.request.get(pathname, { maxRedirects: 0 });
      expect(response.status(), pathname).toBe(308);
      const target = new URL(response.headers()["location"], "http://x").pathname;
      expect(target, pathname).toBe(decodeURIComponent(pathname));
      const final = await page.request.get(pathname);
      expect(final.status(), pathname).toBe(403);
      expect(await final.text(), pathname).toContain("Kein Zugriff");
    }
  });

  test("Anonym: kodierter Pfad leitet per HTTP zur Anmeldung", async ({ page }) => {
    const response = await page.request.get("/de/%61dmin/listings", { maxRedirects: 0 });
    expect(response.status()).toBe(308);
    const login = await page.request.get(response.headers()["location"], { maxRedirects: 0 });
    expect(login.status()).toBe(307);
    expect(login.headers()["location"]).toContain("/de/login");
  });

  test("Admin: kodierter Pfad trägt die Nonce-CSP und noindex-Header (A3)", async ({ page }) => {
    await account(page.context(), "QA Admin CSP", { admin: true, totp: true });
    const id = await pendingListing("QA CSP Umweg");
    const ok = await page.request.get(`/de/admin/listings/${id}`);
    expect(ok.status()).toBe(200);
    expect(ok.headers()["content-security-policy"]).toMatch(/'nonce-/);
    for (const pathname of [`/de/%61dmin/listings/${id}`, `/de//admin/listings/${id}`, `/de%2Fadmin/listings/${id}`]) {
      const response = await page.request.get(pathname);
      expect(response.url(), pathname).toMatch(new RegExp(`/de/admin/listings/${id}$`));
      expect(await response.text()).toContain("QA CSP Umweg");
      expect(response.headers()["content-security-policy"]).toMatch(/script-src 'nonce-[^']+' 'strict-dynamic'/);
      expect(response.headers()["x-robots-tag"]).toBe("noindex");
    }
  });

  test("Server Action „Entscheidung“ als Nicht-Admin wird abgelehnt (A1)", async ({ browser }) => {
    const adminContext = await browser.newContext();
    const userContext = await browser.newContext();
    await account(adminContext, "QA Admin Action", { admin: true, totp: true });
    await account(userContext, "QA Angreifer");
    const id = await pendingListing("QA Action fremd");
    const html = await (await adminContext.request.get(`/de/admin/listings/${id}`)).text();
    const decisionForm = html.slice(html.indexOf('id="decision"'));
    const actionId = /name="\$ACTION_ID_([0-9a-f]+)"/.exec(decisionForm)![1];
    const version = /name="version" value="([0-9a-f]{64})"/.exec(html)![1];
    const base = process.env.QA_BASE_URL ?? "http://localhost:3000";
    for (const pathname of [`/de/admin/listings/${id}`, `/de/%61dmin/listings/${id}`]) {
      const response = await userContext.request.post(pathname, {
        headers: { Origin: base },
        multipart: { [`$ACTION_ID_${actionId}`]: "", locale: "de", id, version, decision: "approve" },
        maxRedirects: 0,
      });
      // kanonisch 403-Rewrite (Action nicht ausgeführt), kodiert 308 auf die kanonische Form
      expect(response.status(), pathname).toBeGreaterThanOrEqual(300);
    }
    const { data } = await admin().from("listings").select("status").eq("id", id).single();
    expect(data!.status).toBe("pending_review");
    await adminContext.close();
    await userContext.close();
  });

  test("Prüfansicht zeigt keine fremden Entwürfe (H6)", async ({ page }) => {
    test.fail(true, "QA M4 F4: Titel und Status eines fremden Entwurfs sind sichtbar");
    await account(page.context(), "QA Admin H6", { admin: true, totp: true });
    const id = await pendingListing("QA geheimer Entwurf", "draft");
    const response = await page.goto(`/de/admin/listings/${id}`);
    expect(response?.status()).toBeLessThan(500);
    await expect(page.getByText("QA geheimer Entwurf")).toHaveCount(0);
  });
});

test.describe("Admin ohne JavaScript", () => {
  test.skip(!local, "Lokale Supabase nötig");
  test.use({ javaScriptEnabled: false });

  test("TOTP-Einrichtung ohne JavaScript: gesperrt mit Hinweis, kein Faktor (F2)", async ({ page }) => {
    const me = await account(page.context(), "QA Admin ohne JS", { admin: true });
    await page.goto("/de/admin/mfa");
    await expect(page.getByRole("button", { name: "Authenticator einrichten" })).toBeDisabled();
    // Playwright blendet <noscript> auch ohne JS aus; der Hinweis wird deshalb im HTML geprüft.
    expect(await page.content()).toMatch(/<noscript>.*Die Einrichtung braucht JavaScript/s);
    const factors = (await admin().auth.admin.mfa.listFactors({ userId: me.id })).data?.factors ?? [];
    expect(factors).toHaveLength(0);
  });

  test("Entscheidung ohne JavaScript: Ablehnen mit Grund, Fehler ohne Grund", async ({ page }) => {
    await account(page.context(), "QA Admin Formular", { admin: true, totp: true });
    const id = await pendingListing("QA ohne JS ablehnen");
    await page.goto(`/de/admin/listings/${id}`);
    await page.getByLabel("Ablehnen").check();
    await page.getByRole("button", { name: "Entscheidung speichern" }).click();
    await expect(page.getByRole("alert")).toContainText("Bitte wähle einen Grund.");
    await page.getByLabel("Ablehnen").check();
    await page.getByLabel("Grund", { exact: true }).selectOption("implausible");
    await page.getByRole("button", { name: "Entscheidung speichern" }).click();
    await expect(page.getByText("Die Anzeige ist abgelehnt.")).toBeVisible();
    const { data } = await admin().from("listings").select("status, reject_code").eq("id", id).single();
    expect(data).toEqual({ status: "rejected", reject_code: "implausible" });
  });
});

type Messages = { Admin: Record<string, Record<string, unknown>>; Moderation: { decisions: Record<string, string> } };
const messages = (locale: string) =>
  JSON.parse(readFileSync(path.resolve(process.cwd(), "messages", `${locale}.json`), "utf8")) as Messages;

async function noOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, label).toBeLessThanOrEqual(0);
}

test.describe("Barrierefreiheit und Sprachen", () => {
  test.skip(!local, "Lokale Supabase nötig");

  test("Entscheidung nur mit der Tastatur", async ({ page }) => {
    await account(page.context(), "QA Admin Tastatur", { admin: true, totp: true });
    const id = await pendingListing("QA Tastatur");
    await page.goto(`/de/admin/listings/${id}`);
    await page.getByLabel("Freigeben").focus();
    await page.keyboard.press("ArrowDown"); // Bearbeitung anfordern
    await expect(page.getByLabel("Bearbeitung anfordern")).toBeChecked();
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Grund", { exact: true })).toBeFocused();
    await page.getByLabel("Grund", { exact: true }).selectOption("incomplete");
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Hinweis an den Inserenten (optional)")).toBeFocused();
    await page.keyboard.type("Bitte Termine ergänzen.");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Entscheidung speichern" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Die Anzeige ist zur Bearbeitung zurückgegeben.")).toBeVisible();
  });

  for (const locale of ["en", "cs", "pl"]) {
    test(`Admin-Seiten in ${locale}: übersetzt, 360 px ohne Überbreite, noindex`, async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 800 });
      await account(page.context(), `QA Admin ${locale}`, { admin: true, totp: true });
      const id = await pendingListing(`QA ${locale} Prüfung mit einem recht langen Titel ohne Umbruchstellen`);
      const m = messages(locale);
      const pages: [string, string][] = [
        [`/${locale}/admin`, String((m.Admin.overview as Record<string, string>).title)],
        [`/${locale}/admin/listings`, String((m.Admin.queue as Record<string, string>).title)],
        [`/${locale}/admin/listings/${id}`, m.Moderation.decisions.request_changes],
        [`/${locale}/admin/audit`, String((m.Admin.audit as Record<string, string>).title)],
        [`/${locale}/admin/admins`, String((m.Admin.admins as Record<string, string>).title)],
      ];
      for (const [pathname, text] of pages) {
        const response = await page.goto(pathname);
        expect(response?.status(), pathname).toBe(200);
        await expect(page.getByText(text, { exact: true }).first(), pathname).toBeVisible();
        await expect(page.locator('meta[name="robots"]'), pathname).toHaveAttribute("content", /noindex/);
        // Keine rohen Schlüssel wie „Admin.review.decision“
        expect(await page.locator("main").innerText(), pathname).not.toMatch(/\b(Admin|Moderation|Listings)\.[a-z]+/);
        expect(await page.locator("html").getAttribute("lang"), pathname).toBe(locale);
        await noOverflow(page, `${pathname} (${locale})`);
      }
    });
  }
});
