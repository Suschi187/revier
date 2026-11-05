"use client";

import { useChatLive } from "@/lib/chat/realtime";

/** Unsichtbar; `data-realtime` zeigt Tests, wann das Abo steht (Review H10). */
export function ChatLive({ userId, conversationId }: { userId: string; conversationId?: string }) {
  const state = useChatLive({ userId, conversationId });
  return <span hidden data-realtime={state} />;
}
