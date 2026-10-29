import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// API-Tests gegen die lokale Supabase (ADR 009, Auflage QA M1). Die Schlüssel kommen zur Laufzeit
// aus `supabase status -o env` und stehen nie im Repo. Nur lokale Instanzen sind erlaubt, damit der
// service_role-Key nie gegen ein Cloud-Projekt eingesetzt wird.

export type LocalSupabase = { url: string; publishableKey: string; serviceKey: string };

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function parseEnvOutput(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const match = /^([A-Z0-9_]+)="?(.*?)"?$/.exec(line.trim());
    if (match) result[match[1]] = match[2];
  }
  return result;
}

/** Liest die lokale Instanz; `null`, wenn die CLI fehlt oder Supabase nicht läuft. */
export function readLocalSupabase(): LocalSupabase | null {
  let output: string;
  try {
    output = execFileSync("supabase", ["status", "-o", "env"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 30_000,
    });
  } catch {
    return null;
  }
  const env = parseEnvOutput(output);
  const url = env.API_URL;
  const publishableKey = env.PUBLISHABLE_KEY || env.ANON_KEY;
  const serviceKey = env.SERVICE_ROLE_KEY || env.SECRET_KEY;
  if (!url || !publishableKey || !serviceKey) return null;
  if (!LOCAL_HOSTS.has(new URL(url).hostname)) {
    throw new Error("API-Tests laufen nur gegen eine lokale Supabase (127.0.0.1/localhost).");
  }
  return { url, publishableKey, serviceKey };
}

export async function isReachable(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/auth/v1/health`, { signal: AbortSignal.timeout(5_000) });
    return response.ok;
  } catch {
    return false;
  }
}
