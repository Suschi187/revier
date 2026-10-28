import { describe, expect, it } from "vitest";
import { publicKeyProblem } from "./key";

const jwt = (payload: object) =>
  ["eyJhbGciOiJIUzI1NiJ9", btoa(JSON.stringify(payload)).replace(/=+$/, ""), "sig"].join(".");

describe("publicKeyProblem", () => {
  it("erlaubt publishable Keys", () => {
    expect(publicKeyProblem("sb_publishable_abc")).toBeNull();
  });

  it("erlaubt anon-JWTs", () => {
    expect(publicKeyProblem(jwt({ role: "anon" }))).toBeNull();
  });

  it("lehnt secret Keys ab", () => {
    expect(publicKeyProblem("sb_secret_abc")).toMatch(/secret/);
  });

  it("lehnt service_role-JWTs ab", () => {
    expect(publicKeyProblem(jwt({ role: "service_role" }))).toMatch(/service_role/);
  });

  it("lehnt unbekannte Formate ab", () => {
    expect(publicKeyProblem("irgendwas")).not.toBeNull();
    expect(publicKeyProblem("a.kein-base64.c")).not.toBeNull();
  });
});
