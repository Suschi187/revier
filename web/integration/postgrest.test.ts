import { describe, expect, it } from "vitest";
import { fixture, SKIPPED } from "./context";
import { exactCount, rest } from "./helpers";

// PostgREST über die echte API (ADR 009, Auflage QA M1): Schema private nicht erreichbar, keine
// fremden oder privaten Daten über Embeddings, kein Existenz-Orakel über count=exact.

const f = fixture();

async function json(response: Response): Promise<unknown> {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

describe.skipIf(!f)("PostgREST: Schema private und interne Funktionen", () => {
  const fx = f ?? SKIPPED;
  const token = fx.users.c.token;

  it("Accept-Profile/Content-Profile private, auth, storage, extensions werden abgelehnt (PGRST106)", async () => {
    const cases: [string, string, string][] = [
      ["private", "GET", "app_settings?select=*"],
      ["private", "GET", "user_roles?select=*"],
      ["private", "GET", "listing_location_offsets?select=*"],
      ["private", "POST", "rpc/is_admin"],
      ["private", "POST", "rpc/has_accepted_current_legal"],
      ["private", "POST", "rpc/setting_text"],
      ["auth", "GET", "users?select=*"],
      ["storage", "GET", "objects?select=*"],
      ["extensions", "GET", "pg_stat_statements?select=*"],
    ];
    for (const [schema, method, path] of cases) {
      for (const auth of [token, undefined]) {
        const header = method === "GET" ? "Accept-Profile" : "Content-Profile";
        const response = await rest(fx, path, { token: auth, method, headers: { [header]: schema }, body: method === "POST" ? {} : undefined });
        expect(response.status, `${schema}.${path}`).toBe(406);
        expect(((await json(response)) as { code?: string }).code).toBe("PGRST106");
      }
    }
  });

  it("Interne Funktionen sind im Standardschema nicht aufrufbar (PGRST202)", async () => {
    for (const fn of ["is_admin", "is_server", "has_accepted_current_legal", "setting_text", "write_audit", "is_active_user", "custom_access_token_hook"]) {
      const response = await rest(fx, `rpc/${fn}`, { token, method: "POST", body: {} });
      expect(response.status, fn).toBe(404);
    }
  });

  it("Die OpenAPI-Beschreibung nennt keine privaten Objekte", async () => {
    for (const auth of [token, undefined]) {
      const response = await rest(fx, "", { token: auth });
      const text = response.ok ? await response.text() : "";
      for (const name of ["app_settings", "user_roles", "listing_location_offsets", "is_admin", "setting_text"]) {
        expect(text, name).not.toContain(name);
      }
    }
  });
});

describe.skipIf(!f)("PostgREST: Embeddings auf fremde und private Daten", () => {
  const fx = f ?? SKIPPED;
  const { a, b, c } = fx.users;

  it("Positivkontrolle: Teilnehmer lesen Unterhaltung und Nachricht über das Embedding", async () => {
    for (const user of [a, b]) {
      const response = await rest(fx, `listings?select=id,conversations(id,messages(body))&id=eq.${fx.ids.activeB}`, { token: user.token });
      expect(await json(response)).toEqual([
        { id: fx.ids.activeB, conversations: [{ id: fx.ids.conversation, messages: [{ body: "Geheime Nachricht von A" }] }] },
      ]);
    }
  });

  it("C sieht über Embeddings keine fremden Unterhaltungen und Nachrichten", async () => {
    const viaListing = await rest(fx, `listings?select=id,conversations(id,messages(body))&id=eq.${fx.ids.activeB}`, { token: c.token });
    expect(await json(viaListing)).toEqual([{ id: fx.ids.activeB, conversations: [] }]);
    for (const path of ["conversations?select=*,messages(*)", "messages?select=*", `messages?conversation_id=eq.${fx.ids.conversation}`]) {
      expect(await json(await rest(fx, path, { token: c.token })), path).toEqual([]);
    }
    const inner = await rest(fx, "listings?select=id,conversations!inner(id)", { token: c.token });
    expect(await json(inner)).toEqual([]);
  });

  it("C sieht den Entwurf von A weder direkt noch über Region, Fotos oder Volltext", async () => {
    const paths = [
      `listings?id=eq.${fx.ids.draftA}`,
      `listings?title=eq.${encodeURIComponent("Entwurf A geheim")}`,
      `listing_photos?listing_id=eq.${fx.ids.draftA}`,
      `listings?select=id,listing_photos(*)&id=eq.${fx.ids.draftA}`,
      `listings?description=wfts(german).geheim`,
    ];
    for (const path of paths) {
      expect(await json(await rest(fx, path, { token: c.token })), path).toEqual([]);
      expect(await json(await rest(fx, path)), `anon ${path}`).toEqual([]);
    }
    const region = await rest(fx, `regions?select=id,listings(id,title)&id=eq.${fx.ids.district}`, { token: c.token });
    const [row] = (await json(region)) as { listings: { id: string }[] }[];
    expect(row.listings.map((listing) => listing.id)).toEqual([fx.ids.activeB]);
    // Positivkontrolle
    expect(await json(await rest(fx, `listings?select=id&id=eq.${fx.ids.draftA}`, { token: a.token }))).toEqual([{ id: fx.ids.draftA }]);
  });

  it("Profile: C liest nur das eigene Profil, Embeddings liefern kein fremdes Profil", async () => {
    expect(await json(await rest(fx, "profiles?select=user_id", { token: c.token }))).toEqual([{ user_id: c.id }]);
    const embed = await rest(fx, `listings?select=id,profiles(user_id,is_blocked)&id=eq.${fx.ids.activeB}`, { token: c.token });
    expect(await json(embed)).toEqual([{ id: fx.ids.activeB, profiles: null }]);
  });

  it("public_profiles: nur Anbieter mit öffentlicher Anzeige, Chatpartner nur füreinander, nur öffentliche Spalten", async () => {
    const ids = async (token?: string) =>
      ((await json(await rest(fx, `public_profiles?select=user_id&user_id=in.(${a.id},${b.id},${c.id})`, { token }))) as { user_id: string }[])
        .map((row) => row.user_id)
        .sort();
    expect(await ids()).toEqual([b.id]);
    expect(await ids(c.token)).toEqual([b.id]);
    expect(await ids(b.token)).toEqual([a.id, b.id].sort());
    const columns = Object.keys(((await json(await rest(fx, `public_profiles?user_id=eq.${b.id}`))) as object[])[0]).sort();
    expect(columns).toEqual(["account_type", "business_name", "country", "display_name", "user_id", "verification_status"]);
  });

  it("Verifizierungen und AGB-Nachweise anderer bleiben unsichtbar", async () => {
    // Spalten-GRANT (QA M1 F6): reviewed_by ist für Nutzer nicht lesbar, deshalb explizite Spalten.
    expect((await rest(fx, "verifications?select=*", { token: a.token })).status).toBe(403);
    expect(await json(await rest(fx, "verifications?select=id,user_id,document_path", { token: c.token }))).toEqual([]);
    expect(await json(await rest(fx, `verifications?select=id&id=eq.${fx.ids.verificationA}`, { token: c.token }))).toEqual([]);
    expect(await json(await rest(fx, "legal_acceptances?select=*", { token: c.token }))).toEqual([]);
    expect(await json(await rest(fx, `legal_acceptances?user_id=eq.${a.id}`, { token: b.token }))).toEqual([]);
    // Positivkontrolle
    const own = (await json(await rest(fx, "legal_acceptances?select=document,source", { token: a.token }))) as unknown[];
    expect(own).toHaveLength(2);
    expect(await json(await rest(fx, "verifications?select=id", { token: a.token }))).toEqual([{ id: fx.ids.verificationA }]);
  });
});

describe.skipIf(!f)("PostgREST: kein Existenz-Orakel über count=exact", () => {
  const fx = f ?? SKIPPED;
  const { a, b, c } = fx.users;

  it("Zählungen fremder Daten sind 0, eigene Zählungen stimmen (Positivkontrolle)", async () => {
    const cases: [string, number, number][] = [
      // Pfad, Zählung für C, Zählung für den Besitzer
      [`listings?id=eq.${fx.ids.draftA}`, 0, 1],
      [`listings?title=eq.${encodeURIComponent("Entwurf A geheim")}`, 0, 1],
      [`listing_photos?listing_id=eq.${fx.ids.draftA}`, 0, 1],
      [`messages?id=eq.${fx.ids.message}`, 0, 1],
      [`conversations?id=eq.${fx.ids.conversation}`, 0, 1],
      [`verifications?select=id&user_id=eq.${a.id}`, 0, 1],
      [`legal_acceptances?user_id=eq.${a.id}`, 0, 2],
      [`profiles?user_id=eq.${a.id}`, 0, 1],
      [`regions?select=id,listings!inner(id)&listings.id=eq.${fx.ids.draftA}`, 0, 1],
    ];
    for (const [path, forC, forOwner] of cases) {
      expect(await exactCount(fx, path, c.token), `C ${path}`).toBe(forC);
      expect(await exactCount(fx, path, a.token), `A ${path}`).toBe(forOwner);
    }
    expect(await exactCount(fx, `messages?id=eq.${fx.ids.message}`, b.token)).toBe(1);
  });

  it("anon zählt nur öffentliche Anzeigen und keine geschützten Tabellen", async () => {
    expect(await exactCount(fx, `listings?id=eq.${fx.ids.draftA}`)).toBe(0);
    expect(await exactCount(fx, `listings?id=eq.${fx.ids.activeB}`)).toBe(1);
    for (const table of ["profiles", "messages", "conversations", "verifications", "legal_acceptances", "favorites", "reports", "devices"]) {
      const response = await rest(fx, `${table}?select=*`, { method: "HEAD", headers: { Prefer: "count=exact" } });
      expect(response.status, table).toBe(401);
    }
  });
});

describe.skipIf(!f)("PostgREST: anon und fremde Nutzer schreiben nicht", () => {
  const fx = f ?? SKIPPED;
  const { a, c } = fx.users;

  it("anon ruft legal_status und accept_legal nicht auf", async () => {
    for (const fn of ["legal_status", "accept_legal"]) {
      const response = await rest(fx, `rpc/${fn}`, { method: "POST", body: fn === "accept_legal" ? { p_terms_version: "x", p_privacy_version: "x", p_source: "web" } : {} });
      expect(response.status, fn).toBe(401);
    }
  });

  it("Nachweise sind nur über accept_legal schreibbar, nie direkt", async () => {
    const insert = await rest(fx, "legal_acceptances", {
      token: c.token,
      method: "POST",
      body: { user_id: c.id, document: "terms", version: "2026-10-draft", source: "web" },
    });
    expect(insert.status).toBe(403);
    const patch = await rest(fx, `legal_acceptances?user_id=eq.${a.id}`, { token: a.token, method: "PATCH", body: { version: "x" } });
    expect(patch.status).toBe(403);
    const remove = await rest(fx, `legal_acceptances?user_id=eq.${a.id}`, { token: a.token, method: "DELETE" });
    expect(remove.status).toBe(403);
    expect(await exactCount(fx, "legal_acceptances?select=id", a.token)).toBe(2);
  });

  it("C ändert und löscht den Entwurf von A nicht und schreibt nicht in fremde Unterhaltungen", async () => {
    const patch = await rest(fx, `listings?id=eq.${fx.ids.draftA}`, {
      token: c.token,
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: { title: "Gekapert" },
    });
    expect(await json(patch)).toEqual([]);
    const remove = await rest(fx, `listings?id=eq.${fx.ids.draftA}`, { token: c.token, method: "DELETE", headers: { Prefer: "return=representation" } });
    expect(await json(remove)).toEqual([]);
    const message = await rest(fx, "messages", { token: c.token, method: "POST", body: { conversation_id: fx.ids.conversation, body: "Hallo" } });
    expect(message.status).toBe(403);
    const title = await json(await rest(fx, `listings?select=title&id=eq.${fx.ids.draftA}`, { token: a.token }));
    expect(title).toEqual([{ title: "Entwurf A geheim" }]);
  });
});
