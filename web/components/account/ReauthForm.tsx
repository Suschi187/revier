"use client";

import { AuthRetryableFetchError } from "@supabase/supabase-js";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { AppLocale } from "@/i18n/routing";
import { publicEnv } from "@/lib/env";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

type Step = "start" | "code" | "totp" | "done";
type ErrorKey = "network" | "tooSoon" | "codeInvalid" | "mismatch" | "totpInvalid" | null;

// Frische Anmeldung vor der Löschung (ADR 019, Review A3): Code an die Adresse aus der Session, nie an eine
// eingegebene, ohne neues Konto; im Browser wie der Login (Limits je IP, ADR 010). Nach verifyOtp muss die Session
// dasselbe Konto sein. Hat das Konto einen TOTP-Faktor, folgt die Bestätigung mit aal2.
export function ReauthForm({ email, userId, locale }: { email: string; userId: string; locale: AppLocale }) {
  const t = useTranslations("AccountDelete.reauth");
  const router = useRouter();
  const [step, setStep] = useState<Step>("start");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ErrorKey>(null);
  const [factorId, setFactorId] = useState<string | null>(null);

  async function requestCode() {
    setPending(true);
    setError(null);
    // Link in der Mail wie beim Login (ADR 010): führt über /auth/confirm zurück auf diese Seite und zählt ebenfalls
    // als frische Anmeldung (amr otp).
    const redirect = new URL(`/${locale}/auth/confirm`, publicEnv.NEXT_PUBLIC_SITE_URL);
    redirect.searchParams.set("next", `/${locale}/account/delete`);
    const { error: otpError } = await getSupabaseBrowserClient().auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: redirect.toString() },
    });
    setPending(false);
    if (otpError instanceof AuthRetryableFetchError) {
      setError("network");
      return;
    }
    // Anders als beim Login (keine Konto-Enumeration nötig, es ist die eigene Adresse): Sperrfrist anzeigen.
    if (otpError?.status === 429 || otpError?.code === "over_email_send_rate_limit") {
      setError("tooSoon");
      return;
    }
    setStep("code");
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = String(new FormData(event.currentTarget).get("code") ?? "").replace(/\s/g, "");
    const supabase = getSupabaseBrowserClient();
    setPending(true);
    setError(null);
    const { data, error: verifyError } = await supabase.auth.verifyOtp({ email, token, type: "email" });
    if (verifyError || !data.user) {
      setPending(false);
      setError(verifyError instanceof AuthRetryableFetchError ? "network" : "codeInvalid");
      return;
    }
    if (data.user.id !== userId) {
      await supabase.auth.signOut({ scope: "local" });
      setPending(false);
      setError("mismatch");
      return;
    }
    const factors = await supabase.auth.mfa.listFactors();
    const totp = factors.data?.totp?.find((f) => f.status === "verified");
    setPending(false);
    if (totp) {
      setFactorId(totp.id);
      setStep("totp");
      return;
    }
    setStep("done");
    router.refresh();
  }

  async function verifyTotp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!factorId) return;
    const code = String(new FormData(event.currentTarget).get("totp") ?? "").replace(/\s/g, "");
    setPending(true);
    setError(null);
    const { error: mfaError } = await getSupabaseBrowserClient().auth.mfa.challengeAndVerify({ factorId, code });
    setPending(false);
    if (mfaError) {
      setError(mfaError instanceof AuthRetryableFetchError ? "network" : "totpInvalid");
      return;
    }
    setStep("done");
    router.refresh();
  }

  const errorText = error ? t(`errors.${error}`) : null;
  const alert = errorText && <p role="alert" className="text-red-700">{errorText}</p>;

  if (step === "done") return <p role="status" className="font-medium">{t("done")}</p>;
  if (step === "start") {
    return (
      <div className="flex flex-col gap-3">
        <p>{t("intro", { email })}</p>
        <button type="button" onClick={requestCode} disabled={pending} className="self-start rounded border border-neutral-900 px-4 py-2 font-medium disabled:opacity-60">
          {pending ? t("sending") : t("send")}
        </button>
        {alert}
      </div>
    );
  }
  if (step === "code") {
    return (
      <form onSubmit={verifyCode} className="flex flex-col gap-3">
        <p role="status">{t("sent", { email })}</p>
        <label htmlFor="reauth-code" className="font-medium">{t("codeLabel")}</label>
        <input id="reauth-code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" required
          className="rounded border border-neutral-400 px-3 py-2 tracking-widest" />
        <button type="submit" disabled={pending} className="self-start rounded border border-neutral-900 px-4 py-2 font-medium disabled:opacity-60">
          {t("verify")}
        </button>
        {alert}
      </form>
    );
  }
  return (
    <form onSubmit={verifyTotp} className="flex flex-col gap-3">
      <label htmlFor="reauth-totp" className="font-medium">{t("totpLabel")}</label>
      <input id="reauth-totp" name="totp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required
        className="rounded border border-neutral-400 px-3 py-2 tracking-widest" />
      <button type="submit" disabled={pending} className="self-start rounded border border-neutral-900 px-4 py-2 font-medium disabled:opacity-60">
        {t("verify")}
      </button>
      {alert}
    </form>
  );
}
