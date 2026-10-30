import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";

// Nur für Tests (Integration und E2E): TOTP nach RFC 6238 mit node:crypto statt eines Pakets (Plan M4 7),
// MFA-Einrichtung per supabase-js und Rollen per `supabase db query --local` (nie gegen die Cloud).

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of input.replace(/=+$/, "").toUpperCase()) {
    const value = alphabet.indexOf(char);
    if (value < 0) throw new Error("Ungültiges Base32");
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** 6-stelliger TOTP-Code (SHA-1, 30 s) für ein Base32-Secret. */
export function totp(secret: string, at = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const hmac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, "0");
}

/** Wartet bis zum nächsten 30-s-Fenster: Supabase nimmt denselben Code nicht zweimal an (Review A12). */
export async function nextTotpWindow(): Promise<void> {
  const rest = 30_000 - (Date.now() % 30_000);
  await new Promise((resolve) => setTimeout(resolve, rest + 200));
}

/** Richtet TOTP ein und bestätigt es; die Session des Clients ist danach aal2. Liefert Secret und Faktor. */
export async function enrollTotp(client: SupabaseClient): Promise<{ factorId: string; secret: string; accessToken: string }> {
  const enrolled = await client.auth.mfa.enroll({ factorType: "totp" });
  if (enrolled.error) throw enrolled.error;
  const { id: factorId, totp: { secret } } = enrolled.data;
  const verified = await client.auth.mfa.challengeAndVerify({ factorId, code: totp(secret) });
  if (verified.error) throw verified.error;
  return { factorId, secret, accessToken: verified.data.access_token };
}

/** Frische TOTP-Bestätigung (Step-up) im nächsten Zeitfenster; liefert das neue Access-Token. */
export async function stepUp(client: SupabaseClient, factorId: string, secret: string): Promise<string> {
  await nextTotpWindow();
  const verified = await client.auth.mfa.challengeAndVerify({ factorId, code: totp(secret) });
  if (verified.error) throw verified.error;
  return verified.data.access_token;
}

/** SQL gegen die lokale Datenbank (Rollen setzen, Testdaten), nur `--local`. */
export function localSql(sql: string): void {
  execFileSync("supabase", ["db", "query", "--local", sql], { cwd: REPO_ROOT, stdio: ["ignore", "ignore", "pipe"], timeout: 60_000 });
}

/** Admin-Rolle per SQL wie im Runbook, Ernennung `daysAgo` zurückdatiert (Karenz, ADR 014). */
export function makeAdmin(userId: string, daysAgo = 30): void {
  if (!/^[0-9a-f-]{36}$/.test(userId)) throw new Error("user id");
  localSql(
    `insert into private.user_roles (user_id, role, created_at) values ('${userId}', 'admin', now() - interval '${Math.trunc(daysAgo)} days') on conflict do nothing`,
  );
}
