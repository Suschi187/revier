import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// API-Tests gegen die lokale Supabase (npm run test:integration). Laufen nacheinander, weil sie
// sich ein globales Setup teilen und Auth-Rate-Limits gelten.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    include: ["integration/**/*.test.ts"],
    globalSetup: ["integration/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
