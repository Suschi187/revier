import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { msg } from "./messages";

// VoiceOver-Vorprüfung (2026-11-15): was ein Screenreader vorliest, automatisch geprüft. Ersetzt nicht den Durchgang
// mit VoiceOver selbst (Checkliste in docs/DESIGN.md, Abschnitt Barrierefreiheit), fängt aber Rückschritte ab:
// Sprunglink, je eine Landmark Banner/Main/Contentinfo, nichts außerhalb, H1 als erste Überschrift, Karte nur einmal benannt.

const PAGES = ["/de", "/de/jagdpacht", "/de/suche?q=revier", "/de/suche?view=map", "/de/login", "/de/imprint", "/de/cookies"];

test.describe("VoiceOver-Vorprüfung", () => {
  test("Sprunglink ist das erste Ziel per Tab und führt zum Inhalt", async ({ page }) => {
    for (const locale of ["de", "pl"]) {
      await page.goto(`/${locale}`);
      await page.keyboard.press("Tab");
      const skip = page.getByRole("link", { name: msg(locale, "Header.skipToContent") });
      await expect(skip).toBeFocused();
      await expect(skip).toBeVisible();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/#main$/);
      await expect(page.locator("main#main")).toHaveCount(1);
    }
  });

  test("Landmarks, Überschriften und axe (Best Practice) auf Kernseiten", async ({ page }) => {
    test.setTimeout(180_000);
    for (const url of PAGES) {
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      await expect(page.getByRole("banner"), url).toHaveCount(1);
      await expect(page.getByRole("main"), url).toHaveCount(1);
      await expect(page.getByRole("contentinfo"), url).toHaveCount(1);
      const first = await page.locator("h1, h2, h3").first().evaluate((el) => el.tagName);
      expect(first, `${url}: erste Überschrift`).toBe("H1");
      await expect(page.locator("h1"), url).toHaveCount(1);
      const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa", "best-practice"]).exclude(".maplibregl-canvas").analyze();
      expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`), `${url}: axe`).toEqual([]);
    }
  });

  test("Karte: genau ein benannter Bereich", async ({ page }) => {
    await page.goto("/de/suche?view=map");
    await page.locator(".maplibregl-canvas").waitFor();
    await expect(page.getByRole("region", { name: msg("de", "Map.label") })).toHaveCount(1);
  });
});
