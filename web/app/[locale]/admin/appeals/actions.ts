"use server";

import { redirect } from "next/navigation";
import { isAppLocale } from "@/lib/auth/paths";
import { appealDecisionSchema } from "@/lib/reports";
import { requireAdmin } from "@/lib/services/admin";
import { decideAppeal } from "@/lib/services/admin-reports";
import { invalidatePublicProvider } from "@/lib/services/public-cache";

// Beschwerde entscheiden (DSA Art. 20, ADR 020). Nicht der Admin der ursprünglichen Entscheidung, außer kein anderer
// ist verfügbar (Ausweichregel in der DB). `reversed` macht die Maßnahme rückgängig.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function decideAppealAction(form: FormData): Promise<void> {
  const raw = String(form.get("locale") ?? "");
  const locale = isAppLocale(raw) ? raw : "de";
  const id = String(form.get("id") ?? "");
  const detail = `/${locale}/admin/appeals/${UUID.test(id) ? id : ""}`;
  await requireAdmin(locale, detail);
  if (!UUID.test(id)) redirect(`/${locale}/admin/appeals`);
  const parsed = appealDecisionSchema.safeParse({ outcome: form.get("outcome"), note: String(form.get("note") ?? "") });
  if (!parsed.success) redirect(`${detail}?error=${parsed.error.issues[0]?.path[0] === "note" ? "note" : "failed"}`);
  const result = await decideAppeal(id, parsed.data.outcome, parsed.data.note);
  if (result.ok) {
    const userId = String(form.get("userId") ?? "");
    if (UUID.test(userId) && parsed.data.outcome === "reversed") invalidatePublicProvider(userId);
    redirect(`/${locale}/admin/appeals?notice=${parsed.data.outcome}`);
  }
  if (result.error === "decided") redirect(`/${locale}/admin/appeals?notice=decided`);
  redirect(`${detail}?error=${result.error}`);
}
