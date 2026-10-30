"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import type { EnrollState } from "@/app/[locale]/admin/mfa/actions";

const input = "mt-1 w-40 rounded border border-stone-400 px-3 py-2 text-lg tracking-widest";
const button = "self-start rounded bg-emerald-800 px-4 py-2 font-medium text-white";

/** Code-Eingabe für einen Faktor (auch nach der Einrichtung). */
export function CodeForm({ action, locale, factorId, next }: { action: (form: FormData) => Promise<void>; locale: string; factorId: string; next: string }) {
  const t = useTranslations("Admin.mfa");
  return (
    <form action={action} className="mt-6 flex flex-col gap-3">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="factorId" value={factorId} />
      <input type="hidden" name="next" value={next} />
      <label htmlFor="totp-code" className="font-medium">
        {t("codeLabel")}
      </label>
      <input id="totp-code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" required className={input} />
      <button type="submit" className={button}>
        {t("verify")}
      </button>
    </form>
  );
}

/** Einrichtung: startet per POST, zeigt QR-Code und Schlüssel nur aus der Antwort der Action (Review B3). */
export function EnrollTotp({
  start,
  confirm,
  locale,
  next,
}: {
  start: (state: EnrollState, form: FormData) => Promise<EnrollState>;
  confirm: (form: FormData) => Promise<void>;
  locale: string;
  next: string;
}) {
  const t = useTranslations("Admin.mfa");
  const [state, action, pending] = useActionState(start, { enrollment: null, error: null });

  if (!state.enrollment) {
    return (
      <form action={action} className="mt-6 flex flex-col gap-3">
        <input type="hidden" name="locale" value={locale} />
        <p>{t("setupIntro")}</p>
        {state.error && (
          <p role="alert" className="text-red-800">
            {t(`errors.${state.error}`)}
          </p>
        )}
        <button type="submit" disabled={pending} className={button}>
          {t("setupButton")}
        </button>
      </form>
    );
  }

  return (
    <div className="mt-6 flex flex-col gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element -- SVG als data:-URL von Supabase, kein Optimizer */}
      <img src={state.enrollment.qrCode} alt={t("qrAlt")} width={200} height={200} className="rounded border border-stone-300 bg-white p-2" />
      <p>{t("secretLabel")}</p>
      <code className="w-fit select-all rounded bg-stone-100 px-2 py-1 font-mono break-all">{state.enrollment.secret}</code>
      <CodeForm action={confirm} locale={locale} factorId={state.enrollment.factorId} next={next} />
    </div>
  );
}
