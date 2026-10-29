import type { ProfileFieldErrors } from "@/lib/validation/profile";

// Gemeinsamer Zustand der Profilformulare (Onboarding und Profil bearbeiten).
export type ProfileFormState = {
  status: "idle" | "error" | "saved";
  fieldErrors: ProfileFieldErrors;
  legalError?: boolean;
  formError?: "failed" | "outdated";
  /** Eingaben nach einem Fehler, damit das Formular sie wieder anzeigt. */
  values?: Record<string, string>;
};

export const initialProfileFormState: ProfileFormState = { status: "idle", fieldErrors: {} };

export function formValues(form: FormData, keys: readonly string[]): Record<string, string> {
  return Object.fromEntries(keys.map((key) => [key, String(form.get(key) ?? "")]));
}

export const PROFILE_KEYS = ["displayName", "accountType", "businessName", "country", "preferredLanguage"] as const;
