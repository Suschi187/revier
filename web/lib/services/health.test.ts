import { describe, expect, it, vi } from "vitest";
import { checkHealth } from "./health";

describe("checkHealth (M10)", () => {
  it("ok, wenn Supabase Auth mit dem öffentlichen Key antwortet", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    expect(await checkHealth("https://sb.example", "anon", fetchImpl as unknown as typeof fetch)).toEqual({ ok: true, supabase: "ok" });
    expect(fetchImpl).toHaveBeenCalledWith("https://sb.example/auth/v1/health", expect.objectContaining({ headers: { apikey: "anon" }, cache: "no-store" }));
  });

  it("down bei Fehlerstatus, Netzfehler und Zeitüberschreitung, ohne Details", async () => {
    const status = vi.fn(async () => new Response("boom", { status: 500 }));
    const network = vi.fn(async () => { throw new Error("ECONNREFUSED 10.0.0.5"); });
    const slow = vi.fn((_: unknown, init?: RequestInit) => new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("timeout")))));
    for (const f of [status, network]) expect(await checkHealth("https://sb.example", "anon", f as unknown as typeof fetch)).toEqual({ ok: false, supabase: "down" });
    expect(await checkHealth("https://sb.example", "anon", slow as unknown as typeof fetch, 20)).toEqual({ ok: false, supabase: "down" });
  });
});
