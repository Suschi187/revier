import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { publicEnv } from "@/lib/env";

/**
 * Supabase-Client für Server Components, Server Actions und Route Handlers.
 * Nutzt nur den anon-Key; Rechte kommen ausschließlich über RLS.
 * Auth-Flows und Session-Refresh folgen in M2.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // In Server Components sind Cookies schreibgeschützt; der Refresh passiert ab M2 im Proxy.
          }
        },
      },
    },
  );
}
