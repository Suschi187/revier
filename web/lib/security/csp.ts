// ADR 010: feste CSP ohne Nonce. Eine Nonce erzwänge dynamisches Rendering; die vorgerenderte
// Hülle (cacheComponents) enthält Inline-Skripte ohne Nonce. Nonce-CSP zuerst für /admin (M4).
export type CspOptions = { supabaseUrl: string; dev: boolean; https: boolean };

export function buildCsp({ supabaseUrl, dev, https }: CspOptions): string {
  const supabase = new URL(supabaseUrl);
  const supabaseWs = `${supabase.protocol === "https:" ? "wss:" : "ws:"}//${supabase.host}`;

  const directives: [string, string[]][] = [
    ["default-src", ["'self'"]],
    ["script-src", ["'self'", "'unsafe-inline'", ...(dev ? ["'unsafe-eval'"] : [])]],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:", supabase.origin]],
    ["font-src", ["'self'"]],
    ["connect-src", ["'self'", supabase.origin, supabaseWs]],
    ["frame-ancestors", ["'none'"]],
    ["frame-src", ["'none'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    // Server Actions posten an die eigene Origin; Apple startet per GET-Link (ADR 010).
    ["form-action", ["'self'"]],
  ];
  const parts = directives.map(([name, values]) => `${name} ${values.join(" ")}`);
  if (https) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}
