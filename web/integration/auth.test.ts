import { createHmac } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { fixture, SKIPPED } from "./context";
import { acceptLegal, anonClient, createSignedInUser, deleteUsers, exactCount, rest, serviceClient, uniqueEmail } from "./helpers";

// Supabase Auth über die echte API (ADR 009/010): anon und fremde Nutzer, gefälschte Tokens,
// keine Rechteausweitung über user_metadata, gesperrte Konten. Bekannte Lücken (QA-Bericht M2)
// halten das heutige Fehlverhalten genau fest. Sie werden rot, sobald die Lücke behoben ist, und
// sind dann auf das erwartete Verhalten umzustellen.

const f = fixture();
const created: string[] = [];

afterAll(async () => {
  if (f) await deleteUsers(f, created);
});

const b64url = (value: object | string) =>
  Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");

function claimsOf(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
}

function authPost(path: string, body: unknown): Promise<Response> {
  return fetch(`${f!.url}/auth/v1/${path}`, {
    method: "POST",
    headers: { apikey: f!.publishableKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe.skipIf(!f)("Auth: anon und fremde Nutzer", () => {
  const fx = f ?? SKIPPED;
  const { a, c } = fx.users;

  it("anon hat keinen Nutzer und keinen Zugriff auf die Admin-API", async () => {
    const user = await fetch(`${fx.url}/auth/v1/user`, { headers: { apikey: fx.publishableKey } });
    expect(user.status).toBeGreaterThanOrEqual(401);
    const users = await fetch(`${fx.url}/auth/v1/admin/users`, { headers: { apikey: fx.publishableKey } });
    expect(users.status).toBeGreaterThanOrEqual(401);
  });

  it("Ein normaler Nutzer erreicht die Admin-API nicht", async () => {
    for (const path of ["admin/users", `admin/users/${a.id}`]) {
      const response = await fetch(`${fx.url}/auth/v1/${path}`, {
        headers: { apikey: fx.publishableKey, Authorization: `Bearer ${c.token}` },
      });
      expect(response.status, path).toBe(403);
    }
  });

  it("Gefälschte oder veränderte Tokens werden von PostgREST und Storage abgelehnt", async () => {
    const payload = { ...claimsOf(a.token), sub: a.id };
    const [header, , signature] = c.token.split(".");
    const forged = {
      none: `${b64url({ alg: "none", typ: "JWT" })}.${b64url(payload)}.`,
      wrongSecret: (() => {
        const head = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(payload)}`;
        return `${head}.${createHmac("sha256", "falsches-geheimnis-falsches-geheimnis").update(head).digest("base64url")}`;
      })(),
      swappedSub: `${header}.${b64url({ ...claimsOf(c.token), sub: a.id })}.${signature}`,
      serviceRole: `${header}.${b64url({ ...claimsOf(c.token), role: "service_role" })}.${signature}`,
    };
    for (const [name, token] of Object.entries(forged)) {
      const response = await rest(fx, "profiles?select=user_id", { token });
      expect(response.status, name).toBe(401);
      const sign = await fetch(`${fx.url}/storage/v1/object/sign/verification-docs/${fx.paths.docA}`, {
        method: "POST",
        headers: { apikey: fx.publishableKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ expiresIn: 60 }),
      });
      expect(sign.status, `storage ${name}`).toBeGreaterThanOrEqual(400);
    }
    // Positivkontrolle
    expect((await rest(fx, "profiles?select=user_id", { token: a.token })).status).toBe(200);
  });
});

describe.skipIf(!f)("Auth: Session und Rechte", () => {
  const fx = f ?? SKIPPED;

  it("user_metadata verschafft keine Admin- oder Server-Rechte", async () => {
    const d = await createSignedInUser(fx, "meta");
    created.push(d.id);
    const update = await d.client.auth.updateUser({ data: { app_role: "admin", role: "service_role", is_admin: true } });
    expect(update.error).toBeNull();
    const refreshed = await d.client.auth.refreshSession();
    const token = refreshed.data.session!.access_token;
    const claims = claimsOf(token);
    expect(claims.role).toBe("authenticated");
    expect(claims.app_role).toBeUndefined();
    expect((claims.app_metadata as Record<string, unknown>).app_role).toBeUndefined();
    expect(await exactCount(fx, `verifications?select=id&user_id=eq.${fx.users.a.id}`, token)).toBe(0);
    expect(await exactCount(fx, `listings?id=eq.${fx.ids.draftA}`, token)).toBe(0);
  });

  it("Nach dem Logout ist das Refresh-Token ungültig; das Access-Token gilt bis zum Ablauf (ADR 010, bewusst)", async () => {
    const d = await createSignedInUser(fx, "logout");
    created.push(d.id);
    const { data } = await d.client.auth.getSession();
    const session = data.session!;
    expect((await d.client.auth.signOut({ scope: "local" })).error).toBeNull();
    const refresh = await authPost("token?grant_type=refresh_token", { refresh_token: session.refresh_token });
    expect(refresh.status).toBe(400);
    // Dokumentiertes Verhalten: getClaims prüft nur die Signatur, das JWT läuft nach jwt_expiry ab.
    expect((await rest(fx, "profiles?select=user_id", { token: session.access_token })).status).toBe(200);
  });

  it("Gesperrte Konten: keine Zustimmung, keine neuen Anzeigen, Anzeigen und Profil verschwinden öffentlich", async () => {
    const admin = serviceClient(fx);
    const e = await createSignedInUser(fx, "blocked");
    created.push(e.id);
    await acceptLegal(e.client);
    // Entwurf anlegen, Freigabe durch den Server (Pflichtfelder prüft listings.test.ts)
    const listing = await e.client
      .from("listings")
      .insert({ kind: "helper", direction: "offer", title: "Anzeige gesperrt", content_language: "de", region_id: fx.ids.district })
      .select("id")
      .single<{ id: string }>();
    expect(listing.error).toBeNull();
    await admin.from("listings").update({ status: "active", expires_at: new Date(Date.now() + 86_400_000).toISOString() }).eq("id", listing.data!.id);
    expect(await exactCount(fx, `listings?id=eq.${listing.data!.id}`)).toBe(1);
    expect(await exactCount(fx, `public_profiles?user_id=eq.${e.id}`)).toBe(1);

    expect((await admin.from("profiles").update({ is_blocked: true }).eq("user_id", e.id).select()).error).toBeNull();

    expect(await exactCount(fx, `listings?id=eq.${listing.data!.id}`)).toBe(0);
    expect(await exactCount(fx, `public_profiles?user_id=eq.${e.id}`)).toBe(0);
    const legal = await e.client.rpc("legal_status").single<{ terms_version: string; privacy_version: string }>();
    const accept = await e.client.rpc("accept_legal", {
      p_terms_version: legal.data!.terms_version,
      p_privacy_version: legal.data!.privacy_version,
      p_source: "web",
    });
    expect(accept.error?.code).toBe("42501");
    const another = await e.client
      .from("listings")
      .insert({ kind: "helper", direction: "offer", title: "Noch eine", content_language: "de", region_id: fx.ids.district });
    expect(another.error?.code).toBe("42501");
  });

  it("accept_legal lehnt veraltete Versionen ab und ist idempotent", async () => {
    const d = await createSignedInUser(fx, "legal");
    created.push(d.id);
    expect((await d.client.rpc("accept_legal", { p_terms_version: "2000-01", p_privacy_version: "2000-01", p_source: "web" })).error?.code).toBe("22023");
    const { data } = await d.client.rpc("legal_status").single<{ terms_version: string; privacy_version: string; accepted: boolean }>();
    expect(data!.accepted).toBe(false);
    for (let i = 0; i < 2; i++) {
      const result = await d.client.rpc("accept_legal", { p_terms_version: data!.terms_version, p_privacy_version: data!.privacy_version, p_source: "web" });
      expect(result.error).toBeNull();
    }
    expect(((await d.client.rpc("legal_status").single<{ accepted: boolean }>()).data!).accepted).toBe(true);
    expect(await exactCount(fx, "legal_acceptances?select=id", (await d.client.auth.getSession()).data.session!.access_token)).toBe(2);
  });
});

// QA M2 F1 behoben: Die DB verwirft jeden Passwort-Hash (Migration no_passwords, ADR 010).
describe.skipIf(!f)("Auth: keine Passwörter", () => {
  const fx = f ?? SKIPPED;

  it("Ein gesetztes Passwort ist nie zur Anmeldung nutzbar, auch nicht nach globalem Logout", async () => {
    const d = await createSignedInUser(fx, "pw");
    created.push(d.id);
    await d.client.auth.updateUser({ password: "Ein-langes-Passwort-123" });
    await d.client.auth.signOut({ scope: "global" });
    const login = await authPost("token?grant_type=password", { email: d.email, password: "Ein-langes-Passwort-123" });
    expect(login.status).toBe(400);
  });

  it("Passwort-Registrierung einer fremden Adresse übernimmt das spätere Konto nicht", async () => {
    const email = uniqueEmail("takeover");
    // Angreifer registriert die Adresse des Opfers mit eigenem Passwort (ohne Bestätigung).
    const signup = await authPost("signup", { email, password: "Angreifer-Passwort-123" });
    const signupBody = (await signup.json()) as { id?: string; user?: { id: string } };
    const id = signupBody.user?.id ?? signupBody.id;
    if (id) created.push(id);
    // Opfer meldet sich später passwortlos an (wie die Web-App: Link bzw. Code bestätigt die Adresse).
    const admin = serviceClient(fx);
    const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
    expect(link.error).toBeNull();
    const victim = anonClient(fx);
    expect((await victim.auth.verifyOtp({ token_hash: link.data.properties!.hashed_token, type: "email" })).error).toBeNull();
    // Vor dem Fix: 200 und die Nutzer-ID des Opfers.
    const login = await authPost("token?grant_type=password", { email, password: "Angreifer-Passwort-123" });
    expect(login.status).toBe(400);
  });
});

// Bekannte Lücke (QA-Bericht M2 F2, Restrisiko in ADR 010): prüft das heutige Verhalten.
describe.skipIf(!f)("Auth: bekannte Restrisiken", () => {
  const fx = f ?? SKIPPED;

  it("QA M2 F2 (angenommen bis Captcha): Die OTP-API verrät mit create_user=false, ob ein Konto existiert", async () => {
    // Nur anlegen, nicht anmelden: generateLink zählt sonst für den Mail-Abstand (max_frequency).
    const email = uniqueEmail("enum");
    const existing = await serviceClient(fx).auth.admin.createUser({ email, email_confirm: true });
    created.push(existing.data.user!.id);
    const known = await authPost("otp", { email, create_user: false });
    const unknown = await authPost("otp", { email: uniqueEmail("unbekannt"), create_user: false });
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(422);
    expect(((await unknown.json()) as { error_code?: string }).error_code).toBe("otp_disabled");
  });
});
