import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixture, SKIPPED } from "./context";
import { acceptLegal, anonClient, createSignedInUser, deleteUsers, serviceClient, uniqueEmail } from "./helpers";
import { localRows, localSql } from "./totp";

// QA-Abnahme M8 (docs/QA-REPORT.md, „M8 – Abnahme“): Proben über die echten Schnittstellen, kein Feature-Code.
// - at-most-once unter Nebenläufigkeit: parallele Claims per PostgREST (disjunkt, je Empfänger einmal), Release aller
//   Claims und erneuter Versand genau einmal; parallele Läufe der Function.
// - Limit 25 bei parallelen Inserts eines Kontos.
// - Header-Injektion über den Namen des Suchauftrags (CR/LF, Bcc) bis in Mailpit.
// - Orakel der RPCs über PostgREST (voller Fehler), Antwortzeit von unsubscribe (gültig, erstmalig, vs. ungültig).
// - Links der Mail in vier Sprachen gegen den laufenden Web-Server (falls erreichbar).
// Keine Koordinaten, Adressen oder Token in Ausgaben.

const f = fixture();
const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
const WEB = process.env.WEB_URL ?? "http://localhost:3000";
const FN = "send-search-notifications";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Message = { ID: string; Subject: string };
type Address = { Address: string };
type Detail = { Text: string; To: Address[]; Cc: Address[] | null; Bcc: Address[] | null };
type User = { id: string; email: string };

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function mails(to: string): Promise<Message[]> {
  const response = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
  return ((await response.json()) as { messages: Message[] }).messages;
}
async function detail(id: string): Promise<Detail> {
  return (await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()) as Detail;
}
async function headers(id: string): Promise<Record<string, string[]>> {
  return (await (await fetch(`${MAILPIT}/api/v1/message/${id}/headers`)).json()) as Record<string, string[]>;
}
function uuid(value: string): string {
  if (!UUID.test(value)) throw new Error("uuid");
  return value;
}
function word(): string {
  const letters = "bcdfghjklmnpqrstvwxz";
  return `q${Array.from({ length: 11 }, () => letters[Math.floor(Math.random() * letters.length)]).join("")}`;
}
function setting(key: string): string {
  if (!/^[a-z_]+$/.test(key)) throw new Error("key");
  return localRows<{ v: string }>(`select value::text as v from private.app_settings where key = '${key}'`)[0].v;
}
function setSetting(key: string, value: string): void {
  if (!/^[a-z_]+$/.test(key) || !/^[0-9]+$/.test(value)) throw new Error("setting");
  localSql(`update private.app_settings set value = '${value}' where key = '${key}'`);
}
function makeDue(ids: string[]): void {
  localSql(`update private.saved_search_matches set due_at = now() - interval '1 minute'
            where user_id in (${ids.map((id) => `'${uuid(id)}'`).join(",")}) and done_at is null`);
}
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
async function webReachable(): Promise<boolean> {
  try {
    const response = await fetch(`${WEB}/api/unsubscribe`, { redirect: "manual", signal: AbortSignal.timeout(30_000) });
    return response.status === 303;
  } catch {
    return false;
  }
}

describe.skipIf(!f)("QA M8: Nebenläufigkeit, Injektion, Orakel, Links", () => {
  const fx = f ?? SKIPPED;
  const service = serviceClient(fx);
  const users: string[] = [];
  const saved: Record<string, string> = {};
  let secret = "";
  let owner: User;

  const run = () => fetch(`${fx.url}/functions/v1/${FN}`, { method: "POST", headers: { "x-search-notify-secret": secret } });

  async function plainUser(label: string, language = "de"): Promise<User> {
    const email = uniqueEmail(label);
    const created = await service.auth.admin.createUser({ email, email_confirm: true });
    if (created.error || !created.data.user) throw created.error ?? new Error("createUser");
    users.push(created.data.user.id);
    if (language !== "de") await service.from("profiles").update({ preferred_language: language }).eq("user_id", created.data.user.id);
    return { id: created.data.user.id, email };
  }

  async function serverSearch(userId: string, name: string, filters: Record<string, unknown>): Promise<string> {
    const res = await service.from("saved_searches").insert({ user_id: userId, name, filters: { v: 1, ...filters } }).select("id").single();
    expect(res.error).toBeNull();
    return res.data!.id as string;
  }

  /** Öffentliche Anzeige über den Server-Pfad (erste Freigabe: Insert-Trigger reiht ein). */
  async function publicListing(title: string): Promise<string> {
    const res = await service.from("listings").insert({
      owner_id: owner.id, kind: "helper", direction: "wanted", title, content_language: "de", region_id: fx.ids.district,
      description: "Hilfe beim Ansitzbau, zwei Wochenenden im Frühjahr.", attributes: { tasks: ["Ansitzbau"] },
      status: "active", expires_at: new Date(Date.now() + 30 * 864e5).toISOString(),
      price_minor: 4200, currency: "EUR", price_unit: "per_day",
    }).select("id").single();
    expect(res.error).toBeNull();
    return res.data!.id as string;
  }

  beforeAll(async () => {
    secret = localRows<{ s: string }>("select decrypted_secret as s from vault.decrypted_secrets where name = 'search_notifications_secret'")[0].s;
    for (const key of ["saved_search_daily_hour"]) saved[key] = setting(key);
    setSetting("saved_search_daily_hour", "24");
    owner = await plainUser("qa8-owner");
  });

  afterAll(async () => {
    setSetting("saved_search_daily_hour", saved.saved_search_daily_hour ?? "7");
    if (users.length) {
      const { data } = await service.from("listings").select("id").in("owner_id", users);
      const ids = (data ?? []).map((l) => l.id as string);
      if (ids.length) await service.from("audit_log").delete().in("target_id", ids);
    }
    await deleteUsers(fx, users);
  });

  it("Parallele Claims per PostgREST: disjunkt, je Empfänger höchstens einmal; nach Release aller Claims genau eine Mail", async () => {
    const q = word();
    const recipients = await Promise.all(["qa8-par1", "qa8-par2", "qa8-par3", "qa8-par4"].map((label) => plainUser(label)));
    for (const r of recipients) await serverSearch(r.id, "Parallel", { q });
    await publicListing(`Parallel ${q}`);
    expect((await run()).status).toBe(200); // Abgleich
    makeDue(recipients.map((r) => r.id));

    const results = await Promise.all(Array.from({ length: 6 }, () => service.rpc("claim_search_notifications", { p_secret: secret, p_limit: 1 })));
    for (const r of results) expect(r.error).toBeNull();
    const claimed = results.flatMap((r) => ((r.data as { recipients: { claim_id: string; email: string }[] }).recipients ?? []))
      .filter((r) => recipients.some((x) => x.email === r.email));
    const emails = claimed.map((c) => c.email);
    expect(new Set(emails).size).toBe(emails.length); // kein Empfänger doppelt
    expect(new Set(claimed.map((c) => c.claim_id)).size).toBe(claimed.length);
    expect(emails.length).toBeLessThanOrEqual(4);
    expect(emails.length).toBeGreaterThanOrEqual(1);

    // Alle Claims fehlgeschlagen (Release), dann der echte Lauf: jeder Empfänger genau einmal.
    const released = await service.rpc("release_search_notifications", { p_secret: secret, p_claim_ids: claimed.map((c) => c.claim_id) });
    expect(released.error).toBeNull();
    expect(released.data).toBe(claimed.length);
    localSql(`update private.search_notification_state set last_sent_at = now() - interval '1 hour'
              where user_id in (${recipients.map((r) => `'${uuid(r.id)}'`).join(",")})`);
    await Promise.all(Array.from({ length: 4 }, () => run()));
    await expect.poll(async () => (await Promise.all(recipients.map((r) => mails(r.email)))).map((m) => m.length),
      { timeout: 15_000 }).toEqual([1, 1, 1, 1]);
    // Weitere Läufe: nichts
    await Promise.all([run(), run()]);
    await wait(1000);
    expect((await Promise.all(recipients.map((r) => mails(r.email)))).map((m) => m.length)).toEqual([1, 1, 1, 1]);
  }, 90_000);

  it("Limit 25 bei parallelen Inserts eines Kontos: genau 25, die übrigen 23514 mit hint saved_searches_limit", async () => {
    const user = await createSignedInUser(fx, "qa8-limit");
    users.push(user.id);
    await acceptLegal(user.client);
    const rows = Array.from({ length: 20 }, (_, i) => ({ user_id: user.id, name: `L${i}`, filters: { v: 1 } }));
    expect((await service.from("saved_searches").insert(rows)).error).toBeNull();
    const attempts = await Promise.all(Array.from({ length: 10 }, (_, i) =>
      user.client.from("saved_searches").insert({ name: `P${i}`, filters: { v: 1 } }).select("id")));
    const ok = attempts.filter((a) => !a.error).length;
    const limited = attempts.filter((a) => a.error?.code === "23514" && a.error.hint === '{"reason":"saved_searches_limit"}').length;
    expect([ok, limited]).toEqual([5, 5]);
    const { count } = await service.from("saved_searches").select("id", { count: "exact", head: true }).eq("user_id", user.id);
    expect(count).toBe(25);
  });

  it("Header-Injektion über den Namen des Suchauftrags: ein Empfänger, kein Bcc, keine zusätzlichen Header", async () => {
    const user = await createSignedInUser(fx, "qa8-inject");
    users.push(user.id);
    await acceptLegal(user.client);
    const q = word();
    const evil = uniqueEmail("qa8-evil");
    const name = `Name\r\nBcc: ${evil}\r\nX-Qa-Evil: 1\r\n\r\nText`;
    const created = await user.client.from("saved_searches").insert({ name, filters: { v: 1, q } }).select("id, name").single();
    expect(created.error).toBeNull();
    await publicListing(`Injektion ${q}`);
    expect((await run()).status).toBe(200);
    makeDue([user.id]);
    expect((await run()).status).toBe(200);
    await expect.poll(async () => (await mails(user.email)).length, { timeout: 10_000 }).toBe(1);
    const [mail] = await mails(user.email);
    const d = await detail(mail.ID);
    const h = await headers(mail.ID);
    expect(d.To.map((a) => a.Address)).toEqual([user.email]);
    expect(d.Bcc ?? []).toEqual([]);
    expect(d.Cc ?? []).toEqual([]);
    expect(Object.keys(h).filter((k) => /evil|bcc/i.test(k))).toEqual([]);
    expect(h["List-Unsubscribe"]).toHaveLength(1);
    expect(h.Subject).toHaveLength(1);
    expect(d.Text).toContain("Name  Bcc:");
    expect(d.Text).not.toMatch(/\r|\n\s*Bcc:/);
    expect(await mails(evil)).toHaveLength(0);
  });

  it("Orakel über PostgREST: pause/resume/extend mit fremder und unbekannter ID liefern denselben Fehler", async () => {
    const [a, b] = await Promise.all([createSignedInUser(fx, "qa8-ora-a"), createSignedInUser(fx, "qa8-ora-b")]);
    users.push(a.id, b.id);
    await Promise.all([acceptLegal(a.client), acceptLegal(b.client)]);
    const foreign = await serverSearch(b.id, "Fremd", {});
    localSql(`update public.saved_searches set expires_at = now() + interval '2 days', paused_at = now() where id = '${uuid(foreign)}'`);
    const unknown = crypto.randomUUID();
    for (const fn of ["pause_saved_search", "resume_saved_search", "extend_saved_search"]) {
      const [x, y] = await Promise.all([a.client.rpc(fn, { p_id: foreign }), a.client.rpc(fn, { p_id: unknown })]);
      expect(x.error, fn).not.toBeNull();
      expect({ ...x.error, fn }).toEqual({ ...y.error, fn });
      expect([x.status, x.error?.code]).toEqual([y.status, "42501"]);
    }
    const upd = await a.client.from("saved_searches").update({ notify_email: false }).eq("id", foreign).select("id");
    const updUnknown = await a.client.from("saved_searches").update({ notify_email: false }).eq("id", unknown).select("id");
    expect([upd.status, upd.data, upd.error]).toEqual([updUnknown.status, updUnknown.data, updUnknown.error]);
  });

  it("unsubscribe: gültig (erstmals) und ungültig ohne Fehler, Antwortzeit ohne deutlichen Unterschied", async () => {
    const user = await plainUser("qa8-timing");
    const ids = await Promise.all(Array.from({ length: 15 }, (_, i) => serverSearch(user.id, `T${i}`, {})));
    const tokens = localRows<{ t: string }>(
      `select private.issue_unsubscribe_token('${uuid(user.id)}', 'saved_search_mail', array[x]) as t
       from unnest(array[${ids.map((id) => `'${uuid(id)}'`).join(",")}]::uuid[]) as x`,
    ).map((r) => r.t);
    expect(tokens.every((t) => /^[0-9a-f]{64}$/.test(t))).toBe(true);
    const anon = anonClient(fx);
    const timed = async (token: string) => {
      const start = performance.now();
      const res = await anon.rpc("unsubscribe", { p_token: token });
      expect(res.error).toBeNull();
      return performance.now() - start;
    };
    for (let i = 0; i < 5; i++) await timed("0".repeat(64)); // Aufwärmen
    const valid: number[] = [];
    const invalid: number[] = [];
    for (const token of tokens) {
      invalid.push(await timed(Array.from({ length: 64 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("")));
      valid.push(await timed(token));
    }
    const diff = median(valid) - median(invalid);
    console.info(`[qa-m8] unsubscribe Median gültig ${median(valid).toFixed(1)} ms, ungültig ${median(invalid).toFixed(1)} ms`);
    expect(Math.abs(diff)).toBeLessThan(25);
    const { data } = await service.from("saved_searches").select("notify_email").eq("user_id", user.id);
    expect((data ?? []).every((r) => r.notify_email === false)).toBe(true);
  });

  it("Links der Mail in vier Sprachen führen auf existierende Seiten (Detail 200, Konto 307 zum Login, Abbestellen 200)", async () => {
    if (!(await webReachable())) {
      console.warn("[qa-m8] Kein Web-Server auf Port 3000: Links nicht geprüft");
      return;
    }
    const q = word();
    const langs = ["de", "en", "cs", "pl"] as const;
    const recipients = await Promise.all(langs.map((lang) => plainUser(`qa8-links-${lang}`, lang)));
    for (const r of recipients) await serverSearch(r.id, "Links", { q });
    await publicListing(`Links ${q}`);
    expect((await run()).status).toBe(200);
    makeDue(recipients.map((r) => r.id));
    expect((await run()).status).toBe(200);
    for (const [i, lang] of langs.entries()) {
      await expect.poll(async () => (await mails(recipients[i].email)).length, { timeout: 10_000 }).toBe(1);
      const text = (await detail((await mails(recipients[i].email))[0].ID)).Text;
      const urls = [...text.matchAll(/https?:\/\/\S+/g)].map((m) => m[0]);
      expect(urls.length, lang).toBeGreaterThanOrEqual(3);
      for (const url of urls) {
        const target = new URL(url);
        expect(target.pathname.startsWith(`/${lang}/`), `${lang} ${target.pathname}`).toBe(true);
        const response = await fetch(`${WEB}${target.pathname}${target.search}`, { redirect: "manual" });
        const expected = target.pathname.includes("/account/") ? 307 : 200;
        expect(response.status, `${lang} ${target.pathname.replace(/[0-9a-f]{64}/, "<t>")}`).toBe(expected);
      }
    }
  }, 120_000);
});

