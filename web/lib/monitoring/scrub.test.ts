import type { ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";
import { scrubEvent, stripQuery } from "./scrub";

describe("Sentry-Ereignisse ohne personenbezogene Daten (ADR 023)", () => {
  it("entfernt Nutzer, IP, Cookies, Header, Query, Body, Servername und Breadcrumbs", () => {
    const event: ErrorEvent = {
      type: undefined,
      message: "Fehler",
      server_name: "fra1-abc",
      user: { id: "u1", email: "a@example.de", ip_address: "203.0.113.5" },
      request: {
        url: "https://huntery.de/api/unsubscribe?t=" + "a".repeat(64),
        method: "POST",
        cookies: { "sb-access-token": "x" },
        headers: { "x-forwarded-for": "203.0.113.5", cookie: "sb=1" },
        query_string: "t=abc",
        data: { email: "a@example.de" },
        env: { REMOTE_ADDR: "203.0.113.5" },
      },
      breadcrumbs: [{ category: "fetch", data: { url: "https://huntery.de/de/auth/confirm?token_hash=geheim" } }],
      transaction: "/de/auth/confirm?token_hash=geheim",
      exception: { values: [{ type: "Error", value: "boom" }] },
    };
    const out = scrubEvent(event);
    expect(out.request).toEqual({ url: "https://huntery.de/api/unsubscribe", method: "POST" });
    expect(out.user).toBeUndefined();
    expect(out.server_name).toBeUndefined();
    expect(out.breadcrumbs).toBeUndefined();
    expect(out.transaction).toBe("/de/auth/confirm");
    expect(out.exception?.values?.[0].value).toBe("boom");
    const json = JSON.stringify(out);
    for (const secret of ["203.0.113.5", "a@example.de", "geheim", "sb-access-token", "aaaa"]) expect(json).not.toContain(secret);
  });

  it("Query und Fragment abschneiden", () => {
    expect(stripQuery("/de/suche?q=x#y")).toBe("/de/suche");
    expect(stripQuery("/de/suche#y")).toBe("/de/suche");
    expect(stripQuery("/de")).toBe("/de");
  });
});
