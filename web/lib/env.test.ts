import { describe, expect, it, vi } from "vitest";

const valid = {
  NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_test",
};

// env.ts validiert beim Import, daher vorher gültige Werte setzen.
for (const [key, value] of Object.entries(valid)) vi.stubEnv(key, value);
const { parsePublicEnv } = await import("./env");

describe("parsePublicEnv", () => {
  it("akzeptiert vollständige Werte", () => {
    expect(parsePublicEnv(valid)).toEqual({ ...valid, NEXT_PUBLIC_AUTH_APPLE_ENABLED: false });
  });

  it("schaltet Apple nur mit true ein", () => {
    expect(parsePublicEnv({ ...valid, NEXT_PUBLIC_AUTH_APPLE_ENABLED: "true" }).NEXT_PUBLIC_AUTH_APPLE_ENABLED).toBe(true);
    expect(() => parsePublicEnv({ ...valid, NEXT_PUBLIC_AUTH_APPLE_ENABLED: "yes" })).toThrow(/NEXT_PUBLIC_AUTH_APPLE_ENABLED/);
  });

  it("nennt fehlende Variablen", () => {
    expect(() =>
      parsePublicEnv({ ...valid, NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined }),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  });

  it("lehnt secret Keys in der öffentlichen Variable ab, ohne den Wert auszugeben", () => {
    const call = () =>
      parsePublicEnv({ ...valid, NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_secret_geheim123" });
    expect(call).toThrow(/NEXT_PUBLIC_SUPABASE_ANON_KEY ist ein secret Key/);
    expect(call).not.toThrow(/geheim123/);
  });

  it("lehnt ungültige URLs ab", () => {
    expect(() =>
      parsePublicEnv({ ...valid, NEXT_PUBLIC_SUPABASE_URL: "kein-url" }),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });
});
