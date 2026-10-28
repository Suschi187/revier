// M0-Akzeptanz "Supabase-Verbindung funktioniert":
// prüft mit URL und anon-Key aus .env.local, dass Supabase erreichbar ist und den Key akzeptiert.
import { publicKeyProblem } from "../lib/supabase/key.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const missing = Object.entries({
  NEXT_PUBLIC_SUPABASE_URL: url,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
})
  .filter(([, value]) => !value)
  .map(([name]) => name);

if (missing.length > 0) {
  console.error(`Fehlt: ${missing.join(", ")} (siehe web/.env.example).`);
  process.exit(1);
}

const keyProblem = publicKeyProblem(anonKey);
if (keyProblem) {
  console.error(`NEXT_PUBLIC_SUPABASE_ANON_KEY ${keyProblem}.`);
  process.exit(1);
}

const checks = [
  { name: "Auth erreichbar", path: "/auth/v1/health" },
  // Die Storage-API lehnt ungültige Keys ab (Auth-Settings und REST-Root tun das lokal nicht).
  { name: "anon-Key akzeptiert", path: "/storage/v1/bucket" },
];

let failed = false;
for (const { name, path } of checks) {
  try {
    const res = await fetch(new URL(path, url), {
      headers: { apikey: anonKey },
      signal: AbortSignal.timeout(5000),
    });
    console.log(`${res.ok ? "✓" : "✗"} ${name} (${path}): HTTP ${res.status}`);
    failed ||= !res.ok;
  } catch (error) {
    console.log(`✗ ${name} (${path}): ${error.cause?.code ?? error.message}`);
    failed = true;
  }
}

if (failed) {
  console.error(`Supabase unter ${url} nicht erreichbar oder Key ungültig. Läuft \`supabase start\`?`);
  process.exit(1);
}
