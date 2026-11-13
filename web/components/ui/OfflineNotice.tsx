"use client";

import { useSyncExternalStore } from "react";
import { Icon } from "./Icon";

function subscribe(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

/** Band unter dem Kopf, solange der Browser offline ist (Styleguide „Offline“); verschwindet von selbst. */
export function OfflineNotice({ title, text, preview = false, className = "" }: { title: string; text: string; preview?: boolean; className?: string }) {
  const offline = useSyncExternalStore(subscribe, () => !navigator.onLine, () => false);
  if (!offline && !preview) return null;
  return (
    <div className={className}>
      <div role="status" className="flex items-start gap-2.5 rounded-card bg-notice-soft px-3.5 py-2.5 text-sm text-notice">
        <Icon name="offline" size={20} className="mt-px shrink-0" />
        <p><strong className="font-semibold">{title}</strong> {text}</p>
      </div>
    </div>
  );
}
