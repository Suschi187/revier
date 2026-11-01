import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cacheEpoch, getPublicListing, type PublicListing } from "./public-listings";

// Favoriten des angemeldeten Nutzers (ADR 015). RLS: nur eigene Zeilen, Merken nur sichtbarer Anzeigen,
// höchstens 500 je Konto (23514 mit hint favorites_limit).

export type FavoriteResult = "ok" | "limit" | "failed";

export async function favoriteIds(): Promise<Set<string>> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("favorites").select("listing_id").limit(1000);
  return new Set((data ?? []).map((row) => row.listing_id));
}

export async function addFavorite(listingId: string): Promise<FavoriteResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("favorites").insert({ listing_id: listingId });
  if (!error || error.code === "23505") return "ok";
  return error.code === "23514" && error.hint?.includes("favorites_limit") ? "limit" : "failed";
}

export async function removeFavorites(listingIds: string[]): Promise<FavoriteResult> {
  if (listingIds.length === 0) return "ok";
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("favorites").delete().in("listing_id", listingIds);
  return error ? "failed" : "ok";
}

export type FavoritesOverview = { available: PublicListing[]; unavailableIds: string[] };

/**
 * Gemerkte Anzeigen, neueste Favoriten zuerst. Ob eine Anzeige öffentlich ist, entscheidet der Anon-Client;
 * nicht mehr verfügbare bleiben erhalten (die Anzeige kann zurückkommen), werden aber ohne Titel gezählt.
 */
export async function favoritesOverview(): Promise<FavoritesOverview> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("favorites").select("listing_id").order("created_at", { ascending: false }).limit(1000);
  const ids = (data ?? []).map((row) => row.listing_id);
  const epoch = await cacheEpoch();
  const listings = await Promise.all(ids.map((id) => getPublicListing(id, epoch)));
  return {
    available: listings.filter((l): l is PublicListing => l !== null),
    unavailableIds: ids.filter((_, i) => listings[i] === null),
  };
}

export type FavoriteContext = { ids: Set<string>; signedIn: boolean; userId: string | null; back: string };

/** Für Listen und Detail: gemerkte IDs der Session (Claims genügen, die Rechte prüft die Action). */
export async function favoriteContext(back: string): Promise<FavoriteContext> {
  const { getSessionUser } = await import("./auth");
  const user = await getSessionUser();
  return { ids: user ? await favoriteIds() : new Set(), signedIn: user !== null, userId: user?.id ?? null, back };
}
