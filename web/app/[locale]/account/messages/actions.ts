"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAppLocale } from "@/lib/auth/paths";
import { errorParam } from "@/lib/chat/errors";
import { sendMessage, startConversation, type ChatError } from "@/lib/services/chat";
import { requireOnboardedUser } from "@/lib/services/gate";

// Senden (ADR 017): nur per POST, PRG nach Erfolg. Bei einem Fehler bleibt der Entwurf im Formularzustand
// (useActionState), nie in einer URL (Review H9). Ohne JavaScript (kein Header Next-Action) leitet die Action mit
// dem Fehlercode um: Ein zurückgegebener Zustand scheitert dort an einem Fehler in Next.js 16.4 (Cookies beim
// erneuten Rendern nach der Action, „does not match either cookies or mutableCookies“). Der Entwurf geht dann
// verloren, der Text steht nie in der URL.

export type ComposerState = { error: ChatError | null; draft: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function failure(path: string, error: ChatError, draft: string): Promise<ComposerState> {
  if (!(await headers()).has("next-action")) redirect(`${path}?error=${errorParam(error)}`);
  return { error, draft };
}

function read(form: FormData) {
  const rawLocale = String(form.get("locale") ?? "");
  return {
    locale: isAppLocale(rawLocale) ? rawLocale : "de",
    id: String(form.get("id") ?? ""),
    body: String(form.get("body") ?? ""),
  };
}

export async function sendMessageAction(_state: ComposerState, form: FormData): Promise<ComposerState> {
  const { locale, id, body } = read(form);
  const path = UUID.test(id) ? `/${locale}/account/messages/${id}` : `/${locale}/account/messages`;
  await requireOnboardedUser(locale, path);
  const result = await sendMessage(id, body);
  if (!result.ok) return failure(path, result.error, body);
  // Gleicher Pfad: Ohne revalidatePath zeigte der Router nach dem Redirect den alten Stand (nur der Anker wechselt).
  revalidatePath(path);
  redirect(`${path}#latest`);
}

export async function startConversationAction(_state: ComposerState, form: FormData): Promise<ComposerState> {
  const { locale, id, body } = read(form);
  const path = UUID.test(id) ? `/${locale}/account/messages/new/${id}` : `/${locale}/account/messages`;
  await requireOnboardedUser(locale, path);
  const result = await startConversation(id, body);
  if (!result.ok) return failure(path, result.error, body);
  redirect(`/${locale}/account/messages/${result.id}#latest`);
}
