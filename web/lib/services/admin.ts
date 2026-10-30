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

export type AdminEntry = { userId: string; displayName: string | null; adminSince: string; active: boolean };

export async function listAdmins(): Promise<AdminEntry[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("admin_list_admins");
  return (data ?? []).map((row) => ({ userId: row.user_id, displayName: row.display_name, adminSince: row.admin_since, active: row.active }));
}

export type Candidate = { userId: string; displayName: string; memberSince: string; isAdmin: boolean };

/** Konto per exakter E-Mail (ADR 014, A9); null ohne Treffer. Die E-Mail steht nie in URL oder Ergebnis. */
export async function findCandidate(email: string): Promise<Candidate | null | "limit"> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_find_user", { p_email: email });
  if (error?.code === "54000") return "limit";
  const row = data?.[0];
  return row ? { userId: row.user_id, displayName: row.display_name, memberSince: row.member_since, isAdmin: row.is_admin } : null;
}

/** Gültigkeit einer Kontosuche für die Ernennung; dieselbe Grenze prüft `grant_admin` (QA M4 F3). */
export const LOOKUP_WINDOW_MS = 60 * 60 * 1000;

/**
 * Profil eines Kandidaten für die Bestätigung, nur nach eigener Suche per E-Mail in der letzten Stunde
 * (QA M4 F3): Eine Nutzer-ID in der URL allein zeigt kein Ernennungsformular. Admins lesen Audit und
 * Profile per RLS.
 */
export async function candidateProfile(adminId: string, userId: string): Promise<{ displayName: string; memberSince: string } | null> {
  const supabase = await createSupabaseServerClient();
  const { data: lookup } = await supabase
    .from("audit_log")
    .select("id")
    .eq("action", "user.looked_up")
    .eq("target_type", "profile")
    .eq("target_id", userId)
    .eq("actor_id", adminId)
    .gt("created_at", new Date(Date.now() - LOOKUP_WINDOW_MS).toISOString())
    .limit(1);
  if (!lookup?.length) return null;
  const { data } = await supabase.from("profiles").select("display_name, created_at").eq("user_id", userId).maybeSingle();
  return data ? { displayName: data.display_name, memberSince: data.created_at } : null;
}

export type RoleChangeResult =
  | { ok: true }
  | { ok: false; error: "code" | "stepUp" | "waiting" | "limit" | "lastAdmin" | "lookup" | "notFound" | "forbidden" | "failed"; until?: string };

/**
 * Rolle ändern mit Step-up (Review B2): erst den frischen TOTP-Code bestätigen (neuer Claim amr), dann die
 * RPC mit derselben Session. Die DB prüft das Alter der Bestätigung selbst (RV005).
 */
export async function changeAdminRole(change: "grant" | "revoke", userId: string, code: string): Promise<RoleChangeResult> {
  // Ein Client für beides: Die RPC muss das neue Token mit der frischen Bestätigung tragen.
  const supabase = await createSupabaseServerClient();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factor = factors?.totp.find((f) => f.status === "verified");
  if (!factor || (await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code })).error) return { ok: false, error: "code" };
  const { error } = await supabase.rpc(change === "grant" ? "grant_admin" : "revoke_admin", { p_user_id: userId });
  if (!error) return { ok: true };
  if (error.code === "RV005") return { ok: false, error: "stepUp" };
  if (error.code === "54000") return { ok: false, error: "limit" };
  if (error.code === "P0002") return { ok: false, error: "notFound" };
  if (error.code === "23514") return { ok: false, error: "lastAdmin" };
  if (error.code === "42501") {
    try {
      const hint = JSON.parse(error.hint ?? "{}") as { reason?: string; until?: string };
      if (hint.reason === "waiting_period") return { ok: false, error: "waiting", until: hint.until };
      if (hint.reason === "lookup_required") return { ok: false, error: "lookup" };
    } catch {
      // kein JSON-Hint: allgemeine Ablehnung
    }
    return { ok: false, error: "forbidden" };
  }
  return { ok: false, error: "failed" };
}
