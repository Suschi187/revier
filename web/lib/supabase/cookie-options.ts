import { publicEnv } from "@/lib/env";

// ADR 010: lax, in Produktion (https) secure. Nicht httpOnly, weil der Browser-Client die Session braucht.
export const authCookieOptions = {
  sameSite: "lax",
  path: "/",
  secure: publicEnv.NEXT_PUBLIC_SITE_URL.startsWith("https://"),
} as const;
