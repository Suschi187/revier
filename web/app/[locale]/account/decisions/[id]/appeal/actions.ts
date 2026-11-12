"use server";

import { redirect } from "next/navigation";
import { isAppLocale } from "@/lib/auth/paths";
import { appealSchema } from "@/lib/reports";
import { requireSessionUser } from "@/lib/services/auth";
import { submitAppeal } from "@/lib/services/decisions";

// Beschwerde gegen eine Entscheidung (DSA Art. 20, ADR 020), PRG ohne JavaScript; ohne Legal-Gate, auch gesperrt.
export async function submitAppealAction(form: FormData): Promise<void> {
  const rawLocale = String(form.get("locale") ?? "");
  const locale = isAppLocale(rawLocale) ? rawLocale : "de";
  const id = String(form.get("id") ?? "");
  const page = `/${locale}/account/decisions/${/^[0-9a-f-]{36}$/.test(id) ? id : ""}/appeal`;
  await requireSessionUser(locale, page);
  const parsed = appealSchema.safeParse({ id, text: String(form.get("text") ?? "") });
  if (!parsed.success) redirect(`${page}?error=${parsed.error.issues[0]?.path[0] === "text" ? "text" : "notFound"}`);
  const result = await submitAppeal(parsed.data.id, parsed.data.text);
  if (result === "ok" || result === "duplicate") redirect(`/${locale}/account/decisions?notice=appealed`);
  redirect(`${page}?error=${result}`);
}
