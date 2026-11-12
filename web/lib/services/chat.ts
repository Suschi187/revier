import "server-only";
import { z } from "zod";
import { bodySchema } from "@/lib/chat/rules";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Chat (ADR 017): nur Session-Client, nie service_role. Schreiben nur per RPC; Fehler als Codes für die UI.

const UUID = z.string().uuid();

const profileSchema = z
  .object({ display_name: z.string(), account_type: z.string(), business_name: z.string().nullable(), verified: z.boolean() })
  .nullable();

const itemSchema = z.object({
  id: z.string(),
  role: z.enum(["owner", "interested"]),
  listing: z
    .object({ id: z.string(), title: z.string(), kind: z.string(), public: z.boolean(), status: z.string().nullable() })
    .nullable(),
  counterpart: z.object({ id: z.string(), profile: profileSchema }),
  last_message_at: z.string().nullable(),
  last_message: z.object({ body: z.string(), mine: z.boolean(), created_at: z.string() }).nullable(),
  unread: z.number(),
  can_write: z.boolean(),
  blocked_by_me: z.boolean(),
});
export type ConversationItem = z.infer<typeof itemSchema>;

const messageSchema = z.object({ id: z.string(), mine: z.boolean(), body: z.string(), created_at: z.string(), read_at: z.string().nullable() });
export type ChatMessage = z.infer<typeof messageSchema>;

export type ChatError =
  | { code: "body" }
  | { code: "legal" }
  | { code: "rate"; scope: string; retryAfter: string | null }
  | { code: "unavailable" }
  | { code: "failed" };

function toError(error: { code?: string; hint?: string | null } | null): ChatError {
  if (!error) return { code: "failed" };
  if (error.code === "22023" && error.hint === "body") return { code: "body" };
  if (error.code === "RV001") return { code: "legal" };
  if (error.code === "RV002") {
    try {
      const hint = JSON.parse(error.hint ?? "{}") as { scope?: string; retry_after?: string | null };
      return { code: "rate", scope: hint.scope ?? "chat_messages", retryAfter: hint.retry_after ?? null };
    } catch {
      return { code: "rate", scope: "chat_messages", retryAfter: null };
    }
  }
  if (error.code === "42501") return { code: "unavailable" };
  return { code: "failed" };
}

export async function listConversations(cursor?: string): Promise<{ items: ConversationItem[]; nextCursor: string | null } | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("my_conversations", { p_cursor: cursor ?? undefined, p_limit: 30 });
  if (error) return null;
  const parsed = z.object({ items: z.array(itemSchema), next_cursor: z.string().nullable() }).safeParse(data);
  return parsed.success ? { items: parsed.data.items, nextCursor: parsed.data.next_cursor } : null;
}

/** Kopf einer Unterhaltung; null für fremd, unbekannt und ungültig (gleiche Antwort, ADR 017). */
export async function conversationInfo(id: string): Promise<ConversationItem | null> {
  if (!UUID.safeParse(id).success) return null;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("conversation_info", { p_conversation_id: id });
  if (error || data === null) return null;
  const parsed = itemSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export type MessagePage = { items: ChatMessage[]; hasMore: boolean };

export async function conversationMessages(
  id: string,
  bound?: { before?: { at: string; id: string }; after?: { at: string; id: string } },
): Promise<MessagePage | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("conversation_messages", {
    p_conversation_id: id,
    p_before_at: bound?.before?.at,
    p_before_id: bound?.before?.id,
    p_after_at: bound?.after?.at,
    p_after_id: bound?.after?.id,
    p_limit: 50,
  });
  if (error) return null;
  const parsed = z.object({ items: z.array(messageSchema), has_more: z.boolean() }).safeParse(data);
  return parsed.success ? { items: parsed.data.items, hasMore: parsed.data.has_more } : null;
}

/** Zähler für die Navigation; null bei Fehler (dann ohne Zahl, nie die Seite brechen, Review A13). */
export async function unreadCount(): Promise<number | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("unread_count");
  return error || typeof data !== "number" ? null : data;
}

export async function startConversation(listingId: string, body: string): Promise<{ ok: true; id: string } | { ok: false; error: ChatError }> {
  const text = bodySchema.safeParse(body);
  if (!text.success) return { ok: false, error: { code: "body" } };
  if (!UUID.safeParse(listingId).success) return { ok: false, error: { code: "unavailable" } };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("start_conversation", { p_listing_id: listingId, p_body: text.data });
  return error || typeof data !== "string" ? { ok: false, error: toError(error) } : { ok: true, id: data };
}

export async function sendMessage(conversationId: string, body: string): Promise<{ ok: true } | { ok: false; error: ChatError }> {
  const text = bodySchema.safeParse(body);
  if (!text.success) return { ok: false, error: { code: "body" } };
  if (!UUID.safeParse(conversationId).success) return { ok: false, error: { code: "unavailable" } };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("send_message", { p_conversation_id: conversationId, p_body: text.data });
  return error ? { ok: false, error: toError(error) } : { ok: true };
}

export async function markRead(conversationId: string): Promise<void> {
  if (!UUID.safeParse(conversationId).success) return;
  const supabase = await createSupabaseServerClient();
  await supabase.rpc("mark_conversation_read", { p_conversation_id: conversationId });
}

/** Bestehende Unterhaltung des Nutzers als Interessent zu einer Anzeige (für „Nachricht schreiben“). */
export async function conversationForListing(listingId: string, userId: string): Promise<string | null> {
  if (!UUID.safeParse(listingId).success) return null;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("conversations").select("id").eq("listing_id", listingId).eq("interested_id", userId).maybeSingle();
  return data?.id ?? null;
}

// ---------------------------------------------------------------------------
// Blockieren und Melden (ADR 017, Review A11, H7): ohne Legal-Gate, auch für gesperrte Konten.
// ---------------------------------------------------------------------------

export async function blockInConversation(conversationId: string): Promise<boolean> {
  if (!UUID.safeParse(conversationId).success) return false;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("block_in_conversation", { p_conversation_id: conversationId });
  return !error;
}

export async function unblockInConversation(conversationId: string): Promise<boolean> {
  if (!UUID.safeParse(conversationId).success) return false;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("unblock_in_conversation", { p_conversation_id: conversationId });
  return !error;
}

export async function unblockUser(blockedId: string): Promise<boolean> {
  if (!UUID.safeParse(blockedId).success) return false;
  const supabase = await createSupabaseServerClient();
  // RLS (blocks_own): nur eigene Sperren.
  const { error } = await supabase.from("blocks").delete().eq("blocked_id", blockedId);
  return !error;
}

export type BlockedPerson = { id: string; name: string | null; since: string };

export async function myBlocks(): Promise<BlockedPerson[] | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("my_blocks");
  if (error) return null;
  return (data ?? []).map((row) => ({ id: row.blocked_id, name: row.display_name, since: row.created_at }));
}

/** Gründe, die der Chat anbietet (ohne wrong_category: im Chat irreführend). */
export const CHAT_REPORT_REASONS = ["scam", "harassment", "illegal", "weapons", "other"] as const;
export type ChatReportReason = (typeof CHAT_REPORT_REASONS)[number];

export type ReportResult = "ok" | "limit" | "duplicate" | "failed";

export async function reportFromChat(target: { type: "message" | "profile"; id: string }, reason: ChatReportReason, note: string): Promise<ReportResult> {
  if (!UUID.safeParse(target.id).success) return "failed";
  const supabase = await createSupabaseServerClient();
  const trimmed = note.trim().slice(0, 1000);
  const { error } = await supabase.from("reports").insert({ target_type: target.type, target_id: target.id, reason, note: trimmed || null });
  if (!error) return "ok";
  // Seit M9b höchstens eine offene Meldung je Ziel (ADR 020): „bereits gemeldet“ statt Fehler.
  return error.code === "54000" ? "limit" : error.code === "23505" ? "duplicate" : "failed";
}

/** Fremde Nachricht für die Meldeseite (RLS: nur Teilnehmer); null für eigene, fremde oder unbekannte. */
export async function messageForReport(messageId: string, conversationId: string, userId: string): Promise<{ id: string; body: string } | null> {
  if (!UUID.safeParse(messageId).success || !UUID.safeParse(conversationId).success) return null;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("messages")
    .select("id, body, sender_id")
    .eq("id", messageId)
    .eq("conversation_id", conversationId)
    .neq("sender_id", userId)
    .maybeSingle();
  return data ? { id: data.id, body: data.body } : null;
}
