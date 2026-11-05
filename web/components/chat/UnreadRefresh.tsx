"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Zähler außerhalb des Chats (ADR 017, Review A13, QA M7 F2): kein Realtime, aber beim Zurückkehren in den Tab den
// Serverstand neu laden, höchstens alle 30 Sekunden. Im Chat übernimmt das useChatLive.
const MIN_INTERVAL_MS = 30_000;

export function UnreadRefresh() {
  const router = useRouter();
  useEffect(() => {
    // Erste Rückkehr sofort, danach höchstens alle 30 Sekunden.
    let last = 0;
    const onVisible = () => {
      if (document.visibilityState !== "visible" || Date.now() - last < MIN_INTERVAL_MS) return;
      if (window.location.pathname.includes("/account/messages")) return;
      last = Date.now();
      router.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [router]);
  return null;
}
