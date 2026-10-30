"use server";

import { redirect } from "next/navigation";
import { isAppLocale } from "@/lib/auth/paths";
import { decisionSchema } from "@/lib/moderation";
import { requireAdmin } from "@/lib/services/admin";
import { decide } from "@/lib/services/moderation";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NOTICE = { approve: "approved", request_changes: "returned", reject: "rejected" } as const;

/** Entscheidung über eine Anzeige (ADR 014). Ohne JavaScript nutzbar; Fehler kommen per Query zurück. */
export async function decideListing(form: FormData): Promise<void> {
  const rawLocale = String(form.get("locale") ?? "");
  const locale = isAppLocale(rawLocale) ? rawLocale : "de";
  const id = String(form.get("id") ?? "");
  const detail = `/${locale}/admin/listings/${UUID.test(id) ? id : ""}`;
  await requireAdmin(locale, detail);
  if (!UUID.test(id)) redirect(`/${locale}/admin/listings`);

  const parsed = decisionSchema.safeParse({
    decision: form.get("decision"),
    code: String(form.get("code") ?? "") || null,
    note: String(form.get("note") ?? ""),
    version: form.get("version"),
  });
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    redirect(`${detail}?error=${field === "code" ? "code" : field === "note" ? "note" : "failed"}#decision`);
  }
  const { decision, version, code, note } = parsed.data;
  const result = await decide(id, decision, version, decision === "approve" ? null : code, decision === "approve" ? null : note);
  if (result.ok) redirect(`/${locale}/admin/listings?notice=${NOTICE[decision]}`);
  if (result.error === "decided") redirect(`/${locale}/admin/listings?notice=decided`);
  const fields = result.fields?.length ? `&fields=${result.fields.join(",")}` : "";
  redirect(`${detail}?error=${result.error}${fields}#decision`);
}
