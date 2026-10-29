import { NextResponse, type NextRequest } from "next/server";
import { isAppLocale, safeNextPath } from "@/lib/auth/paths";
import { publicEnv } from "@/lib/env";
import { exchangeOAuthCode } from "@/lib/services/auth";

// OAuth-Rücksprung (PKCE). Der Code ist an den Verifier-Cookie dieses Browsers gebunden.
export async function GET(request: NextRequest, { params }: RouteContext<"/[locale]/auth/callback">) {
  const { locale } = await params;
  if (!publicEnv.NEXT_PUBLIC_AUTH_APPLE_ENABLED || !isAppLocale(locale)) {
    return new NextResponse(null, { status: 404 });
  }
  const code = request.nextUrl.searchParams.get("code");
  const result = code ? await exchangeOAuthCode(code) : "invalid";
  const target =
    result === "ok" ? safeNextPath(request.nextUrl.searchParams.get("next"), locale) : `/${locale}/login`;
  return NextResponse.redirect(new URL(target, publicEnv.NEXT_PUBLIC_SITE_URL));
}
