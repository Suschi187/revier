"use server";

import { redirect } from "next/navigation";
import { isAppLocale } from "@/lib/auth/paths";
import { reportSchema } from "@/lib/reports";
import { requireSessionUser } from "@/lib/services/auth";
import { submitReport } from "@/lib/services/reports";

// Melden von Anzeigen und Profilen (ADR 020), PRG ohne JavaScript. Ohne Legal-Gate, auch gesperrt (Review A4).
// Eingangsbestätigung: „Meine Meldungen“ mit Hinweis (Review A9).
export async function reportTargetAction(form: FormData): Promise<void> {
  const rawLocale = String(form.get("locale") ?? "");
  const locale = isAppLocale(rawLocale) ? rawLocale : "de";
  const type = String(form.get("type") ?? "");
  const id = String(form.get("id") ?? "");
  const page = `/${locale}/account/report/${type === "profile" ? "profile" : "listing"}/${/^[0-9a-f-]{36}$/.test(id) ? id : ""}`;
  await requireSessionUser(locale, page);
  const parsed = reportSchema.safeParse({
    type,
    id,
    reason: String(form.get("reason") ?? ""),
    note: String(form.get("note") ?? ""),
    goodFaith: form.get("goodFaith") ?? undefined,
  });
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    redirect(`${page}?error=${field === "goodFaith" ? "goodFaith" : field === "note" ? "note" : field === "reason" ? "reason" : "unavailable"}`);
  }
  const result = await submitReport(parsed.data.type, parsed.data.id, parsed.data.reason, parsed.data.note);
  if (result === "ok") redirect(`/${locale}/account/reports?notice=sent`);
  redirect(`${page}?error=${result}`);
}
