import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import type { ProfileInput } from "@/lib/validation/profile";

type Enums = Database["public"]["Enums"];

export type OwnProfile = {
  displayName: string;
  accountType: Enums["account_type"];
  businessName: string | null;
  country: Enums["country_code"];
  preferredLanguage: Enums["language_code"];
  verificationStatus: Enums["verification_status"];
  /** Von der Moderation gesperrt: Profil nur lesbar (RLS, Review M2). */
  isBlocked: boolean;
};

// Platzhalter aus private.handle_new_user(); das Onboarding verlangt einen echten Namen.
export const PLACEHOLDER_DISPLAY_NAME = "Nutzer";

export async function getOwnProfile(userId: string): Promise<OwnProfile | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("profiles")
    .select("display_name, account_type, business_name, country, preferred_language, verification_status, is_blocked")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return null;
  return {
    displayName: data.display_name,
    accountType: data.account_type,
    businessName: data.business_name,
    country: data.country,
    preferredLanguage: data.preferred_language,
    verificationStatus: data.verification_status,
    isBlocked: data.is_blocked,
  };
}

export type UpdateResult = "ok" | "failed";

export async function updateOwnProfile(userId: string, input: ProfileInput): Promise<UpdateResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("profiles")
    .update({
      display_name: input.displayName,
      account_type: input.accountType,
      business_name: input.businessName,
      country: input.country,
      preferred_language: input.preferredLanguage,
    })
    .eq("user_id", userId)
    .select("user_id");
  // RLS filtert still (0 Zeilen), z. B. bei gelöschten oder gesperrten Konten.
  if (error || !data || data.length === 0) return "failed";

  // Sprache der Auth-Mails (ADR 010). Nur Anzeige, nie für Rechte; ein Fehler hier blockiert nicht.
  await supabase.auth.updateUser({ data: { preferred_language: input.preferredLanguage } });
  return "ok";
}
