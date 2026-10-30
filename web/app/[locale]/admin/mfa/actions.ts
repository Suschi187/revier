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

/** Code prüfen; danach aal2 und weiter zum Ziel im Admin-Bereich. */
export async function confirmTotp(form: FormData): Promise<void> {
  const locale = localeOf(form);
  await requireAdminRole(locale, `/${locale}/admin/mfa`);
  const factorId = String(form.get("factorId") ?? "");
  const code = String(form.get("code") ?? "").replace(/\s/g, "");
  const next = safeNextPath(form.get("next"), locale);
  const target = next.startsWith(`/${locale}/admin`) ? next : `/${locale}/admin`;
  if (!UUID.test(factorId) || !/^\d{6}$/.test(code) || !(await verifyTotp(factorId, code))) {
    redirect(`/${locale}/admin/mfa?error=code&next=${encodeURIComponent(target)}`);
  }
  redirect(target);
}
