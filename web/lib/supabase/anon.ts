import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import type { Database } from "./database.types";

/**
 * Client ohne Session und ohne Cookies (ADR 015): für Referenzdaten und alle öffentlichen Seiten. Sieht
 * nur, was anon sieht, und nimmt keine Request-Daten in "use cache" mit.
 */
export function anonClient() {
  return createClient<Database>(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
