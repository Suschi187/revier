"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { saveProfile } from "@/app/[locale]/account/profile/actions";
import type { AppLocale } from "@/i18n/routing";
import { initialProfileFormState, type ProfileFormState } from "@/lib/forms";
import { ProfileFields, type ProfileValues } from "./ProfileFields";

export function ProfileForm({ locale, initial }: { locale: AppLocale; initial: ProfileValues }) {
  const t = useTranslations("Account.profile");
  const [state, action, pending] = useActionState<ProfileFormState, FormData>(saveProfile, initialProfileFormState);
  const values = { ...initial, ...state.values };

  return (
    <form action={action} className="mt-6 flex flex-col gap-5" key={JSON.stringify(state.values ?? {})}>
      <input type="hidden" name="locale" value={locale} />
      <ProfileFields values={values} errors={state.fieldErrors} />
      {state.status === "saved" && (
        <p role="status" className="text-emerald-800">
          {t("saved")}
        </p>
      )}
      {state.formError && (
        <p role="alert" className="text-red-700">
          {t("failed")}
        </p>
      )}
      <button type="submit" disabled={pending} className="self-start rounded bg-emerald-800 px-4 py-2 font-medium text-white disabled:opacity-60">
        {t("submit")}
      </button>
    </form>
  );
}
