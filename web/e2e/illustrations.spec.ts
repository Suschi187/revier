import { expect, test } from "@playwright/test";
import { deleteTestUsers } from "./cleanup";
import { msg } from "./messages";
import { createAccount, createPublicListing } from "./session";
import { publicPath } from "../lib/public/paths";
import { LISTING_KINDS } from "../lib/validation/listing";

// Eigene Illustrationen (docs/DESIGN.md 11): Banner der Startseite, Kopfbild je Kategorie, Vorschaubild (og:image).
// Alle Bilder sind dekorativ (alt=""), werden geladen und sind ein Jahr unveränderlich gecacht.

const created: string[] = [];
test.afterAll(() => deleteTestUsers(created));

test("Startseite: Banner-Illustration geladen, dekorativ, mobil unter dem Text", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/de");
  const banner = page.locator("section[aria-labelledby=home-title]");
  const image = banner.locator("img[src='/static/brand/hero.v1.svg']");
  await expect(image).toHaveAttribute("alt", "");
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  // Mobil liegt das Bild unter dem Button, nicht hinter dem Text.
  const button = await banner.getByRole("link").boundingBox();
  const box = await image.boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(button!.y + button!.height);

  const response = await page.request.get("/static/brand/hero.v1.svg");
  expect(response.headers()["cache-control"]).toBe("public, max-age=31536000, immutable");
});

test("Kategorieseiten: je Art ein eigenes Kopfbild, Unterseiten ohne", async ({ page }) => {
  for (const kind of LISTING_KINDS) {
    await page.goto(publicPath({ route: "kind", kind }, "de"));
    const image = page.locator(`main img[src='/static/brand/kind-${kind}.v1.svg']`);
    await expect(image).toHaveAttribute("alt", "");
    await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  }
  await page.goto(publicPath({ route: "state", kind: "lease", state: "bayern" }, "de"));
  await expect(page.locator("main img[src^='/static/brand/']")).toHaveCount(0);
});

test("Vorschaubild: og:image der Marke mit Alt-Text je Sprache", async ({ page, request }) => {
  for (const locale of ["de", "pl"] as const) {
    await page.goto(`/${locale}`);
    await expect(page.locator("meta[property='og:image']")).toHaveAttribute("content", /\/static\/brand\/og-default\.v1\.png$/);
    await expect(page.locator("meta[property='og:image:alt']")).toHaveAttribute("content", msg(locale, "Metadata.ogImageAlt"));
  }
  const png = await request.get("/static/brand/og-default.v1.png");
  expect(png.headers()["content-type"]).toBe("image/png");
});

test("Anzeige ohne Foto: Vorschaubild der Marke statt keinem Bild", async ({ page }) => {
  const owner = await createAccount("illustrations", "Bild Test", created);
  const id = await createPublicListing(owner.id, "Anzeige ohne Foto für das Vorschaubild");
  await page.goto(publicPath({ route: "listing", id }, "de"));
  await expect(page.locator("meta[property='og:image']")).toHaveAttribute("content", /\/static\/brand\/og-default\.v1\.png$/);
  await expect(page.locator("meta[property='og:title']")).toHaveAttribute("content", "Anzeige ohne Foto für das Vorschaubild");
});
