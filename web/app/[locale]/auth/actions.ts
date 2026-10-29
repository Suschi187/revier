"use server";

import { redirect } from "next/navigation";
import { isAppLocale, nextFromRedirectTo } from "@/lib/auth/paths";
import { publicEnv } from "@/lib/env";
import { confirmEmailToken, signOutCurrentSession } from "@/lib/services/auth";

const TOKEN_HASH_RE = /^[A-Za-z0-9_-]{16,128}$/;

export type ConfirmState = { error: "invalid" | null };

// ADR 010: Erst der Klick (POST) verbraucht das Einmal-Token, nicht das Öffnen des Links.
export async function confirmSignIn(_previous: ConfirmState, form: FormData): Promise<ConfirmState> {
  const locale = String(form.get("locale") ?? "");
  const tokenHash = String(form.get("token_hash") ?? "");
  if (!isAppLocale(locale) || !TOKEN_HASH_RE.test(tokenHash)) return { error: "invalid" };

  const result = await confirmEmailToken(tokenHash);
  if (result !== "ok") return { error: "invalid" };
  redirect(nextFromRedirectTo(form.get("redirect_to"), publicEnv.NEXT_PUBLIC_SITE_URL, locale));
}

export async function signOut(form: FormData): Promise<void> {
  const locale = String(form.get("locale") ?? "");
  await signOutCurrentSession();
  redirect(`/${isAppLocale(locale) ? locale : "de"}`);
}
