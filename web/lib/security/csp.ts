// ADR 010: feste CSP ohne Nonce. Eine Nonce erzwänge dynamisches Rendering; die vorgerenderte
// Hülle (cacheComponents) enthält Inline-Skripte ohne Nonce. /admin rendert ohnehin dynamisch und
// bekommt die Nonce-CSP aus dem Proxy (ADR 014).
export type CspOptions = { supabaseUrl: string; dev: boolean; https: boolean; nonce?: string };

export function buildCsp({ supabaseUrl, dev, https, nonce }: CspOptions): string {
  const supabase = new URL(supabaseUrl);
  const supabaseWs = `${supabase.protocol === "https:" ? "wss:" : "ws:"}//${supabase.host}`;

  const directives: [string, string[]][] = [
    ["default-src", ["'self'"]],
    [
      "script-src",
      nonce
        ? [`'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])]
        : ["'self'", "'unsafe-inline'", ...(dev ? ["'unsafe-eval'"] : [])],
    ],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:", supabase.origin]],
    ["font-src", ["'self'"]],
    ["connect-src", ["'self'", supabase.origin, supabaseWs]],
    // Karten-Worker als eigene Datei unter /static/map/ (ADR 016, Review A2), kein blob:. In der Admin-CSP verwirft
    // 'strict-dynamic' 'self'; dort gibt es keine Karte.
    ["worker-src", ["'self'"]],
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
