import { describe, expect, it } from "vitest";
import { buildCsp } from "./csp";

const directive = (csp: string, name: string) => csp.split("; ").find((part) => part.startsWith(`${name} `));

describe("buildCsp", () => {
  const prod = buildCsp({ supabaseUrl: "https://abc.supabase.co", dev: false, https: true });

  it("erlaubt Supabase per https und wss, sonst nur die eigene Origin", () => {
    expect(directive(prod, "connect-src")).toBe("connect-src 'self' https://abc.supabase.co wss://abc.supabase.co");
    expect(directive(prod, "default-src")).toBe("default-src 'self'");
  });

  it("verbietet Einbetten, Plugins und fremde Formularziele", () => {
    expect(directive(prod, "frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive(prod, "object-src")).toBe("object-src 'none'");
    expect(directive(prod, "form-action")).toBe("form-action 'self'");
    expect(directive(prod, "base-uri")).toBe("base-uri 'self'");
  });

  it("erlaubt unsafe-eval nur im Dev-Modus und upgradet nur unter https", () => {
    expect(prod).not.toContain("unsafe-eval");
    expect(prod).toContain("upgrade-insecure-requests");
    const dev = buildCsp({ supabaseUrl: "http://127.0.0.1:54321", dev: true, https: false });
    expect(directive(dev, "script-src")).toContain("'unsafe-eval'");
    expect(directive(dev, "connect-src")).toBe("connect-src 'self' http://127.0.0.1:54321 ws://127.0.0.1:54321");
    expect(dev).not.toContain("upgrade-insecure-requests");
  });
});
