"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { isAppLocale } from "@/lib/auth/paths";
import { requireSessionUser } from "@/lib/services/auth";
import { requireOnboardedUser } from "@/lib/services/gate";
import { beginVerification, submitVerification, withdrawVerification, type BeginResult, type SubmitResult } from "@/lib/services/verification";
import { DOCUMENT_TYPES } from "@/lib/verification";

// Verifizierung (ADR 020). Beginnen und Einreichen ruft die Upload-Komponente (der Upload selbst läuft im Browser
// auf den Serverpfad); Zurückziehen geht auch ohne JavaScript. Rechte und Limits prüft die DB.

const UUID = z.uuid();

function pageOf(rawLocale: string) {
  const locale = isAppLocale(rawLocale) ? rawLocale : "de";
  return { locale, page: `/${locale}/account/verification` };
}

export async function startVerification(rawLocale: string, type: string): Promise<BeginResult> {
  const { locale, page } = pageOf(rawLocale);
  await requireOnboardedUser(locale, page);
  const parsed = z.enum(DOCUMENT_TYPES).safeParse(type);
  if (!parsed.success) return { ok: false, error: "type" };
  return beginVerification(parsed.data);
}

export async function finishVerification(rawLocale: string, id: string): Promise<SubmitResult> {
  const { locale, page } = pageOf(rawLocale);
  await requireOnboardedUser(locale, page);
  if (!UUID.safeParse(id).success) return { ok: false, error: "notFound" };
  return submitVerification(id);
}

export async function withdrawVerificationAction(form: FormData): Promise<void> {
  const { locale, page } = pageOf(String(form.get("locale") ?? ""));
  const user = await requireSessionUser(locale, page);
  const id = String(form.get("id") ?? "");
  const ok = UUID.safeParse(id).success && (await withdrawVerification(user.id, id));
  redirect(ok ? `${page}?notice=withdrawn` : `${page}?error=withdraw`);
}
