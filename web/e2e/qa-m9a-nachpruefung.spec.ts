import { expect, test } from "@playwright/test";
import { deleteTestUsers, local } from "./cleanup";
import { createAccount, signInAs } from "./session";

// QA M9a – Nachprüfung (docs/QA-REPORT.md). F4: Header der Foto-Route (genau eine CSP und Referrer-Policy, Basis-
// Header, auch mit Schrägstrich), andere Pfade unverändert. F5: Tabelle auf /cookies per Tastatur erreichbar und
// benannt in 4 Sprachen. F6: /account/data nennt 12 Abschnitte in 4 Sprachen.

const created: string[] = [];
test.afterAll(() => deleteTestUsers(created));
const ID = "00000000-0000-4000-8000-000000000000";

function count(headers: { name: string; value: string }[], name: string): number {
  return headers.filter((h) => h.name.toLowerCase() === name).length;
}

test("F4: Foto-Route mit genau einer CSP und no-referrer, Basis-Header, auch mit Schrägstrich und für ungültige IDs", async ({ request }) => {
  for (const path of [`/api/account/photos/${ID}`, `/api/account/photos/${ID}/`, "/api/account/photos/x"]) {
    const r = await request.get(path, { maxRedirects: 0 });
    const h = r.headersArray();
    expect(count(h, "content-security-policy"), path).toBe(1);
    expect(count(h, "referrer-policy"), path).toBe(1);
    expect(r.headers()["referrer-policy"], path).toBe("no-referrer");
    expect(r.headers()["x-frame-options"], path).toBe("DENY");
    expect(r.headers()["x-content-type-options"], path).toBe("nosniff");
    expect(r.headers()["permissions-policy"], path).toContain("camera=()");
    expect(r.headers()["cache-control"], path).toBe("private, no-store");
  }
});

test("F4: andere Pfade behalten die allgemeine Referrer-Policy", async ({ request }) => {
  for (const path of [`/api/photos/${ID}`, `/api/account/photos/${ID}/x`, "/api/account/photosx/1", "/api/sources/postal-codes", "/de/account/data", "/de"]) {
    const r = await request.get(path, { maxRedirects: 0 });
    expect(r.headers()["referrer-policy"], path).toBe("strict-origin-when-cross-origin");
    expect(count(r.headersArray(), "content-security-policy"), path).toBe(1);
  }
  const ex = await request.post("/api/account/export", { maxRedirects: 0 });
  expect(ex.headers()["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  const un = await request.get(`/api/unsubscribe?t=${"0".repeat(64)}`, { maxRedirects: 0 });
  expect(un.headers()["referrer-policy"]).toBe("no-referrer");
});

test("F5: Tabellen-Container auf /cookies ist per Tab erreichbar und in 4 Sprachen benannt", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  for (const lang of ["de", "en", "cs", "pl"]) {
    await page.goto(`/${lang}/cookies`);
    const region = page.locator('div[role="region"][tabindex="0"]');
    await expect(region).toHaveCount(1);
    const label = await region.getAttribute("aria-label");
    expect(label, lang).toBeTruthy();
    expect(label, lang).not.toMatch(/^Cookies\./);
    let reached = false;
    for (let i = 0; i < 40 && !reached; i++) {
      await page.keyboard.press("Tab");
      reached = await region.evaluate((el) => el === document.activeElement);
    }
    expect(reached, `${lang}: per Tab erreichbar`).toBe(true);
    // Fokus direkt setzen (die Tab-Folge oben belegt die Erreichbarkeit), dann per Pfeiltaste scrollen.
    await region.focus();
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => region.evaluate((el) => el.scrollLeft), { message: `${lang}: scrollt per Pfeiltaste` }).toBeGreaterThan(0);
  }
});

test("F6: /account/data nennt 12 Abschnitte, ohne rohe Schlüssel, in 4 Sprachen", async ({ page, context }) => {
  test.skip(!local, "Lokale Supabase nötig");
  const user = await createAccount("qa9n-data", "QA9n Daten", created);
  await signInAs(context, user);
  for (const lang of ["de", "en", "cs", "pl"]) {
    await page.goto(`/${lang}/account/data`);
    const items = page.locator("main ul > li");
    await expect(items).toHaveCount(12);
    for (const text of await items.allInnerTexts()) expect(text, lang).not.toMatch(/^DataExport\.|^sections\./);
  }
});
