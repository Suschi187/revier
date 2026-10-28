// Ohne Imports, damit auch scripts/check-supabase.mjs das Modul direkt mit Node laden kann.

/**
 * Prüft, ob ein Key in den Browser darf: nur publishable Keys (`sb_publishable_…`)
 * oder Legacy-JWTs mit `role: "anon"`. Gibt den Grund zurück, wenn nicht, sonst null.
 */
export function publicKeyProblem(key: string): string | null {
  if (key.startsWith("sb_publishable_")) return null;
  if (key.startsWith("sb_secret_")) {
    return "ist ein secret Key (sb_secret_…) und darf nie in den Browser";
  }

  const parts = key.split(".");
  if (parts.length === 3) {
    const role = jwtRole(parts[1]);
    if (role === "anon") return null;
    if (role) return `ist ein JWT mit Rolle "${role}"; erlaubt ist nur "anon"`;
  }

  return "ist weder ein publishable Key (sb_publishable_…) noch ein anon-JWT";
}

function jwtRole(payload: string): string | undefined {
  try {
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const role: unknown = JSON.parse(json).role;
    return typeof role === "string" ? role : undefined;
  } catch {
    return undefined;
  }
}
