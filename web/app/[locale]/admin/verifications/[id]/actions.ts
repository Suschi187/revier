"use server";

import { redirect } from "next/navigation";
import { isAppLocale } from "@/lib/auth/paths";
import { requireAdmin } from "@/lib/services/admin";
import { decideVerification, revokeVerification } from "@/lib/services/admin-verifications";
import { invalidatePublicProvider } from "@/lib/services/public-cache";
import { revokeSchema, verificationDecisionSchema } from "@/lib/verification";

// Verifizierung im Admin (ADR 020). Ohne JavaScript nutzbar; Fehler kommen per Query zurück. Das Badge erscheint
// auf Anbieterseiten und Karten; der Cache-Zähler der DB steigt, die Anbieterseite wird zusätzlich neu erzeugt.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function context(form: FormData) {
  const rawLocale = String(form.get("locale") ?? "");
  const locale = isAppLocale(rawLocale) ? rawLocale : "de";
  const id = String(form.get("id") ?? "");
  return { locale, id, detail: `/${locale}/admin/verifications/${UUID.test(id) ? id : ""}` };
}

export async function decideVerificationAction(form: FormData): Promise<void> {
  const { locale, id, detail } = context(form);
  await requireAdmin(locale, detail);
  if (!UUID.test(id)) redirect(`/${locale}/admin/verifications`);
  const parsed = verificationDecisionSchema.safeParse({
    decision: form.get("decision"),
    code: String(form.get("code") ?? "") || null,
    note: String(form.get("note") ?? ""),
  });
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    redirect(`${detail}?error=${field === "code" ? "code" : field === "note" ? "note" : "failed"}#decision`);
  }
  const { decision, code, note } = parsed.data;
  const userId = String(form.get("userId") ?? "");
  const result = await decideVerification(id, decision, decision === "reject" ? code : null, decision === "reject" ? note : null);
  if (result.ok) {
    if (UUID.test(userId)) invalidatePublicProvider(userId);
    redirect(`/${locale}/admin/verifications?notice=${decision === "verify" ? "verified" : "rejected"}`);
  }
  if (result.error === "decided") redirect(`/${locale}/admin/verifications?notice=decided`);
  redirect(`${detail}?error=${result.error}#decision`);
}

export async function revokeVerificationAction(form: FormData): Promise<void> {
  const { locale, id, detail } = context(form);
  await requireAdmin(locale, detail);
  if (!UUID.test(id)) redirect(`/${locale}/admin/verifications`);
  const userId = String(form.get("userId") ?? "");
  if (!UUID.test(userId)) redirect(`${detail}?error=failed#revoke`);
  const parsed = revokeSchema.safeParse({ code: form.get("code"), note: String(form.get("note") ?? "") });
  if (!parsed.success) redirect(`${detail}?error=${parsed.error.issues[0]?.path[0] === "note" ? "note" : "code"}#revoke`);
  const result = await revokeVerification(userId, parsed.data.code, parsed.data.note);
  if (result.ok) {
    invalidatePublicProvider(userId);
    redirect(`/${locale}/admin/verifications?notice=revoked`);
  }
  redirect(`${detail}?error=${result.error}#revoke`);
}
