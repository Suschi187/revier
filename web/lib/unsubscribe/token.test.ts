import { describe, expect, it } from "vitest";
import { formFields, localeFromAcceptLanguage, MAX_BODY_BYTES, parseToken, readCappedBody, readUnsubscribePost } from "./token";

const tokenFromRequest = async (request: Request) => (await readUnsubscribePost(request)).token;

const TOKEN = "ab".repeat(32);
const OTHER = "cd".repeat(32);
const URL_BASE = "http://localhost:3000/api/unsubscribe";

function post(url: string, body?: BodyInit, contentType?: string): Request {
  return new Request(url, { method: "POST", body, headers: contentType ? { "Content-Type": contentType } : {} });
}

describe("parseToken", () => {
  it.each([
    [TOKEN, TOKEN],
    [TOKEN.toUpperCase(), null],
    [TOKEN.slice(1), null],
    [`${TOKEN}0`, null],
    [`${TOKEN}\r\nX: y`, null],
    ["", null],
    [null, null],
    [42, null],
  ])("%j", (value, expected) => {
    expect(parseToken(value)).toBe(expected);
  });
});

describe("Token aus dem POST", () => {
  it("RFC 8058: Token aus der Query, Body List-Unsubscribe=One-Click", async () => {
    const request = post(`${URL_BASE}?t=${TOKEN}`, "List-Unsubscribe=One-Click", "application/x-www-form-urlencoded");
    expect(await tokenFromRequest(request)).toBe(TOKEN);
  });
  it("RFC 8058 als multipart/form-data", async () => {
    const form = new FormData();
    form.set("List-Unsubscribe", "One-Click");
    expect(await tokenFromRequest(post(`${URL_BASE}?t=${TOKEN}`, form))).toBe(TOKEN);
  });
  it("Formularfeld t (urlencoded und multipart)", async () => {
    expect(await tokenFromRequest(post(URL_BASE, `t=${TOKEN}`, "application/x-www-form-urlencoded; charset=utf-8"))).toBe(TOKEN);
    const form = new FormData();
    form.set("t", OTHER);
    expect(await tokenFromRequest(post(URL_BASE, form))).toBe(OTHER);
  });
  it("gültige Query geht vor dem Formular", async () => {
    expect(await tokenFromRequest(post(`${URL_BASE}?t=${TOKEN}`, `t=${OTHER}`, "application/x-www-form-urlencoded"))).toBe(TOKEN);
  });
  it("ungültige Query fällt auf das Formular zurück", async () => {
    expect(await tokenFromRequest(post(`${URL_BASE}?t=xyz`, `t=${OTHER}`, "application/x-www-form-urlencoded"))).toBe(OTHER);
  });
  it("ohne Token, mit anderem Typ oder kaputtem Body: null", async () => {
    expect(await tokenFromRequest(post(URL_BASE))).toBeNull();
    expect(await tokenFromRequest(post(URL_BASE, JSON.stringify({ t: TOKEN }), "application/json"))).toBeNull();
    expect(await tokenFromRequest(post(URL_BASE, `t=${TOKEN}`, "text/plain"))).toBeNull();
    expect(await formFields("multipart/form-data; boundary=x", new TextEncoder().encode("kaputt"))).toEqual({ t: null, lang: null });
  });
  it("zu großer Body wird verworfen, nicht abgeschnitten gelesen", async () => {
    const big = `t=${TOKEN}&pad=${"x".repeat(MAX_BODY_BYTES)}`;
    expect(await tokenFromRequest(post(URL_BASE, big, "application/x-www-form-urlencoded"))).toBeNull();
    expect(await readCappedBody(new Blob(["x".repeat(MAX_BODY_BYTES + 1)]).stream())).toBeNull();
    expect((await readCappedBody(new Blob(["x".repeat(MAX_BODY_BYTES)]).stream()))?.byteLength).toBe(MAX_BODY_BYTES);
    expect((await readCappedBody(null))?.byteLength).toBe(0);
  });
});

describe("Sprache des POST", () => {
  it("Feld lang der Seite geht vor Accept-Language, ungültig fällt zurück", async () => {
    const headers = { "Content-Type": "application/x-www-form-urlencoded", "Accept-Language": "pl" };
    const read = (body: string) => readUnsubscribePost(new Request(URL_BASE, { method: "POST", body, headers }));
    expect(await read(`t=${TOKEN}&lang=cs`)).toEqual({ token: TOKEN, locale: "cs" });
    expect(await read(`t=${TOKEN}&lang=fr`)).toEqual({ token: TOKEN, locale: "pl" });
    expect(await read("List-Unsubscribe=One-Click")).toEqual({ token: null, locale: "pl" });
  });
});

describe("Sprache aus Accept-Language", () => {
  it.each([
    [null, "de"],
    ["", "de"],
    ["fr-FR,fr;q=0.9", "de"],
    ["pl-PL,pl;q=0.9,en;q=0.8", "pl"],
    ["fr;q=1, cs;q=0.5, en;q=0.7", "en"],
    ["en;q=0, cs", "cs"],
    ["EN-gb", "en"],
    ["*", "de"],
    ["x".repeat(2000), "de"],
  ])("%j → %s", (header, expected) => {
    expect(localeFromAcceptLanguage(header)).toBe(expected);
  });
});
