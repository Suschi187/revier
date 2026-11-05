"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

// Realtime im Chat (ADR 017, Review A4, A5, A13): ein privater Kanal user:<uuid>, nur unter /account/messages.
// Die Ereignisse tragen keine Inhalte; bei einem passenden Ereignis lädt die Seite ihren Serverstand neu
// (router.refresh). Damit gibt es keine Lücke nach dem Wiederverbinden: Der Server liefert immer die neuesten
// Nachrichten, markiert gelesen und aktualisiert den Zähler. Bei verborgenem Tab erst beim Sichtbarwerden, sonst
// würde „gelesen“ gesetzt, ohne dass jemand hinsieht.

export type LiveState = "connecting" | "subscribed" | "offline";

type Options = { userId: string; conversationId?: string };

const EVENTS = ["message.new", "message.read", "unread.changed"] as const;

export function useChatLive({ userId, conversationId }: Options): LiveState {
  const router = useRouter();
  const [state, setState] = useState<LiveState>("connecting");
  const pending = useRef(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const client = getSupabaseBrowserClient();
    let cancelled = false;

    const refresh = () => {
      window.clearTimeout(timer.current);
      // Mehrere Ereignisse kurz hintereinander (message.new und unread.changed) ergeben einen Abruf. Sichtbarkeit
      // erst beim Ausführen prüfen: Der Tab kann inzwischen verborgen sein.
      timer.current = window.setTimeout(() => {
        if (document.visibilityState !== "visible") {
          pending.current = true;
          return;
        }
        pending.current = false;
        router.refresh();
      }, 150);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible" && pending.current) refresh();
    };

    const channel = client.channel(`user:${userId}`, { config: { private: true } });
    for (const event of EVENTS) {
      channel.on("broadcast", { event }, ({ payload }) => {
        const target = (payload as { conversation_id?: unknown } | undefined)?.conversation_id;
        if (!conversationId || target === conversationId) refresh();
      });
    }

    void (async () => {
      // Token vor dem Join setzen: private Kanäle prüft Realtime mit der RLS des Nutzers.
      await client.realtime.setAuth();
      if (cancelled) return;
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setState("subscribed");
          // Lücke zwischen Server-Rendern und Abo schließen (auch nach dem Wiederverbinden).
          refresh();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setState("offline");
        }
      });
    })();
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      window.clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVisible);
      void client.removeChannel(channel);
    };
  }, [conversationId, router, userId]);

  return state;
}
