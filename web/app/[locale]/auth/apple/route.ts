import { NextResponse, type NextRequest } from "next/server";
import { isAppLocale, safeNextPath } from "@/lib/auth/paths";
import { publicEnv } from "@/lib/env";
import { startAppleSignIn } from "@/lib/services/auth";

// Start per GET-Link statt Formular-POST, damit CSP form-action den Redirect zu Apple nicht blockiert.
export async function GET(request: NextRequest, { params }: RouteContext<"/[locale]/auth/apple">) {
  const { locale } = await params;
  if (!publicEnv.NEXT_PUBLIC_AUTH_APPLE_ENABLED || !isAppLocale(locale)) {
    return new NextResponse(null, { status: 404 });
  }
  const callback = new URL(`/${locale}/auth/callback`, publicEnv.NEXT_PUBLIC_SITE_URL);
  callback.searchParams.set("next", safeNextPath(request.nextUrl.searchParams.get("next"), locale));

  const url = await startAppleSignIn(callback.toString());
  return NextResponse.redirect(url ?? new URL(`/${locale}/login`, publicEnv.NEXT_PUBLIC_SITE_URL));
}
