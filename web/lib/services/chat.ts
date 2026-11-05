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
