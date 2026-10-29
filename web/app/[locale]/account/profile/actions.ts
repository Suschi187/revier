"use server";

import { formValues, PROFILE_KEYS, type ProfileFormState } from "@/lib/forms";
import { isAppLocale } from "@/lib/auth/paths";
import { requireOnboardedUser } from "@/lib/services/gate";
import { getOwnProfile, updateOwnProfile } from "@/lib/services/profile";
import { fieldErrors, profileFromForm } from "@/lib/validation/profile";

export async function saveProfile(_previous: ProfileFormState, form: FormData): Promise<ProfileFormState> {
  const rawLocale = String(form.get("locale") ?? "");
  const locale = isAppLocale(rawLocale) ? rawLocale : "de";
  const user = await requireOnboardedUser(locale, `/${locale}/account/profile`);

  const values = formValues(form, PROFILE_KEYS);
  const profile = profileFromForm(form);
  if (!profile.success) return { status: "error", fieldErrors: fieldErrors(profile.error), values };

  if ((await getOwnProfile(user.id))?.isBlocked) {
    return { status: "error", fieldErrors: {}, formError: "blocked", values };
  }
  if ((await updateOwnProfile(user.id, profile.data)) !== "ok") {
    return { status: "error", fieldErrors: {}, formError: "failed", values };
  }
  return { status: "saved", fieldErrors: {}, values };
}
