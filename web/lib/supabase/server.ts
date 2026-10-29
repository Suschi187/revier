import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { publicEnv } from "@/lib/env";
import { authCookieOptions } from "./cookie-options";
import type { Database } from "./database.types";

/**
 * Supabase-Client für Server Components, Server Actions und Route Handlers.
 * Nutzt nur den anon-Key; Rechte kommen ausschließlich über RLS.
 * Der Session-Refresh passiert im Proxy (lib/supabase/proxy.ts).
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookieOptions: authCookieOptions,
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // In Server Components sind Cookies schreibgeschützt; der Refresh passiert im Proxy.
          }
        },
      },
    },
  );
}
