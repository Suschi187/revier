import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseFavorites, type ListingCard } from "./public-listings";

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

export type FavoritesOverview = { items: ListingCard[]; unavailable: number };

/**
 * Gemerkte Anzeigen in einer Abfrage (RPC `my_favorites`, QA M5 F3): Karten verfügbarer Anzeigen, neueste Favoriten
 * zuerst, und die Zahl der nicht mehr verfügbaren (bleiben erhalten, die Anzeige kann zurückkommen). Ungecacht,
 * damit eine eben pausierte Anzeige nicht als verfügbar zählt. null bei Fehler: dann nie etwas als „nicht
 * verfügbar“ werten.
 */
export async function favoritesOverview(): Promise<FavoritesOverview | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("my_favorites");
  if (error) return null;
  return parseFavorites(data);
}

/** Entfernt nur, was jetzt nicht öffentlich ist, in einer Anweisung der DB. */
export async function removeUnavailable(): Promise<FavoriteResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("remove_unavailable_favorites");
  return error ? "failed" : "ok";
}

export type FavoriteContext = { ids: Set<string>; signedIn: boolean; userId: string | null; back: string };

/** Für Listen und Detail: gemerkte IDs der Session (Claims genügen, die Rechte prüft die Action). */
export async function favoriteContext(back: string): Promise<FavoriteContext> {
  const { getSessionUser } = await import("./auth");
  const user = await getSessionUser();
  return { ids: user ? await favoriteIds() : new Set(), signedIn: user !== null, userId: user?.id ?? null, back };
}
