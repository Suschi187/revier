import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { BrowserContext } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { admin, local } from "./cleanup";
import { uniqueEmail } from "./mailpit";

// Gemeinsame Helfer für Chat-Specs (M7): Konto mit Zustimmung anlegen, Sitzung als Cookie setzen, Anzeige
// öffentlich anlegen. Nur gegen die lokale Supabase; Konten räumt deleteTestUsers in afterAll ab.

let anon: string | null = null;
function anonKey(): string {
  if (anon) return anon;
  const out = execFileSync("supabase", ["status", "-o", "env"], {
    cwd: path.resolve(process.cwd(), ".."), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 30_000,
  });
  const match = /^(?:ANON_KEY|PUBLISHABLE_KEY)="?([^"\n]+)"?$/m.exec(out);
  if (!match) throw new Error("ANON_KEY");
  anon = match[1];
  return anon;
}

export type TestAccount = { id: string; email: string; client: SupabaseClient; cookies: { name: string; value: string }[] };

/** Konto mit Anzeigename und Zustimmung zu den aktuellen Rechtstexten, angemeldet per Magic-Link-Hash. */
export async function createAccount(label: string, displayName: string, created: string[]): Promise<TestAccount> {
  const service = admin();
  const email = uniqueEmail(label);
  created.push(email);
  const { data } = await service.auth.admin.createUser({ email, email_confirm: true });
  const id = data.user!.id;
  await service.from("profiles").update({ display_name: displayName }).eq("user_id", id);
  const client = createClient(local!.url, anonKey(), { auth: { persistSession: false, autoRefreshToken: false } });
  const link = await service.auth.admin.generateLink({ type: "magiclink", email });
  await client.auth.verifyOtp({ token_hash: link.data.properties!.hashed_token, type: "email" });
  const { data: legal } = await client.rpc("legal_status").single<{ terms_version: string; privacy_version: string }>();
  await client.rpc("accept_legal", { p_terms_version: legal!.terms_version, p_privacy_version: legal!.privacy_version, p_source: "web" });
  const { data: session } = await client.auth.getSession();
  const name = `sb-${new URL(local!.url).hostname.split(".")[0]}-auth-token`;
  const value = `base64-${Buffer.from(JSON.stringify(session.session)).toString("base64url")}`;
  const chunks = value.length <= 3180 ? [value] : (value.match(/.{1,3180}/g) ?? []);
  return { id, email, client, cookies: chunks.map((chunk, i) => ({ name: chunks.length === 1 ? name : `${name}.${i}`, value: chunk })) };
}

export async function signInAs(context: BrowserContext, account: TestAccount): Promise<void> {
  await context.clearCookies();
  await context.addCookies(account.cookies.map((c) => ({ ...c, url: "http://localhost:3000", sameSite: "Lax" as const })));
}

/** Öffentliche Anzeige (Server-Pfad, nur im Test). */
export async function createPublicListing(ownerId: string, title: string, status: "active" | "paused" = "active"): Promise<string> {
  const service = admin();
  const region = (await service.from("regions").select("id").eq("code", "DE-14628").single()).data!.id as string;
  const { data } = await service
    .from("listings")
    .insert({ owner_id: ownerId, kind: "helper", direction: "wanted", title, content_language: "de", region_id: region, status: "draft" })
    .select("id")
    .single();
  const id = data!.id as string;
  // Status und Laufzeit setzt nur der Server; service_role darf das (Guard, Serverpfad).
  await service.from("listings").update({ status, expires_at: new Date(Date.now() + 30 * 864e5).toISOString() }).eq("id", id);
  return id;
}
