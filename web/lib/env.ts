import { z } from "zod";
import { publicKeyProblem } from "@/lib/supabase/key";

// Öffentliche Variablen landen im Browser-Bundle. Hier nie Secrets ergänzen,
// der service_role-Key gehört nur in serverseitigen Code (docs/adr/002).
const publicEnvSchema = z.object({
  NEXT_PUBLIC_SITE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(1)
    .superRefine((key, ctx) => {
      const problem = publicKeyProblem(key);
      if (problem) ctx.addIssue({ code: "custom", message: problem });
    }),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

export function parsePublicEnv(raw: Record<string, string | undefined>): PublicEnv {
  const result = publicEnvSchema.safeParse(raw);
  if (!result.success) {
    // Nur Variablennamen und Gründe ausgeben, nie die Werte selbst.
    const fields = result.error.issues
      .map((issue) =>
        issue.code === "custom" ? `${issue.path.join(".")} ${issue.message}` : issue.path.join("."),
      )
      .join(", ");
    throw new Error(`Ungültige oder fehlende Umgebungsvariablen: ${fields}. Siehe web/.env.example.`);
  }
  return result.data;
}

// Next.js ersetzt NEXT_PUBLIC_-Variablen nur bei direktem Zugriff, deshalb einzeln auflisten.
export const publicEnv = parsePublicEnv({
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
});
