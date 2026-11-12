import type { Database } from "@/lib/supabase/database.types";

export type ListingStatus = Database["public"]["Enums"]["listing_status"];

/** Farben je Anzeigenstatus (docs/DESIGN.md 2); Text plus Farbe, nie Farbe allein. */
const STATUS_STYLE: Record<ListingStatus, string> = {
  draft: "bg-sand text-muted",
  pending_review: "bg-notice-soft text-notice",
  active: "bg-success-soft text-success",
  paused: "bg-sand text-forest",
  expired: "bg-sand text-muted",
  rejected: "bg-error-soft text-error",
  removed: "bg-error-soft text-error",
};

export function StatusBadge({ status, label, srPrefix }: { status: ListingStatus; label: string; srPrefix?: string }) {
  return (
    <span className={`rounded-btn px-2 py-0.5 text-sm font-semibold ${STATUS_STYLE[status]}`}>
      {srPrefix && <span className="sr-only">{srPrefix}: </span>}
      {label}
    </span>
  );
}
