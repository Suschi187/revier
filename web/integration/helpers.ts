import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Fixture, TestUser } from "./types";

/** Verbindung ohne Testdaten (für das globale Setup). */
export type Conn = Pick<Fixture, "url" | "publishableKey" | "serviceKey">;

const noSession = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } as const;

/** Client mit dem öffentlichen Key, ohne Nutzer (anon). */
export function anonClient(f: Conn): SupabaseClient {
  return createClient(f.url, f.publishableKey, { auth: noSession });
}

/** Client als angemeldeter Nutzer (PostgREST und Storage mit dessen JWT). */
export function userClient(f: Conn, user: TestUser): SupabaseClient {
  return createClient(f.url, f.publishableKey, { accessToken: async () => user.token });
}

/** Admin-Client mit dem lokalen service_role-Key, nur für Aufbau und Abbau. */
export function serviceClient(f: Conn): SupabaseClient {
  return createClient(f.url, f.serviceKey, { auth: noSession });
}

export function uniqueEmail(label: string): string {
  return `it-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;
}

/**
 * Legt einen bestätigten Nutzer per Admin-API an und meldet ihn wie die Web-App passwortlos an
 * (Magic-Link-Token per verifyOtp). Liefert den Client mit echter Session.
 */
export async function createSignedInUser(
  f: Conn,
  label: string,
): Promise<TestUser & { client: SupabaseClient }> {
  const admin = serviceClient(f);
  const email = uniqueEmail(label);
  const created = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (created.error || !created.data.user) throw created.error ?? new Error("createUser");
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) throw link.error;
  const client = createClient(f.url, f.publishableKey, { auth: noSession });
  const verified = await client.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: "email" });
  if (verified.error || !verified.data.session) throw verified.error ?? new Error("verifyOtp");
  return { id: created.data.user.id, email, token: verified.data.session.access_token, client };
}

/** Stimmt den aktuellen Rechtstexten zu (Legal-Gate beim Inserieren, ab M3). */
export async function acceptLegal(client: SupabaseClient): Promise<void> {
  const legal = await client.rpc("legal_status").single<{ terms_version: string; privacy_version: string }>();
  if (legal.error || !legal.data) throw legal.error ?? new Error("legal_status");
  const accepted = await client.rpc("accept_legal", {
    p_terms_version: legal.data.terms_version, p_privacy_version: legal.data.privacy_version, p_source: "web",
  });
  if (accepted.error) throw accepted.error;
}

/**
 * Löscht Testkonten (cascade) und deren Audit-Einträge. Audit-Zeilen bleiben bei echten
 * Löschungen pseudonymisiert erhalten (ADR 008); Testreste würden aber die globalen Zählungen
 * der pgTAP-Tests verfälschen.
 */
export async function deleteUsers(f: Conn, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const admin = serviceClient(f);
  const { error } = await admin.from("audit_log").delete().in("target_id", ids);
  if (error) throw new Error(`Audit-Einträge der Testnutzer: ${error.message}`);
  for (const id of ids) await admin.auth.admin.deleteUser(id);
  // Das Löschen entfernt per Kaskade auch Rollen; der Trigger protokolliert das (ADR 014) und erzeugt neue Zeilen.
  await admin.from("audit_log").delete().in("target_id", ids);
}

type RestOptions = {
  token?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
};

/** Roher PostgREST-Aufruf, damit Header wie Accept-Profile und Prefer: count=exact prüfbar sind. */
export async function rest(f: Conn, path: string, options: RestOptions = {}): Promise<Response> {
  const headers: Record<string, string> = { apikey: f.publishableKey, ...options.headers };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  return fetch(`${f.url}/rest/v1/${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

/** Gesamtzahl aus `Content-Range` (z. B. `*\/0` oder `0-0/1`) bei `Prefer: count=exact`. */
export async function exactCount(f: Conn, path: string, token?: string): Promise<number | null> {
  const response = await rest(f, path, { token, method: "HEAD", headers: { Prefer: "count=exact" } });
  const total = response.headers.get("content-range")?.split("/")[1];
  return total === undefined || total === "*" ? null : Number(total);
}

export const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);

export function jpeg(marker = 0): Blob {
  const bytes = new Uint8Array(JPEG);
  bytes[bytes.length - 3] = marker;
  return new Blob([bytes], { type: "image/jpeg" });
}
