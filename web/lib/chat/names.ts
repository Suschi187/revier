import type { ConversationItem } from "@/lib/services/chat";

/** Anzeigename des Gegenübers; gesperrte oder gelöschte Konten ohne Namen (Rückfall, Review A10). */
export function counterpartName(item: ConversationItem, fallback: string): string {
  const profile = item.counterpart.profile;
  if (!profile) return fallback;
  return profile.account_type === "business" && profile.business_name ? profile.business_name : profile.display_name;
}
