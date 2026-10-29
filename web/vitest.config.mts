import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    include: ["**/*.test.ts"],
    // API-Tests gegen die lokale Supabase laufen separat: npm run test:integration
    exclude: ["node_modules/**", ".next/**", "integration/**"],
  },
});
