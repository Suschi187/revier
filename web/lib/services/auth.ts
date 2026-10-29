import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { AppLocale } from "@/i18n/routing";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type SessionUser = { id: string; email: string | null };

/**
 * Aktueller Nutzer aus dem JWT (Signatur lokal per JWKS geprüft, ADR 010). Genügt für Lesen und
 * Navigation, weil Rechte über RLS laufen. Logout/Sperre wirken erst nach Ablauf des JWT.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims || typeof claims.sub !== "string") return null;
  return { id: claims.sub, email: typeof claims.email === "string" ? claims.email : null };
});

export async function requireSessionUser(locale: AppLocale, path: string): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect(`/${locale}/login?next=${encodeURIComponent(path)}`);
  return user;
}

/**
 * Für sicherheitskritische Aktionen (Admin M4, Account löschen M9): fragt Supabase Auth direkt,
 * damit Logout, Sperre und Löschung sofort wirken.
 */
export async function getVerifiedUser(): Promise<SessionUser | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}

export async function signOutCurrentSession(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut({ scope: "local" });
}

export type ConfirmResult = "ok" | "invalid";

/** token_hash aus dem Mail-Link, nur per POST (ADR 010: Mail-Scanner öffnen Links per GET). */
export async function confirmEmailToken(tokenHash: string): Promise<ConfirmResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({ type: "email", token_hash: tokenHash });
  return error ? "invalid" : "ok";
}

/** PKCE-Code aus dem OAuth-Rücksprung (Apple). */
export async function exchangeOAuthCode(code: string): Promise<ConfirmResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  return error ? "invalid" : "ok";
}
