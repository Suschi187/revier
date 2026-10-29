import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type LegalStatus = { termsVersion: string; privacyVersion: string; accepted: boolean };

export async function getLegalStatus(): Promise<LegalStatus | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("legal_status").single();
  if (error || !data) return null;
  return { termsVersion: data.terms_version, privacyVersion: data.privacy_version, accepted: data.accepted };
}

export type AcceptResult = "ok" | "outdated" | "failed";

/** Schickt genau die angezeigten Versionen zurück; veraltete lehnt die DB ab (22023). */
export async function acceptLegal(termsVersion: string, privacyVersion: string): Promise<AcceptResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("accept_legal", {
    p_terms_version: termsVersion,
    p_privacy_version: privacyVersion,
    p_source: "web",
  });
  if (!error) return "ok";
  return error.code === "22023" ? "outdated" : "failed";
}
