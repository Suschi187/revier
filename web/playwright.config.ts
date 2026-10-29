import { defineConfig, devices } from "@playwright/test";

// Kernflows gegen die lokale Supabase (supabase start) und Mailpit. Lokal wird ein laufender
// Dev-Server wiederverwendet; in CI läuft der Produktions-Build (npm run build vorher).
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: process.env.CI ? "npm run start" : "npm run dev",
    url: "http://localhost:3000/de",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
