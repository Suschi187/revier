import "server-only";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import type { AppLocale } from "@/i18n/routing";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type SessionUser = {
  id: string;
  email: string | null;
  /** Name von Apple (nur beim ersten Login geliefert); nur zum Vorbelegen im Onboarding. */
  metadataName: string | null;
  /** Claim app_role (ADR 005): nur als UI-Hinweis (Link „Admin“), nie für Rechte. */
  adminHint?: boolean;
};

// Nur der Name, den Apple liefert. user_metadata ist frei setzbar, auch von jemandem, der eine
// fremde Adresse registriert (Review M2, Architekt 7); app_metadata setzt nur Supabase Auth.
function nameFromMetadata(metadata: unknown, appMetadata: unknown): string | null {
  const providers = (appMetadata as { providers?: unknown } | null)?.providers;
  if (!Array.isArray(providers) || !providers.includes("apple")) return null;
  if (typeof metadata !== "object" || metadata === null) return null;
  const record = metadata as Record<string, unknown>;
  const name = record.full_name ?? record.name;
  return typeof name === "string" && name.trim() ? name.trim().slice(0, 60) : null;
}

/**
 * Aktueller Nutzer aus dem JWT (Signatur lokal per JWKS geprüft, ADR 010). Genügt für Lesen und
 * Navigation, weil Rechte über RLS laufen. Logout/Sperre wirken erst nach Ablauf des JWT.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  // Session ist request-spezifisch; die Ablaufprüfung im JWT nutzt die aktuelle Zeit.
  await connection();
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims || typeof claims.sub !== "string") return null;
  return {
    id: claims.sub,
    email: typeof claims.email === "string" ? claims.email : null,
    metadataName: nameFromMetadata(claims.user_metadata, claims.app_metadata),
    adminHint: claims.app_role === "admin",
  };
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
  await connection();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null, metadataName: nameFromMetadata(data.user.user_metadata, data.user.app_metadata) };
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

/** Startet Sign in with Apple (PKCE); liefert die Weiterleitungs-URL zu Supabase/Apple. */
export async function startAppleSignIn(callbackUrl: string): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "apple",
    options: { redirectTo: callbackUrl, skipBrowserRedirect: true },
  });
  return error ? null : data.url;
}

/** PKCE-Code aus dem OAuth-Rücksprung (Apple). */
export async function exchangeOAuthCode(code: string): Promise<ConfirmResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  return error ? "invalid" : "ok";
}
