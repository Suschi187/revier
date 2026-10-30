"use server";

import { redirect } from "next/navigation";
import { isAppLocale, safeNextPath } from "@/lib/auth/paths";
import { requireAdminRole, startTotpEnrollment, verifyTotp, type Enrollment } from "@/lib/services/admin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function localeOf(form: FormData) {
  const raw = String(form.get("locale") ?? "");
  return isAppLocale(raw) ? raw : "de";
}

export type EnrollState = { enrollment: Enrollment | null; error: "setup" | null };

/** Einrichtung nur per POST (Review B3); das Secret steht nur in dieser Antwort. */
export async function startEnrollment(_previous: EnrollState, form: FormData): Promise<EnrollState> {
  const locale = localeOf(form);
  const user = await requireAdminRole(locale, `/${locale}/admin/mfa`);
  if (user.aal2) redirect(`/${locale}/admin`);
  const enrollment = await startTotpEnrollment();
  return enrollment ? { enrollment, error: null } : { enrollment: null, error: "setup" };
}

type Checked = { target: string; ok: boolean };

async function checkCode(form: FormData): Promise<Checked> {
  const locale = localeOf(form);
  await requireAdminRole(locale, `/${locale}/admin/mfa`);
  const factorId = String(form.get("factorId") ?? "");
  const code = String(form.get("code") ?? "").replace(/\s/g, "");
  const next = safeNextPath(form.get("next"), locale);
  const target = next.startsWith(`/${locale}/admin`) ? next : `/${locale}/admin`;
  const ok = UUID.test(factorId) && /^\d{6}$/.test(code) && (await verifyTotp(factorId, code));
  return { target, ok };
}

/** Code für einen bestehenden Faktor prüfen; danach aal2 und weiter zum Ziel im Admin-Bereich. */
export async function confirmTotp(form: FormData): Promise<void> {
  const { target, ok } = await checkCode(form);
  if (!ok) redirect(`/${localeOf(form)}/admin/mfa?error=code&next=${encodeURIComponent(target)}`);
  redirect(target);
}

export type ConfirmState = { error: "code" | null };

/** Ersteinrichtung bestätigen: Bei falschem Code bleiben Faktor, QR-Code und Schlüssel stehen (QA M4 F2). */
export async function confirmEnrollment(_previous: ConfirmState, form: FormData): Promise<ConfirmState> {
  const { target, ok } = await checkCode(form);
  if (!ok) return { error: "code" };
  redirect(target);
}
