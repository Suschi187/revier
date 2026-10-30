import "server-only";
import { forbidden, redirect } from "next/navigation";
import type { AppLocale } from "@/i18n/routing";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getVerifiedUser, type SessionUser } from "./auth";

// Admin-Bereich (ADR 014). Autoritativ prüft jede Seite und jede Server Action selbst; der Proxy ist nur
// eine zusätzliche Schicht. getUser() statt Claims, damit Sperre und Logout sofort wirken (ADR 010).

type Access = { hasRole: boolean; aal2: boolean };

async function access(): Promise<Access> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_access").single();
  return { hasRole: !error && data?.has_role === true, aal2: !error && data?.aal2 === true };
}

async function verified(locale: AppLocale, path: string): Promise<SessionUser> {
  const user = await getVerifiedUser();
  if (!user) redirect(`/${locale}/login?next=${encodeURIComponent(path)}`);
  return user;
}

/** Admin mit 2FA (aal2), sonst 403 bzw. zur 2FA-Seite. Für alle Seiten und Actions unter /admin. */
export async function requireAdmin(locale: AppLocale, path: string): Promise<SessionUser> {
  const user = await verified(locale, path);
  const { hasRole, aal2 } = await access();
  if (!hasRole) forbidden();
  if (!aal2) redirect(`/${locale}/admin/mfa?next=${encodeURIComponent(path)}`);
  return user;
}

/** Nur die Rolle, ohne 2FA: ausschließlich für die 2FA-Seite selbst. */
export async function requireAdminRole(locale: AppLocale, path: string): Promise<SessionUser & { aal2: boolean }> {
  const user = await verified(locale, path);
  const { hasRole, aal2 } = await access();
  if (!hasRole) forbidden();
  return { ...user, aal2 };
}

export type TotpFactor = { id: string };

/** Bestätigter TOTP-Faktor des Kontos, falls vorhanden. */
export async function verifiedTotpFactor(): Promise<TotpFactor | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.mfa.listFactors();
  const factor = data?.totp.find((f) => f.status === "verified");
  return factor ? { id: factor.id } : null;
}

export type Enrollment = { factorId: string; qrCode: string; secret: string };

/**
 * Startet die TOTP-Einrichtung (nur per POST, Review B3). Entfernt vorher unbestätigte Faktoren, damit
 * Reloads und Abbrüche das Faktor-Limit nicht füllen. Das Secret geht nur in diese Antwort.
 */
export async function startTotpEnrollment(): Promise<Enrollment | null> {
  const supabase = await createSupabaseServerClient();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  for (const factor of factors?.all ?? []) {
    if (factor.factor_type === "totp" && factor.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: factor.id });
  }
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Revier ${new Date().toISOString()}` });
  if (error || !data) return null;
  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
}

/** Prüft einen Code; danach hat die Session aal2 (neue Cookies setzt der Server-Client). */
export async function verifyTotp(factorId: string, code: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  return !error;
}
