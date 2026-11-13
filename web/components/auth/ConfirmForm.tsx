"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { confirmSignIn, type ConfirmState } from "@/app/[locale]/auth/actions";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { ui } from "@/components/ui/styles";

type Props = { locale: AppLocale; tokenHash: string; redirectTo: string };

export function ConfirmForm({ locale, tokenHash, redirectTo }: Props) {
  const t = useTranslations("Auth.confirm");
  const [state, action, pending] = useActionState<ConfirmState, FormData>(confirmSignIn, { error: null });

  if (state.error || !tokenHash) {
    return (
      <div className="mt-6 flex flex-col gap-3">
        <p role="alert" className="text-error">
          {t("invalid")}
        </p>
        <Link href="/login" className={ui.link}>
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
      <button type="submit" disabled={pending} className={ui.btnPrimaryText}>
        {t("submit")}
      </button>
    </form>
  );
}
