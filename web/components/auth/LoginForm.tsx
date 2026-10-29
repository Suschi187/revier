"use client";

import { AuthRetryableFetchError } from "@supabase/supabase-js";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { AppLocale } from "@/i18n/routing";
import { publicEnv } from "@/lib/env";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

type Step = { kind: "email" } | { kind: "code"; email: string };

// ADR 010: Code anfordern und prüfen im Browser, damit die Rate-Limits pro Nutzer-IP greifen.
// Die Antwort ist für bekannte und unbekannte Adressen gleich (keine Konto-Enumeration).
export function LoginForm({ locale, next }: { locale: AppLocale; next: string }) {
  const t = useTranslations("Auth.login");
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: "email" });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<"network" | "codeInvalid" | null>(null);

  async function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim();
    if (!email) return;
    setPending(true);
    setError(null);
    const redirect = new URL(`/${locale}/auth/confirm`, publicEnv.NEXT_PUBLIC_SITE_URL);
    redirect.searchParams.set("next", next);
    const { error: otpError } = await getSupabaseBrowserClient().auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: redirect.toString(),
        // Nur bei Neuanlage übernommen: Sprache der ersten Mail und des Profils.
        data: { preferred_language: locale },
      },
    });
    setPending(false);
    if (otpError instanceof AuthRetryableFetchError) {
      setError("network");
      return;
    }
    setStep({ kind: "code", email });
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step.kind !== "code") return;
    const token = String(new FormData(event.currentTarget).get("code") ?? "").replace(/\s/g, "");
    setPending(true);
    setError(null);
    const { error: verifyError } = await getSupabaseBrowserClient().auth.verifyOtp({
      email: step.email,
      token,
      type: "email",
    });
    if (verifyError) {
      setPending(false);
      setError(verifyError instanceof AuthRetryableFetchError ? "network" : "codeInvalid");
      return;
    }
    router.replace(next);
    router.refresh();
  }

  const errorText = error === "network" ? t("networkError") : error === "codeInvalid" ? t("codeInvalid") : null;

  if (step.kind === "email") {
    return (
      <form onSubmit={requestCode} className="mt-6 flex flex-col gap-3" noValidate={false}>
        <label htmlFor="email" className="font-medium">
          {t("emailLabel")}
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className="rounded border border-neutral-400 px-3 py-2"
        />
        <button type="submit" disabled={pending} className="rounded bg-emerald-800 px-4 py-2 font-medium text-white disabled:opacity-60">
          {pending ? t("sending") : t("submit")}
        </button>
        {errorText && (
          <p role="alert" className="text-red-700">
            {errorText}
          </p>
        )}
        <p className="text-sm text-neutral-600">{t("termsHint")}</p>
      </form>
    );
  }

  return (
    <div className="mt-6 flex flex-col gap-3">
      <h2 className="text-xl font-semibold">{t("sentTitle")}</h2>
      <p role="status">{t("sentText", { email: step.email })}</p>
      <form onSubmit={verifyCode} className="flex flex-col gap-3">
        <label htmlFor="code" className="font-medium">
          {t("codeLabel")}
        </label>
        <input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]{6,7}"
          required
          className="rounded border border-neutral-400 px-3 py-2 tracking-widest"
        />
        <button type="submit" disabled={pending} className="rounded bg-emerald-800 px-4 py-2 font-medium text-white disabled:opacity-60">
          {pending ? t("verifying") : t("codeSubmit")}
        </button>
        {errorText && (
          <p role="alert" className="text-red-700">
            {errorText}
          </p>
        )}
      </form>
      <button type="button" onClick={() => setStep({ kind: "email" })} className="self-start underline">
        {t("otherEmail")}
      </button>
    </div>
  );
}
