import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // XSS-Hygiene (ADR 010): Session-Cookies sind per JS lesbar. Ausnahmen nur mit begründetem
    // eslint-disable-Kommentar, z. B. escaptes JSON-LD (M5).
    rules: { "react/no-danger": "error" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generiert mit `npm run gen:types`.
    "lib/supabase/database.types.ts",
    // Kopie des MapLibre-Workers aus node_modules (scripts/map-worker.mjs).
    "public/static/map/maplibre-*/**",
    ".cache/**",
  ]),
]);

export default eslintConfig;
