"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAppLocale } from "@/lib/auth/paths";
import { errorParam } from "@/lib/chat/errors";
import {
  blockInConversation,
  CHAT_REPORT_REASONS,
  reportFromChat,
  sendMessage,
  startConversation,
  unblockInConversation,
  unblockUser,
  type ChatError,
  type ChatReportReason,
} from "@/lib/services/chat";
import { requireSessionUser } from "@/lib/services/auth";
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

// Blockieren, Entsperren und Melden (ADR 017): nur angemeldet, ohne Legal-Gate (App Store, DSA). Ergebnis als
// Hinweis-Code in der URL, nie Texte.

function conversationPath(locale: string, id: string): string {
  return UUID.test(id) ? `/${locale}/account/messages/${id}` : `/${locale}/account/messages`;
}

export async function blockAction(form: FormData): Promise<void> {
  const { locale, id } = read(form);
  const path = conversationPath(locale, id);
  await requireSessionUser(locale, path);
  const ok = await blockInConversation(id);
  revalidatePath(path);
  redirect(`${path}?notice=${ok ? "blocked" : "failed"}`);
}

export async function unblockAction(form: FormData): Promise<void> {
  const { locale, id } = read(form);
  const path = conversationPath(locale, id);
  await requireSessionUser(locale, path);
  const ok = await unblockInConversation(id);
  revalidatePath(path);
  redirect(`${path}?notice=${ok ? "unblocked" : "failed"}`);
}

export async function unblockUserAction(form: FormData): Promise<void> {
  const { locale } = read(form);
  const path = `/${locale}/account/blocked`;
  await requireSessionUser(locale, path);
  const ok = await unblockUser(String(form.get("blocked") ?? ""));
  revalidatePath(path);
  redirect(`${path}?notice=${ok ? "unblocked" : "failed"}`);
}

export async function reportAction(form: FormData): Promise<void> {
  const { locale, id } = read(form);
  const path = conversationPath(locale, id);
  await requireSessionUser(locale, path);
  const type = form.get("target") === "profile" ? "profile" : "message";
  const targetId = String(form.get("targetId") ?? "");
  const reason = String(form.get("reason") ?? "");
  const back = `${path}/report?${type === "profile" ? "profile=1" : `message=${UUID.test(targetId) ? targetId : ""}`}`;
  if (!(CHAT_REPORT_REASONS as readonly string[]).includes(reason)) redirect(`${back}&error=reason`);
  const result = await reportFromChat({ type, id: targetId }, reason as ChatReportReason, String(form.get("note") ?? ""));
  if (result !== "ok") redirect(`${back}&error=${result}`);
  redirect(`${path}?notice=reported`);
}
