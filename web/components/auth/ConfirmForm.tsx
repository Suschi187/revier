"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { confirmSignIn, type ConfirmState } from "@/app/[locale]/auth/actions";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";

type Props = { locale: AppLocale; tokenHash: string; redirectTo: string };

export function ConfirmForm({ locale, tokenHash, redirectTo }: Props) {
  const t = useTranslations("Auth.confirm");
  const [state, action, pending] = useActionState<ConfirmState, FormData>(confirmSignIn, { error: null });

  if (state.error || !tokenHash) {
    return (
      <div className="mt-6 flex flex-col gap-3">
        <p role="alert" className="text-red-700">
          {t("invalid")}
        </p>
        <Link href="/login" className="underline">
          {t("backToLogin")}
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="mt-6 flex flex-col gap-3">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="token_hash" value={tokenHash} />
      <input type="hidden" name="redirect_to" value={redirectTo} />
      <button type="submit" disabled={pending} className="rounded bg-emerald-800 px-4 py-2 font-medium text-white disabled:opacity-60">
        {t("submit")}
      </button>
    </form>
  );
}
