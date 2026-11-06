import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixture, SKIPPED } from "./context";
import { acceptLegal, anonClient, createSignedInUser, deleteUsers, serviceClient, uniqueEmail } from "./helpers";
import { enrollTotp, localRows, localSql, makeAdmin } from "./totp";

// M8 Commit 8 (ADR 018, Plan M8 7 und Review A11): Suchaufträge über den echten Weg Freigabe (moderate_listing durch
// ein zweites Konto mit Admin-Rolle und aal2) → Abgleich in der DB → Edge Function send-search-notifications →
// Mailpit. Zeit wird nur über Daten verschoben (due_at der Treffer, search_notification_state,
// app_settings.saved_search_daily_hour), nie über einen Testschalter. Mailpit je Test über eine eigene Empfängeradresse.
//
// Pflichtfälle A11: genau eine Mail, zweiter Lauf keine; erneute Prüfung und erneute Freigabe keine; zwei Aufträge
// (gleicher und gemischter Takt) eine; parallele Läufe disjunkt; Release und erneuter Versand; One-Click-POST ohne
// Cookies an die Header-URL; Moderations-Mails bei approve, request_changes, reject und removed (SQL).

const f = fixture();
const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
const WEB = process.env.WEB_URL ?? "http://localhost:3000";
const FN = "send-search-notifications";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Message = { ID: string; Subject: string; Created: string };
type Detail = { Text: string; HTML: string };
type User = { id: string; email: string };
type SignedIn = User & { client: SupabaseClient; token: string };

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

/** Nur Buchstaben: ein Wort, das kein Stemmer zerlegt und das in keiner anderen Anzeige vorkommt. */
function word(): string {
  const letters = "bcdfghjklmnpqrstvwxz";
  return `m${Array.from({ length: 11 }, () => letters[Math.floor(Math.random() * letters.length)]).join("")}`;
}

function setting(key: string): string {
  if (!/^[a-z_]+$/.test(key)) throw new Error("key");
  return localRows<{ v: string }>(`select value::text as v from private.app_settings where key = '${key}'`)[0].v;
}

function setSetting(key: string, value: number): void {
  if (!/^[a-z_]+$/.test(key) || !Number.isInteger(value)) throw new Error("setting");
  localSql(`update private.app_settings set value = '${value}' where key = '${key}'`);
}

function berlinHour(): number {
  return localRows<{ h: number }>("select extract(hour from now() at time zone 'Europe/Berlin')::int as h")[0].h;
}

/** Offene Treffer eines Empfängers sofort fällig machen (statt 2 Minuten Verzögerung nach der Freigabe, H7). */
function makeDue(userId: string): void {
  localSql(`update private.saved_search_matches set due_at = now() - interval '1 minute'
            where user_id = '${uuid(userId)}' and done_at is null`);
}

/** Letzte Sofort-Mail zurückdatieren (Mindestabstand 10 Minuten). */
function gapPassed(userId: string): void {
  localSql(`update private.search_notification_state set last_sent_at = now() - interval '1 hour'
            where user_id = '${uuid(userId)}'`);
}

function matches(userId: string): { saved_search_id: string; listing_id: string; cadence: string; outcome: string | null }[] {
  return localRows(`select saved_search_id, listing_id, cadence::text, outcome from private.saved_search_matches
                    where user_id = '${uuid(userId)}' order by matched_at, saved_search_id`);
}

/** Header-URL aus List-Unsubscribe (`<…>`). */
function headerUrl(h: Record<string, string[]>): string {
  const value = h["List-Unsubscribe"]?.[0] ?? "";
  const match = /^<([^>]+)>$/.exec(value);
  if (!match) throw new Error(`List-Unsubscribe: ${value}`);
  return match[1];
}

async function webReachable(): Promise<boolean> {
  try {
    const response = await fetch(`${WEB}/api/unsubscribe`, { redirect: "manual", signal: AbortSignal.timeout(30_000) });
    return response.status === 303;
  } catch {
    return false;
  }
}

describe.skipIf(!f)("Suchaufträge: Freigabe → Edge Function → Mailpit (M8)", () => {
  const fx = f ?? SKIPPED;
  const service = serviceClient(fx);
  const users: string[] = [];
  const saved: Record<string, string> = {};
  let secret = "";
  let admin: SignedIn;
  let owner: SignedIn;

  const run = (header = secret) =>
    fetch(`${fx.url}/functions/v1/${FN}`, { method: "POST", headers: { "x-search-notify-secret": header } });

  /** Ein Lauf der Function; Status 200 und die Zähler der Antwort. */
  async function runOk(): Promise<{ search: { sent: number }; moderation: { sent: number } }> {
    const response = await run();
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    return body;
  }

  /** Empfänger ohne Session (Admin-API), bestätigte Adresse; Suchaufträge legt dann der Server an. */
  async function plainUser(label: string, language = "de"): Promise<User> {
    const email = uniqueEmail(label);
    const created = await service.auth.admin.createUser({ email, email_confirm: true });
    if (created.error || !created.data.user) throw created.error ?? new Error("createUser");
    users.push(created.data.user.id);
    if (language !== "de") await service.from("profiles").update({ preferred_language: language }).eq("user_id", created.data.user.id);
    return { id: created.data.user.id, email };
  }

  async function signedIn(label: string): Promise<SignedIn> {
    const user = await createSignedInUser(fx, label);
    users.push(user.id);
    await acceptLegal(user.client);
    return user;
  }

  /** Suchauftrag über den Server-Pfad (Schutz-Trigger: Server darf user_id setzen, created_at bleibt now()). */
  async function serverSearch(userId: string, name: string, filters: Record<string, unknown>, cadence = "instant"): Promise<string> {
    const res = await service.from("saved_searches")
      .insert({ user_id: userId, name, filters: { v: 1, ...filters }, cadence })
      .select("id").single();
    expect(res.error).toBeNull();
    return res.data!.id as string;
  }

  /** Anzeige des Anbieters über die echte API einreichen (Hilfe-Gesuch mit Pflichtangaben). */
  async function submitted(title: string, extra: Record<string, unknown> = {}): Promise<string> {
    const res = await owner.client.from("listings").insert({
      kind: "helper", direction: "wanted", title, content_language: "de", region_id: fx.ids.district,
      description: "Wir suchen Hilfe beim Ansitzbau im Frühjahr, zwei Wochenenden im Revier.",
      attributes: { tasks: ["Ansitzbau"] }, ...extra,
    }).select("id").single();
    expect(res.error).toBeNull();
    const id = res.data!.id as string;
    expect((await owner.client.from("listings").update({ status: "pending_review" }).eq("id", id)).error).toBeNull();
    return id;
  }

  async function moderate(id: string, decision: "approve" | "reject" | "request_changes", code?: string, note?: string) {
    const version = await admin.client.rpc("admin_listing_version", { p_listing_id: id });
    expect(version.error).toBeNull();
    const res = await admin.client.rpc("moderate_listing", {
      p_listing_id: id, p_decision: decision, p_expected_version: version.data, p_code: code ?? null, p_note: note ?? null,
    });
    expect(res.error).toBeNull();
  }

  /** Eine Anzeige freigeben und den Abgleich laufen lassen (die Mail ist danach erst nach der Verzögerung fällig). */
  async function approved(title: string, extra: Record<string, unknown> = {}): Promise<string> {
    const id = await submitted(title, extra);
    await moderate(id, "approve");
    return id;
  }

  beforeAll(async () => {
    secret = localRows<{ s: string }>("select decrypted_secret as s from vault.decrypted_secrets where name = 'search_notifications_secret'")[0].s;
    for (const key of ["saved_search_daily_hour", "chat_email_delay_minutes"]) saved[key] = setting(key);
    // Täglicher Takt zunächst nie fällig (Stunde 24 erreicht die Uhr nicht); die Tests setzen ihn gezielt.
    setSetting("saved_search_daily_hour", 24);

    [admin, owner] = await Promise.all([createSignedInUser(fx, "m8-admin"), signedIn("m8-owner")]);
    users.push(admin.id);
    await service.from("profiles").update({ display_name: "Moderatorin Mirabella Geheimname" }).eq("user_id", admin.id);
    makeAdmin(admin.id);
    await enrollTotp(admin.client);
    // Moderations-Mails an den Anbieter aus früheren Läufen abholen, damit sie die Zählungen unten nicht stören.
    await runOk();
  });

  afterAll(async () => {
    setSetting("saved_search_daily_hour", Number(saved.saved_search_daily_hour) || 7);
    setSetting("chat_email_delay_minutes", Number(saved.chat_email_delay_minutes) || 2);
    if (users.length) {
      const { data } = await service.from("listings").select("id").in("owner_id", users);
      const ids = (data ?? []).map((l) => l.id as string);
      if (ids.length) await service.from("audit_log").delete().in("target_id", ids);
      await service.from("audit_log").delete().in("actor_id", users);
    }
    await deleteUsers(fx, users);
  });

  it("Ohne Geheimnis 401, falsche Methode 405", async () => {
    expect((await run("falsch")).status).toBe(401);
    expect((await run("")).status).toBe(401);
    expect((await fetch(`${fx.url}/functions/v1/${FN}`, { method: "GET", headers: { "x-search-notify-secret": secret } })).status).toBe(405);
  });

  it("Akzeptanz: Freigabe → genau eine Mail an den Suchenden (erst nach der Verzögerung), zweiter Lauf keine", async () => {
    const searcher = await signedIn("m8-searcher");
    const q = word();
    const created = await searcher.client.from("saved_searches")
      .insert({ name: "Helfer bei Dresden", filters: { v: 1, q, sort: "newest" }, cadence: "instant", notify_email: true })
      .select("id, filters, expires_at").single();
    expect(created.error).toBeNull();
    expect(created.data!.filters).toEqual({ v: 1, q }); // sort entfernt der Server

    const listing = await submitted(`Ansitzbau ${q}`, { price_minor: 12345, currency: "EUR", price_unit: "per_day" });
    // Ort mit PLZ (für die Prüfung „keine Lage in der Mail“): PLZ, Ort und Kartenpunkt dürfen nicht auftauchen.
    const located = await owner.client.rpc("set_listing_location", {
      p_listing_id: listing, p_region_id: fx.ids.district, p_postal_code: "01067", p_place_name: "Geheimdorf",
    });
    expect(located.error).toBeNull();
    // Nach dem Ort wieder einreichen (falls der Ort die Anzeige verändert hat) und freigeben.
    const status = (await service.from("listings").select("status").eq("id", listing).single()).data!.status as string;
    if (status !== "pending_review") await owner.client.from("listings").update({ status: "pending_review" }).eq("id", listing);
    await moderate(listing, "approve");

    // Erster Lauf: Abgleich, Treffer noch nicht fällig (2 Minuten nach der Freigabe).
    await runOk();
    expect(matches(searcher.id)).toEqual([expect.objectContaining({ saved_search_id: created.data!.id, listing_id: listing, outcome: null })]);
    await wait(500);
    expect(await mails(searcher.email)).toHaveLength(0);

    makeDue(searcher.id);
    expect((await runOk()).search.sent).toBeGreaterThanOrEqual(1);
    await expect.poll(async () => (await mails(searcher.email)).length, { timeout: 10_000 }).toBe(1);
    expect(matches(searcher.id)).toEqual([expect.objectContaining({ outcome: "sent" })]);
    const last = (await searcher.client.from("saved_searches").select("last_notified_at").eq("id", created.data!.id).single()).data;
    expect(last?.last_notified_at).not.toBeNull();

    // Zweiter und dritter Lauf: nichts mehr (auch nicht nach Ablauf des Mindestabstands).
    await runOk();
    gapPassed(searcher.id);
    makeDue(searcher.id);
    await runOk();
    await wait(1000);
    expect(await mails(searcher.email)).toHaveLength(1);
    // Der Anbieter bekommt keine Suchauftrags-Mail (nur die Moderations-Mail).
    const ownerMails = await mails(owner.email);
    expect(ownerMails.filter((m) => m.Subject.includes("Suchauftr"))).toEqual([]);
  });

  it("Mail-Inhalt: List-Unsubscribe auf die POST-URL, Link zur Detailseite, Preis, keine Lage, keine Kontaktdaten", async () => {
    const searcher = await plainUser("m8-content");
    const q = word();
    await serverSearch(searcher.id, "Inhalt <b>prüfen</b>", { q });
    const listing = await submitted(`Inhalt ${q}`, { price_minor: 250000, currency: "EUR", price_unit: "per_year" });
    const located = await owner.client.rpc("set_listing_location", {
      p_listing_id: listing, p_region_id: fx.ids.district, p_postal_code: "01067", p_place_name: "Geheimdorf",
    });
    expect(located.error).toBeNull();
    const status = (await service.from("listings").select("status").eq("id", listing).single()).data!.status as string;
    if (status !== "pending_review") await owner.client.from("listings").update({ status: "pending_review" }).eq("id", listing);
    await moderate(listing, "approve");
    await runOk();
    makeDue(searcher.id);
    await runOk();
    await expect.poll(async () => (await mails(searcher.email)).length, { timeout: 10_000 }).toBe(1);

    const [mail] = await mails(searcher.email);
    expect(mail.Subject).toBe("Neue Anzeigen zu deinen Suchaufträgen auf Revier");
    const h = await headers(mail.ID);
    const url = headerUrl(h);
    expect(url).toMatch(/^http:\/\/localhost:3000\/api\/unsubscribe\?t=[0-9a-f]{64}$/);
    expect(h["List-Unsubscribe-Post"]).toEqual(["List-Unsubscribe=One-Click"]);

    const { Text: text, HTML: html } = await detail(mail.ID);
    expect(html ?? "").toBe(""); // nur Klartext, keine Tracking-Pixel
    expect(text).toContain(`Inhalt ${q}`);
    expect(text).toContain(`http://localhost:3000/de/anzeige/${listing}`);
    expect(text).toMatch(/2\.500\s€ pro Jahr/u);
    expect(text).toContain("- Inhalt <b>prüfen</b>"); // Klartext-Mail: Name unverändert, ohne Steuerzeichen
    expect(text).toContain("http://localhost:3000/de/account/searches");
    const token = new URL(url).searchParams.get("t")!;
    expect(text).toContain(`http://localhost:3000/de/unsubscribe?t=${token}`);
    // Der Text verlinkt nie direkt auf die POST-URL (Linkscanner) und nie auf fremde Ziele.
    expect(text).not.toContain("/api/unsubscribe");
    for (const link of text.match(/https?:\/\/\S+/g) ?? []) expect(link.startsWith("http://localhost:3000/")).toBe(true);

    // Keine Lage: weder PLZ noch Ort noch Koordinaten (Kartenpunkt, Zahlenpaare), kein Anbieter.
    const point = localRows<{ x: number; y: number }>(
      `select extensions.st_x(map_point) as x, extensions.st_y(map_point) as y from public.listings where id = '${uuid(listing)}'`,
    )[0];
    expect(text).not.toContain("01067");
    expect(text).not.toContain("Geheimdorf");
    expect(text).not.toContain(point.x.toFixed(3));
    expect(text).not.toContain(point.y.toFixed(3));
    expect(text).not.toMatch(/-?\d{1,3}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}/);
    expect(text).not.toMatch(/map_point|lat|lng|longitude|latitude/i);
    expect(text).not.toContain(owner.email);
    expect(text).not.toContain(owner.id);
  });

  it("Erneute Prüfung und erneute Freigabe: keine zweite Mail (published_at bleibt)", async () => {
    const searcher = await plainUser("m8-recheck");
    const q = word();
    await serverSearch(searcher.id, "Neu prüfen", { q });
    const listing = await approved(`Neu prüfen ${q}`);
    const published = (await service.from("listings").select("published_at").eq("id", listing).single()).data!.published_at;
    await runOk();
    makeDue(searcher.id);
    await runOk();
    await expect.poll(async () => (await mails(searcher.email)).length, { timeout: 10_000 }).toBe(1);

    // Anbieter ändert den Inhalt → zurück in die Prüfung; Admin gibt erneut frei.
    expect((await owner.client.from("listings").update({ title: `Neu prüfen ${q} geändert` }).eq("id", listing)).error).toBeNull();
    expect((await service.from("listings").select("status").eq("id", listing).single()).data!.status).toBe("pending_review");
    await moderate(listing, "approve");
    // Pausieren und Fortsetzen durch den Anbieter lösen ebenfalls nichts aus.
    expect((await owner.client.from("listings").update({ status: "paused" }).eq("id", listing)).error).toBeNull();
    expect((await owner.client.from("listings").update({ status: "active" }).eq("id", listing)).error).toBeNull();
    expect((await service.from("listings").select("published_at").eq("id", listing).single()).data!.published_at).toBe(published);

    gapPassed(searcher.id);
    await runOk();
    makeDue(searcher.id);
    await runOk();
    await wait(1000);
    expect(await mails(searcher.email)).toHaveLength(1);
    expect(matches(searcher.id)).toHaveLength(1);
  });

  it("Zwei Sofort-Aufträge eines Nutzers: eine Mail, die Anzeige genau einmal, beide Aufträge genannt", async () => {
    const searcher = await plainUser("m8-same");
    const q = word();
    await serverSearch(searcher.id, "Erster Auftrag", { q });
    await serverSearch(searcher.id, "Zweiter Auftrag", { q, kind: "helper" });
    const listing = await approved(`Doppelt ${q}`);
    await runOk();
    expect(matches(searcher.id)).toHaveLength(2);
    makeDue(searcher.id);
    await runOk();
    await expect.poll(async () => (await mails(searcher.email)).length, { timeout: 10_000 }).toBe(1);
    await runOk();
    await wait(1000);
    expect(await mails(searcher.email)).toHaveLength(1);
    const { Text: text } = await detail((await mails(searcher.email))[0].ID);
    expect(text.split(`/de/anzeige/${listing}`).length - 1).toBe(1);
    expect(text).toContain("Erster Auftrag");
    expect(text).toContain("Zweiter Auftrag");
  });

  it("Gemischter Takt: Sofort-Mail gewinnt, der tägliche Treffer wird ohne zweite Mail erledigt", async () => {
    const searcher = await plainUser("m8-mixed");
    const q = word();
    const instant = await serverSearch(searcher.id, "Sofort", { q });
    const daily = await serverSearch(searcher.id, "Täglich", { q }, "daily");
    const listing = await approved(`Gemischt ${q}`);
    await runOk();
    makeDue(searcher.id);
    await runOk(); // täglicher Takt noch nicht fällig (Stunde 24)
    await expect.poll(async () => (await mails(searcher.email)).length, { timeout: 10_000 }).toBe(1);
    const { Text: text } = await detail((await mails(searcher.email))[0].ID);
    expect(text.split(`/de/anzeige/${listing}`).length - 1).toBe(1);

    // Jetzt wird auch der tägliche Takt fällig: kein zweiter Versand derselben Anzeige.
    setSetting("saved_search_daily_hour", berlinHour());
    try {
      gapPassed(searcher.id);
      await runOk();
      await wait(1000);
      expect(await mails(searcher.email)).toHaveLength(1);
      const outcomes = Object.fromEntries(matches(searcher.id).map((m) => [m.saved_search_id, m.outcome]));
      expect(outcomes).toEqual({ [instant]: "sent", [daily]: "duplicate" });
    } finally {
      setSetting("saved_search_daily_hour", 24);
    }
  });

  it("Gemischter Takt, beide gleichzeitig fällig: eine Mail, Anzeige einmal", async () => {
    const searcher = await plainUser("m8-mixed2");
    const q = word();
    await serverSearch(searcher.id, "Sofort zwei", { q });
    await serverSearch(searcher.id, "Täglich zwei", { q }, "daily");
    const listing = await approved(`Gemischt zwei ${q}`);
    await runOk();
    makeDue(searcher.id);
    setSetting("saved_search_daily_hour", berlinHour());
    try {
      await runOk();
      await expect.poll(async () => (await mails(searcher.email)).length, { timeout: 10_000 }).toBe(1);
      await runOk();
      await wait(1000);
      expect(await mails(searcher.email)).toHaveLength(1);
      const { Text: text } = await detail((await mails(searcher.email))[0].ID);
      expect(text.split(`/de/anzeige/${listing}`).length - 1).toBe(1);
    } finally {
      setSetting("saved_search_daily_hour", 24);
    }
  });

  it("Täglicher Takt: erst ab der eingestellten Stunde, höchstens eine Mail je Kalendertag", async () => {
    const searcher = await plainUser("m8-daily", "en");
    const q = word();
    await serverSearch(searcher.id, "Daily", { q }, "daily");
    const first = await approved(`Daily one ${q}`);
    await runOk();
    makeDue(searcher.id);
    // Stunde noch nicht erreicht (aktuelle Stunde + 1; um 23 Uhr ist 24 ebenso unerreichbar).
    setSetting("saved_search_daily_hour", berlinHour() + 1);
    try {
      await runOk();
      await wait(1000);
      expect(await mails(searcher.email)).toHaveLength(0);

      setSetting("saved_search_daily_hour", berlinHour());
      await runOk();
      await expect.poll(async () => (await mails(searcher.email)).length, { timeout: 10_000 }).toBe(1);
      const [mail] = await mails(searcher.email);
      expect(mail.Subject).toBe("New listings for your saved searches on Revier");
      expect((await detail(mail.ID)).Text).toContain(`http://localhost:3000/en/listing/${first}`);

      // Zweite Anzeige am selben Tag: keine Mail, auch nicht nach dem Mindestabstand der Sofort-Mails.
      const second = await approved(`Daily two ${q}`);
      await runOk();
      makeDue(searcher.id);
      gapPassed(searcher.id);
      await runOk();
      await wait(1000);
      expect(await mails(searcher.email)).toHaveLength(1);

      // Nächster Kalendertag (Zustand zurückdatiert): die zweite Anzeige kommt, die erste nicht noch einmal.
      localSql(`update private.search_notification_state set last_daily_on = last_daily_on - 1 where user_id = '${uuid(searcher.id)}'`);
      await runOk();
      await expect.poll(async () => (await mails(searcher.email)).length, { timeout: 10_000 }).toBe(2);
      const newest = (await mails(searcher.email)).sort((a, b) => b.Created.localeCompare(a.Created))[0];
      const text = (await detail(newest.ID)).Text;
      expect(text).toContain(`/en/listing/${second}`);
      expect(text).not.toContain(`/en/listing/${first}`);
    } finally {
      setSetting("saved_search_daily_hour", 24);
    }
  });

  it("Zwei parallele Läufe: insgesamt genau eine Mail (disjunkte Claims)", async () => {
    const searchers = await Promise.all([plainUser("m8-par-a"), plainUser("m8-par-b"), plainUser("m8-par-c")]);
    const q = word();
    for (const s of searchers) await serverSearch(s.id, "Parallel", { q });
    await approved(`Parallel ${q}`);
    await runOk();
    for (const s of searchers) makeDue(s.id);
    const [a, b] = await Promise.all([run(), run()]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const sent = ((await a.json()) as { search: { sent: number } }).search.sent + ((await b.json()) as { search: { sent: number } }).search.sent;
    expect(sent).toBe(3);
    for (const s of searchers) await expect.poll(async () => (await mails(s.email)).length, { timeout: 10_000 }).toBe(1);
    await Promise.all([run(), run()]);
    await wait(1000);
    for (const s of searchers) expect(await mails(s.email)).toHaveLength(1);
  });

  it("Release nach Fehler: Treffer werden wieder frei und genau einmal zugestellt", async () => {
    const searcher = await plainUser("m8-release");
    const q = word();
    await serverSearch(searcher.id, "Release", { q });
    const listing = await approved(`Release ${q}`);
    await runOk();
    makeDue(searcher.id);
    // Wie ein Absturz beim Senden: Claim direkt, dann Release aller Claims dieses Laufs.
    const claim = await service.rpc("claim_search_notifications", { p_secret: secret });
    expect(claim.error).toBeNull();
    const recipients = (claim.data as { recipients: { claim_id: string; email: string; items: { listing_id: string }[] }[] }).recipients;
    const mine = recipients.find((r) => r.email === searcher.email);
    expect(mine?.items.map((i) => i.listing_id)).toEqual([listing]);
    const released = await service.rpc("release_search_notifications", { p_secret: secret, p_claim_ids: recipients.map((r) => r.claim_id) });
    expect(released.error).toBeNull();
    // Geclaimt, nicht bestätigt: ohne Release kein erneuter Claim; nach dem Release ein neuer.
    await runOk();
    await expect.poll(async () => (await mails(searcher.email)).length, { timeout: 10_000 }).toBe(1);
    await runOk();
    await wait(1000);
    expect(await mails(searcher.email)).toHaveLength(1);
    expect(matches(searcher.id)).toEqual([expect.objectContaining({ outcome: "sent" })]);
  });

  it("Pausierter Auftrag: keine Mail, Freigabe in der Pause wird nach dem Fortsetzen nicht nachgeholt", async () => {
    const searcher = await signedIn("m8-pause");
    const q = word();
    const created = await searcher.client.from("saved_searches").insert({ name: "Pause", filters: { v: 1, q } }).select("id").single();
    expect(created.error).toBeNull();
    const id = created.data!.id as string;
    expect((await searcher.client.rpc("pause_saved_search", { p_id: id })).error).toBeNull();
    await approved(`Pause ${q}`);
    await runOk();
    expect(matches(searcher.id)).toEqual([]);
    expect((await searcher.client.rpc("resume_saved_search", { p_id: id })).error).toBeNull();
    await runOk();
    makeDue(searcher.id);
    await runOk();
    await wait(1000);
    expect(await mails(searcher.email)).toHaveLength(0);

    // Nach dem Fortsetzen wirkt der Auftrag wieder: neue Freigabe → eine Mail.
    const later = await approved(`Pause danach ${q}`);
    await runOk();
    makeDue(searcher.id);
    await runOk();
    await expect.poll(async () => (await mails(searcher.email)).length, { timeout: 10_000 }).toBe(1);
    expect((await detail((await mails(searcher.email))[0].ID)).Text).toContain(`/de/anzeige/${later}`);

    // Pausiert zwischen Abgleich und Versand: Treffer ohne Mail erledigt (A3).
    const third = await approved(`Pause zwischen ${q}`);
    await runOk();
    expect((await searcher.client.rpc("pause_saved_search", { p_id: id })).error).toBeNull();
    gapPassed(searcher.id);
    makeDue(searcher.id);
    await runOk();
    await wait(1000);
    expect(await mails(searcher.email)).toHaveLength(1);
    expect(matches(searcher.id).find((m) => m.listing_id === third)?.outcome).toBe("invalid");
  });

  it("One-Click: POST ohne Cookies an genau die Header-URL setzt notify_email = false nur für die Aufträge der Mail", async () => {
    const searcher = await plainUser("m8-oneclick");
    const q = word();
    const inMail = await serverSearch(searcher.id, "In der Mail", { q });
    const other = await serverSearch(searcher.id, "Anderer Auftrag", { q: word() });
    await approved(`Abbestellen ${q}`);
    await runOk();
    makeDue(searcher.id);
    await runOk();
    await expect.poll(async () => (await mails(searcher.email)).length, { timeout: 10_000 }).toBe(1);
    const url = headerUrl(await headers((await mails(searcher.email))[0].ID));
    const token = new URL(url).searchParams.get("t")!;

    const notify = async () => Object.fromEntries(
      ((await service.from("saved_searches").select("id, notify_email").eq("user_id", searcher.id)).data ?? []).map((r) => [r.id, r.notify_email]),
    );

    if (await webReachable()) {
      // GET auf die Header-URL ändert nichts (Linkscanner) und leitet auf die Bestätigungsseite.
      const get = await fetch(url, { redirect: "manual" });
      expect(get.status).toBe(303);
      expect(get.headers.get("location")).toBe(`/de/unsubscribe?t=${token}`);
      expect(await notify()).toEqual({ [inMail]: true, [other]: true });

      const oneClick = (target: string) => fetch(target, {
        method: "POST", redirect: "manual",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "List-Unsubscribe=One-Click",
      });
      const invalid = await oneClick(url.replace(/t=[0-9a-f]{64}/, `t=${"a".repeat(64)}`));
      const invalidBody = await invalid.text();
      expect(await notify()).toEqual({ [inMail]: true, [other]: true });

      const response = await oneClick(url);
      expect(response.status).toBe(200);
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(response.headers.get("set-cookie")).toBeNull();
      // Kein Orakel: gleicher Status und Body für gültige und ungültige Token
      expect([invalid.status, invalidBody]).toEqual([response.status, await response.text()]);
      // Zweimal ist kein Fehler
      expect((await oneClick(url)).status).toBe(200);
      // multipart/form-data (manche Clients) wird ebenso angenommen
      const form = new FormData();
      form.set("List-Unsubscribe", "One-Click");
      expect((await fetch(url, { method: "POST", body: form, redirect: "manual" })).status).toBe(200);
    } else {
      console.warn("[integration] Kein Web-Server auf Port 3000: One-Click über die RPC unsubscribe (Route im E2E)");
      expect((await anonClient(fx).rpc("unsubscribe", { p_token: token })).error).toBeNull();
    }
    expect(await notify()).toEqual({ [inMail]: false, [other]: true });

    // Keine weitere Mail zu dem abbestellten Auftrag
    await approved(`Abbestellt ${q}`);
    gapPassed(searcher.id);
    await runOk();
    makeDue(searcher.id);
    await runOk();
    await wait(1000);
    expect(await mails(searcher.email)).toHaveLength(1);
  });

  it("Chat-Mail mit List-Unsubscribe; der Chat-Token setzt notify_chat_email = false", async () => {
    setSetting("chat_email_delay_minutes", 0);
    const chatSecret = localRows<{ s: string }>("select decrypted_secret as s from vault.decrypted_secrets where name = 'chat_notifications_secret'")[0].s;
    const recipient = await plainUser("m8-chat-owner");
    const listing = (await service.from("listings")
      .insert({ owner_id: recipient.id, kind: "helper", direction: "wanted", title: "Chat Abbestellen", content_language: "de", region_id: fx.ids.district })
      .select("id").single()).data!.id as string;
    await service.from("listings").update({ status: "active", expires_at: new Date(Date.now() + 864e5 * 30).toISOString() }).eq("id", listing);
    const started = await owner.client.rpc("start_conversation", { p_listing_id: listing, p_body: "Hallo zum Abbestellen" });
    expect(started.error).toBeNull();

    const response = await fetch(`${fx.url}/functions/v1/send-chat-notifications`, { method: "POST", headers: { "x-chat-notify-secret": chatSecret } });
    expect(response.status).toBe(200);
    await expect.poll(async () => (await mails(recipient.email)).length, { timeout: 10_000 }).toBe(1);
    const [mail] = await mails(recipient.email);
    const h = await headers(mail.ID);
    const url = headerUrl(h);
    expect(url).toMatch(/^http:\/\/localhost:3000\/api\/unsubscribe\?t=[0-9a-f]{64}$/);
    expect(h["List-Unsubscribe-Post"]).toEqual(["List-Unsubscribe=One-Click"]);
    const token = new URL(url).searchParams.get("t")!;
    expect((await detail(mail.ID)).Text).toContain(`/de/unsubscribe?t=${token}`);

    const before = (await service.from("profiles").select("notify_chat_email").eq("user_id", recipient.id).single()).data;
    expect(before?.notify_chat_email).toBe(true);
    if (await webReachable()) {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" });
      expect(res.status).toBe(200);
    } else {
      expect((await anonClient(fx).rpc("unsubscribe", { p_token: token })).error).toBeNull();
    }
    const after = (await service.from("profiles").select("notify_chat_email").eq("user_id", recipient.id).single()).data;
    expect(after?.notify_chat_email).toBe(false);
  });

  it("Moderations-Mails bei approve, request_changes, reject und removed: Grund, kein List-Unsubscribe, kein Admin", async () => {
    const author = await signedIn("m8-mod-owner");
    await service.from("profiles").update({ preferred_language: "de" }).eq("user_id", author.id);
    const make = async (title: string) => {
      const res = await author.client.from("listings").insert({
        kind: "helper", direction: "wanted", title, content_language: "de", region_id: fx.ids.district,
        description: "Wir suchen Hilfe beim Ansitzbau im Frühjahr, zwei Wochenenden im Revier.", attributes: { tasks: ["Ansitzbau"] },
      }).select("id").single();
      expect(res.error).toBeNull();
      expect((await author.client.from("listings").update({ status: "pending_review" }).eq("id", res.data!.id)).error).toBeNull();
      return res.data!.id as string;
    };
    const ok = await make("Moderation frei");
    const changes = await make("Moderation Änderung");
    const rejected = await make("Moderation abgelehnt");
    await moderate(ok, "approve");
    await moderate(changes, "request_changes", "incomplete", "Bitte <b>Fotos</b> ergänzen");
    await moderate(rejected, "reject", "contact_in_text", "Telefonnummer entfernen");
    // Entfernen per SQL als Admin (noch kein Web-Pfad): Moderations-Flag wie moderate_listing, aal2-Claims.
    // Ein Statement (supabase db query nimmt keine mehreren): DO-Block, Rolle und Claims transaktionslokal.
    localSql(`do $$ begin
      perform set_config('role', 'authenticated', true);
      perform set_config('request.jwt.claims', '{"sub":"${uuid(admin.id)}","role":"authenticated","aal":"aal2"}', true);
      perform set_config('revier.moderation', 'on', true);
      update public.listings set status = 'removed', reject_code = 'prohibited_content', reject_reason = 'Unzulässig laut Prüfung'
      where id = '${uuid(ok)}';
    end $$`);
    expect((await service.from("listings").select("status").eq("id", ok).single()).data!.status).toBe("removed");

    await runOk();
    await expect.poll(async () => (await mails(author.email)).length, { timeout: 10_000 }).toBe(4);
    const all = await mails(author.email);
    const bySubject = Object.fromEntries(await Promise.all(all.map(async (m) => [m.Subject, { ...(await detail(m.ID)), h: await headers(m.ID) }] as const)));
    expect(Object.keys(bySubject).sort()).toEqual([
      "Deine Anzeige auf Revier ist freigegeben",
      "Deine Anzeige auf Revier wurde abgelehnt",
      "Deine Anzeige auf Revier wurde entfernt",
      "Änderungen an deiner Anzeige auf Revier angefragt",
    ].sort());
    for (const [subject, m] of Object.entries(bySubject)) {
      expect(m.h["List-Unsubscribe"], subject).toBeUndefined();
      expect(m.h["List-Unsubscribe-Post"], subject).toBeUndefined();
      expect(m.Text, subject).not.toContain(admin.email);
      expect(m.Text, subject).not.toContain(admin.id);
      expect(m.Text, subject).not.toContain("Mirabella");
      expect(m.Text, subject).not.toContain("/unsubscribe");
    }
    const approvedMail = bySubject["Deine Anzeige auf Revier ist freigegeben"].Text;
    expect(approvedMail).toContain("Moderation frei");
    expect(approvedMail).not.toMatch(/Grund:/);
    const changesMail = bySubject["Änderungen an deiner Anzeige auf Revier angefragt"].Text;
    expect(changesMail).toContain("Angaben unvollständig");
    expect(changesMail).toContain("Fotos");
    const rejectedMail = bySubject["Deine Anzeige auf Revier wurde abgelehnt"].Text;
    expect(rejectedMail).toContain("Kontaktdaten im Text");
    expect(rejectedMail).toContain("Telefonnummer entfernen");
    const removedMail = bySubject["Deine Anzeige auf Revier wurde entfernt"].Text;
    expect(removedMail).toContain("Unzulässige Inhalte");
    expect(removedMail).toContain("Unzulässig laut Prüfung");

    // Zweiter Lauf: keine weitere Mail
    await runOk();
    await wait(1000);
    expect(await mails(author.email)).toHaveLength(4);
  });
});
