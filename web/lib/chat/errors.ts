import type { ChatError } from "@/lib/services/chat";

// Fehlercodes des Chats für Texte (Chat.errors.*) und die URL nach einem Senden ohne JavaScript.

export const ERROR_PARAMS = ["body", "legal", "rate", "rateUnanswered", "rateConversations", "unavailable", "failed"] as const;
export type ErrorParam = (typeof ERROR_PARAMS)[number];

export function errorParam(error: ChatError): ErrorParam {
  if (error.code !== "rate") return error.code;
  return error.scope === "chat_unanswered" ? "rateUnanswered" : error.scope === "chat_conversations" ? "rateConversations" : "rate";
}

export function isErrorParam(value: unknown): value is ErrorParam {
  return typeof value === "string" && (ERROR_PARAMS as readonly string[]).includes(value);
}
