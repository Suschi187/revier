"use server";

import { redirect } from "next/navigation";
import { isAppLocale } from "@/lib/auth/paths";
import { accountActionSchema } from "@/lib/reports";
import { requireAdmin } from "@/lib/services/admin";
import { findAccount, setAccountBlocked, warnAccount } from "@/lib/services/admin-reports";
import { invalidatePublicProvider } from "@/lib/services/public-cache";

// Konten suchen, sperren, entsperren und verwarnen (ADR 020). Suche per POST (Audit und Limit), nie die gesuchte
// Adresse in der URL; das Ergebnis öffnet die Kontoseite.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function localeOf(form: FormData) {
  const raw = String(form.get("locale") ?? "");
  return isAppLocale(raw) ? raw : "de";
}

export async function findAccountAction(form: FormData): Promise<void> {
  const locale = localeOf(form);
  await requireAdmin(locale, `/${locale}/admin/users`);
  const query = String(form.get("query") ?? "").trim().slice(0, 320);
  if (!query) redirect(`/${locale}/admin/users?error=empty`);
  const result = await findAccount(query);
  if (!result.ok) redirect(`/${locale}/admin/users?error=${result.error}`);
  if (!result.account) redirect(`/${locale}/admin/users?error=notFound`);
  redirect(`/${locale}/admin/users/${result.account.id}`);
}

export async function accountAction(form: FormData): Promise<void> {
  const locale = localeOf(form);
  const id = String(form.get("id") ?? "");
  const detail = `/${locale}/admin/users/${UUID.test(id) ? id : ""}`;
  await requireAdmin(locale, detail);
  if (!UUID.test(id)) redirect(`/${locale}/admin/users`);
  const parsed = accountActionSchema.safeParse({
    action: form.get("action"),
    code: String(form.get("code") ?? "") || null,
    note: String(form.get("note") ?? ""),
  });
  if (!parsed.success) redirect(`${detail}?error=${parsed.error.issues[0]?.path[0] === "note" ? "note" : "code"}`);
  const { action, code, note } = parsed.data;
  const result = action === "warn" ? await warnAccount(id, code!, note) : await setAccountBlocked(id, action === "block", code, note);
  if (result.ok) {
    if (action !== "warn") invalidatePublicProvider(id);
    redirect(`${detail}?notice=${action}`);
  }
  redirect(`${detail}?error=${result.error}`);
}
