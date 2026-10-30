"use server";

import { redirect } from "next/navigation";
import { isAppLocale } from "@/lib/auth/paths";
import { changeAdminRole, findCandidate, requireAdmin } from "@/lib/services/admin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function localeOf(form: FormData) {
  const raw = String(form.get("locale") ?? "");
  return isAppLocale(raw) ? raw : "de";
}

/** Konto per exakter E-Mail suchen (POST, damit die Adresse nie in URL oder Logs steht). */
export async function findAdminCandidate(form: FormData): Promise<void> {
  const locale = localeOf(form);
  const page = `/${locale}/admin/admins`;
  await requireAdmin(locale, page);
  const email = String(form.get("email") ?? "").trim().slice(0, 320);
  const found = email ? await findCandidate(email) : null;
  if (found === "limit") redirect(`${page}?error=limit`);
  if (!found) redirect(`${page}?error=notFound`);
  redirect(`${page}?candidate=${found.userId}`);
}

/** Ernennen oder Entziehen mit frischem TOTP-Code (Step-up, ADR 014). */
export async function changeRole(form: FormData): Promise<void> {
  const locale = localeOf(form);
  const page = `/${locale}/admin/admins`;
  await requireAdmin(locale, page);
  const change = form.get("change") === "revoke" ? "revoke" : "grant";
  const userId = String(form.get("userId") ?? "");
  const code = String(form.get("code") ?? "").replace(/\s/g, "");
  if (!UUID.test(userId)) redirect(`${page}?error=failed`);
  if (!/^\d{6}$/.test(code)) redirect(`${page}?error=code${change === "grant" ? `&candidate=${userId}` : ""}`);
  const result = await changeAdminRole(change, userId, code);
  if (result.ok) redirect(`${page}?notice=${change === "grant" ? "granted" : "revoked"}`);
  const until = result.until && !Number.isNaN(Date.parse(result.until)) ? `&until=${encodeURIComponent(result.until)}` : "";
  redirect(`${page}?error=${result.error}${until}${change === "grant" ? `&candidate=${userId}` : ""}`);
}
