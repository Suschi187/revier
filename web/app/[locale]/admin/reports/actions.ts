"use server";

import { redirect } from "next/navigation";
import { isAppLocale } from "@/lib/auth/paths";
import { resolveSchema } from "@/lib/reports";
import { requireAdmin } from "@/lib/services/admin";
import { resolveReports } from "@/lib/services/admin-reports";
import { invalidatePublicListing, invalidatePublicProvider } from "@/lib/services/public-cache";
import type { RejectCode } from "@/lib/moderation";
import type { AccountCode } from "@/lib/reports";

// Meldungen eines Ziels entscheiden (ADR 020): Ergebnis und Maßnahme in einer Transaktion (resolve_reports). Ohne
// JavaScript nutzbar; Fehler kommen per Query zurück.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TYPES = ["listing", "profile", "message"] as const;

export async function resolveReportsAction(form: FormData): Promise<void> {
  const rawLocale = String(form.get("locale") ?? "");
  const locale = isAppLocale(rawLocale) ? rawLocale : "de";
  const type = TYPES.find((t) => t === form.get("type")) ?? "listing";
  const id = String(form.get("id") ?? "");
  const detail = `/${locale}/admin/reports/${type}/${UUID.test(id) ? id : ""}`;
  await requireAdmin(locale, detail);
  if (!UUID.test(id)) redirect(`/${locale}/admin/reports`);
  const chosen = String(form.get("outcome") ?? "");
  // Anzeigen-Maßnahmen nehmen den Anzeigen-Grund, Konto-Maßnahmen den Konto-Grund (QA M9b F5).
  const codeField = chosen === "content_removed" || chosen === "point_removed" ? "codeListing" : "codeAccount";
  const parsed = resolveSchema.safeParse({
    outcome: chosen,
    code: String(form.get(codeField) ?? "") || null,
    note: String(form.get("note") ?? ""),
    version: String(form.get("version") ?? "") || null,
  });
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    redirect(`${detail}?error=${field === "note" ? "note" : field === "version" ? "changed" : field === "code" ? "code" : "failed"}#decision`);
  }
  const { outcome, code, note, version } = parsed.data;
  const result = await resolveReports(type, id, outcome, code as RejectCode | AccountCode | null, note, version);
  if (result.ok) {
    if (type === "listing") invalidatePublicListing(id);
    const owner = String(form.get("accountId") ?? "");
    if (UUID.test(owner) && outcome === "account_blocked") invalidatePublicProvider(owner);
    redirect(`/${locale}/admin/reports?notice=resolved`);
  }
  if (result.error === "decided") redirect(`/${locale}/admin/reports?notice=decided`);
  redirect(`${detail}?error=${result.error}#decision`);
}
