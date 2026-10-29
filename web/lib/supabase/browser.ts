"use client";

import { createBrowserClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/env";
import { authCookieOptions } from "./cookie-options";
import type { Database } from "./database.types";

let client: ReturnType<typeof createBrowserClient<Database>> | undefined;

/**
 * Browser-Client nur mit dem öffentlichen Key. Für Code anfordern und Code prüfen (ADR 010: die
 * Rate-Limits von Supabase Auth greifen so pro Nutzer-IP) und später Realtime (M7).
 */
export function getSupabaseBrowserClient() {
  client ??= createBrowserClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { cookieOptions: authCookieOptions },
  );
  return client;
}
