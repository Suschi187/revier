import { expect, test } from "@playwright/test";

// M10 Web-Release (docs/WEB-RELEASE.md): Gesundheitsprüfung für den Uptime-Check. Läuft auch gegen Stage (BASE_URL).

test("/api/health: 200 mit Supabase, nie gecacht, ohne Cookies und ohne Interna", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ ok: true, supabase: "ok" });
  const headers = response.headers();
  expect(headers["cache-control"]).toBe("no-store");
  expect(headers["x-robots-tag"]).toContain("noindex");
  expect(headers["set-cookie"]).toBeUndefined();
});
