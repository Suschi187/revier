import { createServerClient } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";
import { publicEnv } from "@/lib/env";
import { authCookieOptions } from "./cookie-options";
import type { Database } from "./database.types";

type CookieToSet = { name: string; value: string; options: Parameters<NextResponse["cookies"]["set"]>[2] };

export type SessionRefresh = {
  /** Gültige Claims (Signatur per JWKS geprüft) oder null. */
  userId: string | null;
  /** Auf jede Antwort dieses Requests übertragen, auch auf Redirects (ADR 010). */
  apply: (response: NextResponse) => NextResponse;
  /** Admin-Rolle (ohne 2FA, nur zum Leiten) per RPC aus der DB, nicht aus dem Claim (ADR 014). */
  hasAdminRole: () => Promise<boolean>;
};

export function hasAuthCookie(request: NextRequest): boolean {
  return request.cookies.getAll().some((cookie) => cookie.name.startsWith("sb-"));
}

/**
 * Erneuert die Session im Proxy. Neue Cookies werden zuerst in den Request geschrieben, damit
 * nachfolgende Middleware (next-intl reicht request.headers weiter) und Server Components das
 * rotierte Token sehen, und anschließend über `apply` auf die Antwort.
 */
export async function refreshSession(request: NextRequest): Promise<SessionRefresh> {
  let cookiesToSet: CookieToSet[] = [];
  let cacheHeaders: Record<string, string> = {};

  const supabase = createServerClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookieOptions: authCookieOptions,
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookies, headers) => {
          for (const { name, value } of cookies) request.cookies.set(name, value);
          cookiesToSet = cookies;
          cacheHeaders = { ...cacheHeaders, ...headers };
        },
      },
    },
  );

  // getClaims prüft das JWT lokal per JWKS (ES256) und erneuert es bei Bedarf.
  const { data } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;

  return {
    userId: typeof sub === "string" ? sub : null,
    hasAdminRole: async () => {
      const { data, error } = await supabase.rpc("admin_access").single();
      return !error && data?.has_role === true;
    },
    apply: (response) => {
      for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      if (cookiesToSet.length > 0) {
        for (const [key, value] of Object.entries(cacheHeaders)) response.headers.set(key, value);
        // Antworten mit Set-Cookie nie in geteilten Caches ablegen.
        response.headers.set("Cache-Control", "private, no-store");
      }
      return response;
    },
  };
}
