import { z } from "zod";
import { Constants } from "@/lib/supabase/database.types";

const { account_type, country_code, language_code } = Constants.public.Enums;

// Fehlercodes statt Texte; die Formulare übersetzen sie (messages: Profile.errors.*).
export type FieldError = "required" | "tooLong" | "invalid";

const trimmed = (max: number) =>
  z
    .string({ error: "required" })
    .transform((value) => value.trim())
    .pipe(z.string().min(1, { error: "required" }).max(max, { error: "tooLong" }));

// Spiegelt die DB-Checks in profiles (display_name 1–60, business_name 1–120 nur bei business).
export const profileSchema = z
  .object({
    displayName: trimmed(60),
    accountType: z.enum(account_type, { error: "invalid" }),
    businessName: z.string().optional(),
    country: z.enum(country_code, { error: "invalid" }),
    preferredLanguage: z.enum(language_code, { error: "invalid" }),
  })
  .transform((value, ctx) => {
    if (value.accountType === "private") return { ...value, businessName: null };
    const name = (value.businessName ?? "").trim();
    if (name.length === 0 || name.length > 120) {
      ctx.addIssue({ code: "custom", path: ["businessName"], message: name ? "tooLong" : "required" });
      return z.NEVER;
    }
    return { ...value, businessName: name };
  });

export type ProfileInput = z.output<typeof profileSchema>;
export type ProfileFieldErrors = Partial<Record<keyof ProfileInput, FieldError>>;

export const legalSchema = z.object({
  accept: z.literal("on", { error: "required" }),
  termsVersion: z.string().min(1).max(40),
  privacyVersion: z.string().min(1).max(40),
});

export function profileFromForm(form: FormData) {
  return profileSchema.safeParse({
    displayName: form.get("displayName") ?? undefined,
    accountType: form.get("accountType") ?? undefined,
    businessName: form.get("businessName") ?? undefined,
    country: form.get("country") ?? undefined,
    preferredLanguage: form.get("preferredLanguage") ?? undefined,
  });
}

export function legalFromForm(form: FormData) {
  return legalSchema.safeParse({
    accept: form.get("accept") ?? undefined,
    termsVersion: form.get("termsVersion") ?? undefined,
    privacyVersion: form.get("privacyVersion") ?? undefined,
  });
}

/** Erster Fehlercode je Feld; unbekannte Codes werden zu "invalid". */
export function fieldErrors(error: z.ZodError): ProfileFieldErrors {
  const result: Record<string, FieldError> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "");
    if (!key || key in result) continue;
    result[key] = issue.message === "required" || issue.message === "tooLong" ? issue.message : "invalid";
  }
  return result as ProfileFieldErrors;
}
