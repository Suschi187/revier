import { expect, test, type Page, type Route } from "@playwright/test";

// QA M6 Nachprüfung (docs/QA-REPORT.md „M6 – Nachprüfung“): Regressionen durch das Nachladen der Karte (F1):
// keine Schleife nach setData, Entprellung, Kurzkarte ohne Abruf, Rennen alter und neuer Antworten, Fokus nach dem
// Neuladen, Cluster per Tastatur, Hinweis bei mehr als 300 Elementen, Ausschnitt über die Datumsgrenze.
// /api/map wird meist im Browser beantwortet (page.route), damit die Proben ohne Testkonten und unabhängig vom
// Datenstand laufen. Gegen den Produktions-Build mit QA_BASE_URL. Bekannte Abweichungen als test.fail (N-Nummern).

if (process.env.QA_BASE_URL) test.use({ baseURL: process.env.QA_BASE_URL });
test.describe.configure({ mode: "serial" });

type Point = { id: string; title: string; lng: number; lat: number };
const feature = (p: Point) => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [p.lng, p.lat] },
  properties: { id: p.id, title: p.title, kind: "Jagdhelfer", direction: "Gesuch", price: "", approx: "", href: `/de/anzeige/${p.id}` },
});
const body = (points: Point[], truncated = false) => JSON.stringify({ type: "FeatureCollection", features: points.map(feature), truncated });

/** Antwortet auf /api/map mit `answer(n)` (n = laufende Nummer des Abrufs) und zählt die Abrufe. */
async function mockMap(page: Page, answer: (n: number) => { points: Point[]; delayMs?: number; truncated?: boolean }) {
  const calls: { url: string; at: number }[] = [];
  const aborted: string[] = [];
  page.on("requestfailed", (r) => {
    if (r.url().includes("/api/map")) aborted.push(r.url());
  });
  await page.route("**/api/map?**", async (route: Route) => {
    const n = calls.length;
    calls.push({ url: route.request().url(), at: Date.now() });
    const { points, delayMs = 0, truncated = false } = answer(n);
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    await route.fulfill({ status: 200, contentType: "application/geo+json", body: body(points, truncated) }).catch(() => undefined);
  });
  return { calls, aborted };
}

const SAXONY = "13,50.5,14.8,51.4";
const three: Point[] = [
  { id: "00000000-0000-4000-8000-000000000001", title: "QA7 Nord", lng: 13.2, lat: 51.3 },
  { id: "00000000-0000-4000-8000-000000000002", title: "QA7 Mitte", lng: 13.9, lat: 50.95 },
  { id: "00000000-0000-4000-8000-000000000003", title: "QA7 Ost", lng: 14.6, lat: 50.6 },
];

async function ready(page: Page, url: string) {
  await page.goto(url);
  await expect(page.locator(".maplibregl-canvas")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Anzeigen auf der Karte|Zu viele Anzeigen/)).toBeVisible({ timeout: 20_000 });
}

test.describe("QA M6 Nachprüfung", () => {
  test("Keine Nachlade-Schleife: nach dem ersten Abruf bleibt es bei einem Abruf", async ({ page }) => {
    const { calls } = await mockMap(page, () => ({ points: three }));
    await ready(page, `/de/suche?view=map&bbox=${SAXONY}`);
    await expect(page.getByText("3 Anzeigen auf der Karte")).toBeVisible();
    await page.waitForTimeout(4000);
    expect(calls.length).toBe(1);
  });

  test("Entprellung: ein Zoom ein Abruf, vier schnelle Zooms höchstens zwei", async ({ page }) => {
    const { calls } = await mockMap(page, () => ({ points: three }));
    await ready(page, `/de/suche?view=map&bbox=${SAXONY}`);
    await page.waitForTimeout(1000);
    const before = calls.length;
    await page.locator(".maplibregl-ctrl-zoom-out").click();
    await page.waitForTimeout(1500);
    expect(calls.length - before).toBe(1);
    const mid = calls.length;
    for (let i = 0; i < 4; i++) await page.locator(".maplibregl-ctrl-zoom-in").click({ delay: 10 });
    await page.waitForTimeout(2000);
    expect(calls.length - mid).toBeGreaterThanOrEqual(1);
    expect(calls.length - mid).toBeLessThanOrEqual(2);
  });

  test("Kurzkarte: kein Abruf, Fokus bleibt im Dialog", async ({ page }) => {
    const { calls } = await mockMap(page, () => ({ points: three }));
    await ready(page, `/de/suche?view=map&bbox=${SAXONY}`);
    await page.waitForTimeout(1000);
    const marker = page.getByRole("button", { name: /^QA7 Mitte/ });
    await marker.focus();
    const before = calls.length;
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("link").first()).toBeFocused();
    await page.waitForTimeout(2000);
    expect(calls.length).toBe(before);
    await expect(dialog.getByRole("link").first()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator(".map-marker:focus")).toHaveCount(1);
  });

  test("Neuladen mit gleichen Daten (Größenänderung): fokussierter Marker behält den Fokus", async ({ page }) => {
    const { calls } = await mockMap(page, () => ({ points: three }));
    await ready(page, `/de/suche?view=map&bbox=${SAXONY}`);
    await page.waitForTimeout(1000);
    await page.getByRole("button", { name: /^QA7 Mitte/ }).focus();
    const before = calls.length;
    const size = page.viewportSize()!;
    await page.setViewportSize({ width: size.width - 40, height: size.height });
    await page.waitForTimeout(2000);
    test.info().annotations.push({ type: "Abrufe nach Größenänderung", description: String(calls.length - before) });
    await expect(page.getByRole("button", { name: /^QA7 Mitte/ })).toBeFocused();
  });

  test("Rennen: eine langsame ältere Antwort überschreibt die neuere nicht", async ({ page }) => {
    const alt: Point = { id: "00000000-0000-4000-8000-0000000000a1", title: "QA7 Alt", lng: 13.5, lat: 51.0 };
    const neu: Point = { id: "00000000-0000-4000-8000-0000000000b2", title: "QA7 Neu", lng: 13.6, lat: 51.1 };
    const { calls, aborted } = await mockMap(page, (n) => (n === 0 ? { points: three } : n === 1 ? { points: [alt], delayMs: 3000 } : { points: [neu] }));
    await ready(page, `/de/suche?view=map&bbox=${SAXONY}`);
    await page.waitForTimeout(800);
    await page.locator(".maplibregl-ctrl-zoom-out").click();
    await expect.poll(() => calls.length, { timeout: 5000 }).toBe(2);
    await page.locator(".maplibregl-ctrl-zoom-in").click();
    await expect.poll(() => calls.length, { timeout: 5000 }).toBe(3);
    await expect(page.getByRole("button", { name: /^QA7 Neu/ })).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(3500);
    await expect(page.getByRole("button", { name: /^QA7 Neu/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^QA7 Alt/ })).toHaveCount(0);
    await expect(page.getByText("1 Anzeigen auf der Karte")).toBeVisible();
    await expect(page.locator('section[aria-label="Karte der Anzeigen"] [role=alert]')).toHaveCount(0);
    expect(aborted.length).toBeGreaterThanOrEqual(1);
  });

  // N4 (behoben): Der Cluster-Button verschwindet beim Aufklappen; der Fokus geht an den nächstgelegenen neuen Marker.
  test("N4: Cluster per Enter: nach Hineinzoomen und Neuladen liegt der Fokus nicht auf body", async ({ page }) => {
    const near: Point[] = Array.from({ length: 6 }, (_, i) => ({
      id: `00000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`, title: `QA7 Haufen ${i}`, lng: 13.9 + i * 0.01, lat: 50.95 + (i % 2) * 0.01,
    }));
    const { calls } = await mockMap(page, () => ({ points: near }));
    await ready(page, `/de/suche?view=map&bbox=${SAXONY}`);
    await page.waitForTimeout(1000);
    const cluster = page.locator(".map-cluster").first();
    await expect(cluster).toHaveCount(1);
    const before = calls.length;
    await cluster.focus();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(2500);
    expect(calls.length - before).toBe(1);
    const focused = await page.evaluate(() => document.activeElement?.tagName.toLowerCase() ?? "");
    test.info().annotations.push({ type: "Fokus nach Cluster-Enter", description: focused });
    expect(focused).not.toBe("body");
    await expect(page.locator(".map-marker:focus")).toHaveCount(1);
  });

  test("Mehr als 300 Elemente im Ausschnitt: Hinweis statt leerer Karte", async ({ page }) => {
    const grid: Point[] = [];
    for (let i = 0; i < 40; i++) {
      for (let j = 0; j < 30; j++) {
        grid.push({ id: `00000000-0000-4000-8000-${String(i * 100 + j).padStart(12, "0")}`, title: `QA7 Raster ${i}-${j}`,
          lng: 13.695 + i * 0.003, lat: 51.0 + j * 0.0015 });
      }
    }
    await mockMap(page, () => ({ points: grid }));
    await page.goto(`/de/suche?view=map&bbox=13.75,51.02,13.76,51.025`);
    await expect(page.locator(".maplibregl-canvas")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Zu viele Anzeigen für diesen Ausschnitt. Bitte hineinzoomen.")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".map-marker")).toHaveCount(0);
    await expect(page.getByText(/Anzeigen auf der Karte/)).toHaveCount(0);
  });

  // MapLibre bringt die Mitte nach dem Verschieben zurück in ±180°; ein Ausschnitt ganz in einer Weltkopie entsteht nicht.
  test("Datumsgrenze: nach Verschieben über 180° deckt der Abruf den sichtbaren Ausschnitt ab", async ({ page }) => {
    // Ein Punkt je 10° Länge auf 50° Breite: Die gezeichneten Marker zeigen, welche Längen sichtbar sind.
    const ring: Point[] = Array.from({ length: 36 }, (_, i) => ({
      id: `00000000-0000-4000-8000-0000000002${String(i).padStart(2, "0")}`, title: `QA7 Länge ${-180 + i * 10}`, lng: -180 + i * 10, lat: 50,
    }));
    const { calls } = await mockMap(page, () => ({ points: ring }));
    await ready(page, `/de/suche?view=map&bbox=160,40,179.9,60`);
    await page.locator(".maplibregl-canvas").focus();
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(120);
    }
    await page.waitForTimeout(2000);
    const bbox = new URL(calls.at(-1)!.url).searchParams.get("bbox")!.split(",").map(Number);
    const visible = (await page.locator(".map-marker").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? "")))
      .map((label) => Number(/Länge (-?\d+)/.exec(label)?.[1]));
    test.info().annotations.push({ type: "Bereich und sichtbare Längen", description: JSON.stringify({ bbox, visible }) });
    if (process.env.QA_VERBOSE) console.log(JSON.stringify({ calls: calls.map((c) => new URL(c.url).searchParams.get("bbox")), visible }));
    // Die Mitte des abgefragten Bereichs liegt im sichtbaren Längenbereich.
    expect(visible.length).toBeGreaterThan(0);
    const mid = (bbox[0] + bbox[2]) / 2;
    expect(Math.min(...visible) - 10 <= mid && mid <= Math.max(...visible) + 10, JSON.stringify({ bbox, visible })).toBe(true);
  });

});
