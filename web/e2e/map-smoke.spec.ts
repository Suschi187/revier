import { expect, test } from "@playwright/test";

// WebGL im Testbrowser (ADR 016, Review A11): Ohne WebGL zeigt die Karte nur eine Meldung. Fällt WebGL aus, ist das
// ein roter Test, keine stille Lücke.
test("WebGL2 ist im Testbrowser verfügbar", async ({ page }) => {
  await page.goto("/de");
  const webgl = await page.evaluate(() => document.createElement("canvas").getContext("webgl2") !== null);
  expect(webgl).toBe(true);
});

test("Kartendateien sind versioniert und lange cachebar, ohne fremde URLs", async ({ request }) => {
  const style = await request.get("/static/map/style-de.v5.7.2.json");
  expect(style.status()).toBe(200);
  expect(style.headers()["cache-control"]).toContain("immutable");
  expect(await style.text()).not.toMatch(/https?:\/\//);
  const glyphs = await request.get("/static/map/fonts/Noto%20Sans%20Regular/256-511.pbf");
  expect(glyphs.status()).toBe(200);
});

test("Kachel-Route: nur gültige Namen, Bereiche mit 206 oder 416", async ({ request }) => {
  // Pfad-Traversal lehnt schon Next ab (400), sonst die Route (404).
  expect([400, 404]).toContain((await request.get("/tiles/..%2F..%2Fpackage.json")).status());
  expect((await request.get("/tiles/Gross.pmtiles")).status()).toBe(404);
  expect((await request.get("/tiles/nicht-vorhanden.pmtiles")).status()).toBe(404);
  const fixture = await request.head("/tiles/basemap-fixture.pmtiles");
  test.skip(fixture.status() === 404, "Keine Fixture-Kacheln (npm run map:download -- --fixture)");
  const part = await request.get("/tiles/basemap-fixture.pmtiles", { headers: { Range: "bytes=0-126" } });
  expect(part.status()).toBe(206);
  expect(part.headers()["content-range"]).toMatch(/^bytes 0-126\/\d+$/);
  expect(part.headers()["content-encoding"]).toBeUndefined();
  expect((await part.body()).subarray(0, 7).toString()).toBe("PMTiles");
  expect((await request.get("/tiles/basemap-fixture.pmtiles", { headers: { Range: "bytes=0-1,5-9" } })).status()).toBe(416);
});
