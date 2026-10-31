import "server-only";
import { updateTag } from "next/cache";
import { PUBLIC_TAGS } from "./public-listings";

/**
 * Nach Änderungen an Status oder Inhalt einer Anzeige (nur in Server Actions, ADR 015): beschleunigt die
 * eigene Instanz. Die Garantie über alle Instanzen geben Cache-Dauer und Cache-Zähler, nicht diese Tags.
 */
export function invalidatePublicListing(id: string, ownerId?: string): void {
  updateTag(PUBLIC_TAGS.all);
  updateTag(PUBLIC_TAGS.listing(id));
  if (ownerId) updateTag(PUBLIC_TAGS.provider(ownerId));
}
