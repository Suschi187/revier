"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { completeOnboarding } from "@/app/[locale]/welcome/actions";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { initialProfileFormState, type ProfileFormState } from "@/lib/forms";
import { ProfileFields, type ProfileValues } from "./ProfileFields";

type Props = {
  locale: AppLocale;
  next: string;
  initial: ProfileValues;
  termsVersion: string;
  privacyVersion: string;
};

export function WelcomeForm({ locale, next, initial, termsVersion, privacyVersion }: Props) {
  const t = useTranslations("Welcome");
  const [state, action, pending] = useActionState<ProfileFormState, FormData>(
    completeOnboarding,
    initialProfileFormState,
  );
  const values = { ...initial, ...state.values };

  return (
    <form action={action} className="mt-6 flex flex-col gap-5" key={JSON.stringify(state.values ?? {})}>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="termsVersion" value={termsVersion} />
      <input type="hidden" name="privacyVersion" value={privacyVersion} />

      <ProfileFields values={values} errors={state.fieldErrors} />

      <div className="flex flex-col gap-1">
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            name="accept"
            required
            className="mt-1"
            aria-invalid={state.legalError ? true : undefined}
            aria-describedby={state.legalError ? "accept-error" : undefined}
          />
          <span>
            {t.rich("accept", {
              terms: (chunks) => (
                <Link href="/terms" className="underline" target="_blank">
                  {chunks}
                </Link>
              ),
              privacy: (chunks) => (
                <Link href="/privacy" className="underline" target="_blank">
                  {chunks}
                </Link>
              ),
            })}
          </span>
        </label>
        {state.legalError && (
          <p id="accept-error" className="text-sm text-red-700">
            {t("acceptRequired")}
          </p>
        )}
      </div>

      {state.formError && (
        <p role="alert" className="text-red-700">
          {t(`errors.${state.formError}`)}
        </p>
      )}
      <button type="submit" disabled={pending} className="self-start rounded bg-emerald-800 px-4 py-2 font-medium text-white disabled:opacity-60">
        {t("submit")}
      </button>
    </form>
  );
}
