"use server";

import { redirect } from "next/navigation";
import { formValues, PROFILE_KEYS, type ProfileFormState } from "@/lib/forms";
import { isAppLocale, safeNextPath } from "@/lib/auth/paths";
import { requireSessionUser } from "@/lib/services/auth";
import { acceptLegal } from "@/lib/services/legal";
import { updateOwnProfile } from "@/lib/services/profile";
import { fieldErrors, legalFromForm, profileFromForm } from "@/lib/validation/profile";

// Onboarding (ADR 010): erst Profil speichern, dann zustimmen; eine Wiederholung ist harmlos.
export async function completeOnboarding(_previous: ProfileFormState, form: FormData): Promise<ProfileFormState> {
  const rawLocale = String(form.get("locale") ?? "");
  const locale = isAppLocale(rawLocale) ? rawLocale : "de";
  const user = await requireSessionUser(locale, `/${locale}/welcome`);

  const values = formValues(form, PROFILE_KEYS);
  const profile = profileFromForm(form);
  const legal = legalFromForm(form);
  if (!profile.success || !legal.success) {
    return {
      status: "error",
      fieldErrors: profile.success ? {} : fieldErrors(profile.error),
      legalError: !legal.success,
      values,
    };
  }

  if ((await updateOwnProfile(user.id, profile.data)) !== "ok") {
    return { status: "error", fieldErrors: {}, formError: "failed", values };
  }
  const accepted = await acceptLegal(legal.data.termsVersion, legal.data.privacyVersion);
  if (accepted !== "ok") {
    return { status: "error", fieldErrors: {}, formError: accepted, values };
  }
  redirect(safeNextPath(form.get("next"), locale));
}
