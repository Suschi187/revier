import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { deleteTestUsers, local } from "./cleanup";
import { createAccount, createPublicListing, signInAs, type TestAccount } from "./session";
import { publicPath } from "../lib/public/paths";
import { routing, type AppLocale } from "../i18n/routing";

// SPEC M10a Schritt 5 und 8: Textlängen in de, en, cs und pl bei 360 px. Keine Überbreite, kein Element ragt aus dem
// Bild (Großbuchstaben-Überschriften, Buttons, Chips), keine rohen Schlüssel. Waagerecht scrollende Bereiche
// (Cookie-Tabelle, Bildleisten) sind ausgenommen, ebenso Elemente, die nur für Screenreader da sind. Dazu axe
// (WCAG 2 A/AA) auf jeder Seite in jeder Sprache. Mit M10A_SCREENS=1 entstehen Bildschirmfotos in 360, 768 und
// 1280 px unter test-results/m10a-screens/ (Schritt 8, Sichtprüfung und Vergleich mit dem Shop).

const created: string[] = [];
const SCREENS = process.env.M10A_SCREENS === "1";
const WIDTHS = [360, 768, 1280];
test.afterAll(() => deleteTestUsers(created));
test.describe.configure({ mode: "serial" });

async function check(page: Page, url: string) {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
  const result = await page.evaluate(() => {
    const width = window.innerWidth;
    const clipped: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      if (el.closest("[hidden], .sr-only, [aria-hidden=true], .overflow-x-auto, [role=region], dialog:not([open]), template, script, style")) continue;
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || style.position === "fixed") continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.right > width + 1 || rect.left < -1) clipped.push(`${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 40)}" ${Math.round(rect.left)}–${Math.round(rect.right)}`);
    }
    return { scroll: document.documentElement.scrollWidth, clipped: clipped.slice(0, 5), text: document.body.innerText, lang: document.documentElement.lang };
  });
  expect(result.scroll, `${url}: Überbreite`).toBeLessThanOrEqual(360);
  expect(result.clipped, `${url}: Elemente ragen aus dem Bild`).toEqual([]);
  expect(result.text, `${url}: rohe Schlüssel`).not.toMatch(/\b[A-Z][a-zA-Z]+\.[a-z][a-zA-Z]+\.[a-z][a-zA-Z.]*\b/);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).exclude(".maplibregl-canvas").analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`), `${url}: axe`).toEqual([]);
  if (SCREENS) {
    const name = url.replace(/^\/(\w\w)/, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 60) || "start";
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({ path: `test-results/m10a-screens/${result.lang}/${name}-${width}.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 360, height: 800 });
  }
}

test.describe("M10a Schritt 5 und 8: Textlängen bei 360 px, axe, Bildschirmfotos", () => {
  test.skip(!local, "Lokale Supabase nötig");

  let user: TestAccount;
  let listing = "";

  test.beforeAll(async () => {
    user = await createAccount("m10a-text", "Wąska Szerokość Žluťoučký", created);
    listing = await createPublicListing(user.id, "Begehungsschein im Feldrevier mit Hochsitz und langem Titel zur Probe");
  });

  for (const locale of routing.locales as readonly AppLocale[]) {
    test(`${locale}: öffentliche Seiten`, async ({ page }) => {
      test.setTimeout(SCREENS ? 600_000 : 180_000);
      await page.setViewportSize({ width: 360, height: 800 });
      const pages = [
        publicPath({ route: "home" }, locale),
        publicPath({ route: "kind", kind: "lease" }, locale),
        publicPath({ route: "state", kind: "driven_hunt", state: "bayern" }, locale),
        `${publicPath({ route: "search" }, locale)}?q=revier`,
        publicPath({ route: "listing", id: listing }, locale),
        publicPath({ route: "provider", id: user.id }, locale),
        `/${locale}/login`,
        `/${locale}/privacy`,
        `/${locale}/terms`,
        `/${locale}/guidelines`,
        `/${locale}/cookies`,
        `/${locale}/sources`,
        `/${locale}/gibt-es-nicht/a/b/c`,
      ];
      for (const url of pages) await check(page, url);
    });

    test(`${locale}: Konto, Inserieren, Nachrichten`, async ({ page, context }) => {
      test.setTimeout(SCREENS ? 600_000 : 180_000);
      await page.setViewportSize({ width: 360, height: 800 });
      await signInAs(context, user);
      const pages = ["/account", "/account/listings", "/account/listings/new", "/account/messages", "/account/favorites", "/account/searches",
        "/account/profile", "/account/verification", "/account/blocked", "/account/reports", "/account/decisions", "/account/data", "/account/delete"];
      for (const path of pages) await check(page, `/${locale}${path}`);
    });
  }
});
