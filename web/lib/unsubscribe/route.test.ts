import { beforeEach, describe, expect, it, vi } from "vitest";
import { routing } from "@/i18n/routing";
import { unsubscribeDoneHtml } from "./done-page";

// Route-Handler /api/unsubscribe (ADR 018, RFC 8058, Review B4): immer 200 mit gleichem Body, no-store, kein Redirect,
// keine Cookies; GET ändert nichts. Die DB-Seite (unsubscribe ohne Orakel) prüfen pgTAP und Integration.

const calls: string[] = [];
let fail = false;
vi.mock("@/lib/services/unsubscribe", () => ({
  unsubscribeWithToken: async (token: string) => {
    calls.push(token);
    if (fail) console.error(JSON.stringify({ fn: "unsubscribe", kind: "rpc_failed", code: "XX000" }));
  },
}));

const { GET, POST } = await import("@/app/api/unsubscribe/route");

const TOKEN = "0f".repeat(32);
const BASE = "http://localhost:3000/api/unsubscribe";
const FORM = { "Content-Type": "application/x-www-form-urlencoded" };

beforeEach(() => {
  calls.length = 0;
  fail = false;
});

async function snapshot(response: Response) {
  return {
    status: response.status,
    body: await response.text(),
    cache: response.headers.get("cache-control"),
    location: response.headers.get("location"),
    cookie: response.headers.get("set-cookie"),
    referrer: response.headers.get("referrer-policy"),
  };
}

describe("POST /api/unsubscribe", () => {
  it("gleiche Antwort für gültigen, ungültigen und fehlenden Token und bei DB-Fehler", async () => {
    const one = (url: string, body?: string) => POST(new Request(url, { method: "POST", body, headers: { ...FORM, "Accept-Language": "en" } }));
    const valid = await snapshot(await one(`${BASE}?t=${TOKEN}`, "List-Unsubscribe=One-Click"));
    const invalid = await snapshot(await one(`${BASE}?t=nope`, "List-Unsubscribe=One-Click"));
    const missing = await snapshot(await one(BASE));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    fail = true;
    const dbError = await snapshot(await one(`${BASE}?t=${TOKEN}`, "List-Unsubscribe=One-Click"));
    expect(valid).toEqual({ status: 200, body: unsubscribeDoneHtml("en"), cache: "no-store", location: null, cookie: null, referrer: "no-referrer" });
    expect(invalid).toEqual(valid);
    expect(missing).toEqual(valid);
    expect(dbError).toEqual(valid);
    // Nur gültig formatierte Token gehen an die DB; Logs ohne Token.
    expect(calls).toEqual([TOKEN, TOKEN]);
    expect(errorSpy.mock.calls.flat().join(" ")).not.toContain(TOKEN);
    errorSpy.mockRestore();
  });

  it("Formular der Bestätigungsseite: Token und Sprache aus den Feldern", async () => {
    const response = await POST(new Request(BASE, { method: "POST", body: `lang=pl&t=${TOKEN}`, headers: FORM }));
    expect(calls).toEqual([TOKEN]);
    expect(await response.text()).toBe(unsubscribeDoneHtml("pl"));
  });
});

describe("GET /api/unsubscribe", () => {
  it("ändert nichts und leitet per 303 auf die lokalisierte Seite", async () => {
    const response = await GET(new Request(`${BASE}?t=${TOKEN}`, { headers: { "Accept-Language": "cs-CZ,cs;q=0.9" } }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/cs/unsubscribe?t=${TOKEN}`);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(calls).toEqual([]);
  });
  it("ohne gültigen Token ohne Query, Rückfall de", async () => {
    const response = await GET(new Request(`${BASE}?t=%0d%0aSet-Cookie:x`));
    expect(response.headers.get("location")).toBe("/de/unsubscribe");
  });
});

describe("Bestätigung nach dem POST", () => {
  it.each(routing.locales)("%s: lokalisiert, noindex, no-referrer, ohne Skript und Drittressourcen", (locale) => {
    const html = unsubscribeDoneHtml(locale);
    expect(html).toContain(`<html lang="${locale}">`);
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).toContain('<meta name="referrer" content="no-referrer">');
    for (const path of ["account/searches", "account/profile", "imprint", "privacy"]) expect(html).toContain(`href="/${locale}/${path}"`);
    expect(html).not.toMatch(/<script|https?:\/\//i);
  });
});
