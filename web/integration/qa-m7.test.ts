import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bodyValid, normalizeBody } from "../lib/chat/rules";
import { fixture, SKIPPED } from "./context";
import { acceptLegal, anonClient, createSignedInUser, deleteUsers, rest, serviceClient, userClient } from "./helpers";
import { localRows, localSql } from "./totp";

// QA M7 Abnahme (docs/QA-REPORT.md „M7 – Abnahme“): Angriffe über die echte API. Realtime (öffentliche Kanäle,
// Client-Broadcast, REST-Broadcast, Presence), Orakel über alle RPCs mit vollem Fehlertext, PostgREST-Embeddings,
// parallele Requests gegen die Rate-Limits, Edge Function (Methoden, Geheimnis, Header-Injektion über den
// Anzeigenamen) und weitere Fälle der Textregeln gegen Zod.

const f = fixture();
const created: string[] = [];
const channels: { client: SupabaseClient; channel: RealtimeChannel }[] = [];
const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

afterAll(async () => {
  for (const { client, channel } of channels) await client.removeChannel(channel);
  if (f) await deleteUsers(f, created);
});

async function json(response: Response): Promise<unknown> {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

type Event = { event: string; payload: Record<string, unknown> };

function listen(client: SupabaseClient, topic: string, isPrivate: boolean, presence = false) {
  const events: Event[] = [];
  const channel = client.channel(topic, { config: { private: isPrivate, broadcast: { self: true, ack: true }, ...(presence ? { presence: { key: "x" } } : {}) } });
  channels.push({ client, channel });
  const status = new Promise<string>((resolve) => {
    channel
      .on("broadcast", { event: "*" }, (message) => events.push({ event: message.event, payload: message.payload as Record<string, unknown> }))
      .subscribe((state) => {
        if (state !== "CLOSED") resolve(state);
      });
  });
  return { channel, events, status };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!f)("QA M7: Realtime-Kanäle angreifen", () => {
  const fx = f ?? SKIPPED;
  const { b, c } = fx.users;

  it("Öffentlicher Kanal mit gleichem Topic, Client-Broadcast und REST-Broadcast erreichen den privaten Kanal nicht", async () => {
    const victim = userClient(fx, b);
    await victim.realtime.setAuth(b.token);
    const own = listen(victim, `user:${b.id}`, true);
    expect(await own.status).toBe("SUBSCRIBED");

    // Angreifer C: öffentlicher Kanal auf das Topic des Opfers, sendet ein gefälschtes Ereignis
    const attacker = userClient(fx, c);
    await attacker.realtime.setAuth(c.token);
    const spoof = listen(attacker, `user:${b.id}`, false);
    expect(await spoof.status).toBe("SUBSCRIBED");
    await spoof.channel.send({ type: "broadcast", event: "message.new", payload: { conversation_id: fx.ids.conversation, spoof: "public" } });

    // Ohne Anmeldung ebenso
    const anon = anonClient(fx);
    const anonSpoof = listen(anon, `user:${b.id}`, false);
    expect(await anonSpoof.status).toBe("SUBSCRIBED");
    await anonSpoof.channel.send({ type: "broadcast", event: "unread.changed", payload: { spoof: "anon" } });

    // Eigener privater Kanal des Angreifers: Senden verlangt eine INSERT-Policy, die es nicht gibt
    const attacker2 = userClient(fx, c);
    await attacker2.realtime.setAuth(c.token);
    const ownAttacker = listen(attacker2, `user:${c.id}`, true);
    expect(await ownAttacker.status).toBe("SUBSCRIBED");
    const selfSend = await ownAttacker.channel.send({ type: "broadcast", event: "message.new", payload: { spoof: "own-private" } });

    // REST-Broadcast an den privaten Kanal des Opfers und an den öffentlichen
    const restPrivate = await fetch(`${fx.url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: { apikey: fx.publishableKey, Authorization: `Bearer ${c.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ topic: `user:${b.id}`, event: "message.new", payload: { spoof: "rest-private" }, private: true }] }),
    });
    await fetch(`${fx.url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: { apikey: fx.publishableKey, Authorization: `Bearer ${c.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ topic: `user:${b.id}`, event: "message.new", payload: { spoof: "rest-public" }, private: false }] }),
    });

    await wait(2000);
    expect(own.events.filter((e) => typeof e.payload?.spoof === "string")).toEqual([]);
    expect(ownAttacker.events.filter((e) => e.payload?.spoof === "own-private")).toEqual([]);
    expect(selfSend).not.toBe("ok");
    // Der REST-Broadcast an einen privaten Kanal wird abgelehnt oder verworfen (in jedem Fall kam oben nichts an).
    expect([202, 401, 403]).toContain(restPrivate.status);
  });

  it("Presence auf dem eigenen privaten Kanal ist nicht möglich (keine INSERT-Policy)", async () => {
    const client = userClient(fx, c);
    await client.realtime.setAuth(c.token);
    const sub = listen(client, `user:${c.id}`, true, true);
    const state = await sub.status;
    if (state !== "SUBSCRIBED") return; // Join mit Presence ganz abgelehnt: ebenfalls gut
    const tracked = await sub.channel.track({ online: true });
    expect(tracked).not.toBe("ok");
  });
});

describe.skipIf(!f)("QA M7: Orakel und Embeddings über PostgREST", () => {
  const fx = f ?? SKIPPED;
  const { a, b, c } = fx.users;

  it("Alle Chat-RPCs: fremde und unbekannte Unterhaltung ergeben Status und Body gleich", async () => {
    const calls: [string, (id: string) => Record<string, unknown>][] = [
      ["conversation_info", (id) => ({ p_conversation_id: id })],
      ["conversation_messages", (id) => ({ p_conversation_id: id })],
      ["send_message", (id) => ({ p_conversation_id: id, p_body: "Hallo" })],
      ["mark_conversation_read", (id) => ({ p_conversation_id: id })],
      ["block_in_conversation", (id) => ({ p_conversation_id: id })],
      ["unblock_in_conversation", (id) => ({ p_conversation_id: id })],
    ];
    for (const [name, args] of calls) {
      const foreign = await rest(fx, `rpc/${name}`, { token: c.token, method: "POST", body: args(fx.ids.conversation) });
      const unknown = await rest(fx, `rpc/${name}`, { token: c.token, method: "POST", body: args(crypto.randomUUID()) });
      expect([foreign.status, await json(foreign)], name).toEqual([unknown.status, await json(unknown)]);
    }
  });

  it("Embeddings verraten nichts: Unbeteiligte sehen keine Unterhaltung, keine Nachricht, keinen Zähler", async () => {
    const paths = [
      "conversations?select=id,messages(body)",
      "messages?select=body,conversations(id,owner_id)",
      `listings?select=id,conversations(id,messages(body))&id=eq.${fx.ids.activeB}`,
      `conversations?select=id,listings(title)&listing_id=eq.${fx.ids.activeB}`,
      `messages?select=id&id=eq.${fx.ids.message}`,
      "reports?select=id,target_id",
    ];
    for (const path of paths) {
      const response = await rest(fx, path, { token: c.token });
      const data = (await json(response)) as unknown[] | { code?: string };
      if (Array.isArray(data)) {
        const text = JSON.stringify(data);
        expect(text, path).not.toContain("Geheime Nachricht");
        expect(text, path).not.toContain(fx.ids.conversation);
      } else {
        // Fehler (z. B. keine Beziehung) ist ebenso unbedenklich, solange er nichts Inhaltliches nennt.
        expect(JSON.stringify(data), path).not.toContain("Geheime Nachricht");
      }
    }
    const head = await rest(fx, `messages?conversation_id=eq.${fx.ids.conversation}`, { token: c.token, method: "HEAD", headers: { Prefer: "count=exact" } });
    expect(head.headers.get("content-range")).toMatch(/\/0$/);
    // Teilnehmer sehen über das Embedding nur ihre Unterhaltung, B als Besitzer seine
    const own = (await json(await rest(fx, `listings?select=id,conversations(id)&id=eq.${fx.ids.activeB}`, { token: b.token }))) as { conversations: { id: string }[] }[];
    expect(own[0].conversations.map((x) => x.id)).toContain(fx.ids.conversation);
    const interested = (await json(await rest(fx, "messages?select=recipient_id,read_at,conversation_id", { token: a.token }))) as { conversation_id: string }[];
    expect(interested.every((m) => m.conversation_id === fx.ids.conversation)).toBe(true);
  });

  it("Spaltenrechte: messages/conversations/blocks nicht direkt schreibbar, auch nicht per Upsert", async () => {
    const upsert = await rest(fx, "conversations?on_conflict=listing_id,interested_id", {
      token: c.token, method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: { listing_id: fx.ids.activeB, interested_id: c.id },
    });
    expect(upsert.status).toBeGreaterThanOrEqual(400);
    const insertMessage = await rest(fx, "messages", { token: a.token, method: "POST", body: { conversation_id: fx.ids.conversation, body: "direkt" } });
    expect(insertMessage.status).toBeGreaterThanOrEqual(400);
    const patch = await rest(fx, `messages?id=eq.${fx.ids.message}`, { token: b.token, method: "PATCH", body: { read_at: "2020-01-01T00:00:00Z" } });
    expect(patch.status).toBeGreaterThanOrEqual(400);
    const block = await rest(fx, "blocks", { token: c.token, method: "POST", body: { blocker_id: c.id, blocked_id: crypto.randomUUID() } });
    expect(block.status).toBeGreaterThanOrEqual(400);
    const unknownBlock = await rest(fx, "blocks", { token: c.token, method: "POST", body: { blocker_id: c.id, blocked_id: b.id } });
    expect([block.status, (await json(block) as { code: string }).code]).toEqual([unknownBlock.status, (await json(unknownBlock) as { code: string }).code]);
  });
});

describe.skipIf(!f)("QA M7: parallele Requests gegen die Rate-Limits", () => {
  const fx = f ?? SKIPPED;
  let saved: { key: string; value: string }[] = [];

  beforeAll(() => {
    saved = localRows<{ key: string; value: string }>(
      "select key, value::text as value from private.app_settings where key in ('chat_unanswered_max', 'chat_new_conversations_daily_new')",
    );
  });
  afterAll(() => {
    for (const row of saved) {
      if (/^\d+$/.test(row.value) && /^[a-z_]+$/.test(row.key)) localSql(`update private.app_settings set value = '${row.value}' where key = '${row.key}'`);
    }
  });

  it("10 parallele Nachrichten ohne Antwort: genau die Grenze, 10 parallele neue Unterhaltungen: genau die Grenze", async () => {
    const sender = await createSignedInUser(fx, "qa7-par");
    created.push(sender.id);
    await acceptLegal(sender.client);
    const service = serviceClient(fx);
    const listings: string[] = [];
    for (let n = 0; n < 10; n++) {
      const { data } = await service.from("listings")
        .insert({ owner_id: fx.users.b.id, kind: "helper", direction: "wanted", title: `QA7 parallel ${n}`, content_language: "de", region_id: fx.ids.district })
        .select("id").single();
      await service.from("listings").update({ status: "active", expires_at: new Date(Date.now() + 864e5 * 30).toISOString() }).eq("id", data!.id);
      listings.push(data!.id as string);
    }
    try {
      localSql("update private.app_settings set value = '3' where key = 'chat_unanswered_max'");
      localSql("update private.app_settings set value = '4' where key = 'chat_new_conversations_daily_new'");
      const started = await sender.client.rpc("start_conversation", { p_listing_id: listings[0], p_body: "Erste" });
      expect(started.error).toBeNull();
      const results = await Promise.all(
        Array.from({ length: 10 }, (_, n) => sender.client.rpc("send_message", { p_conversation_id: started.data, p_body: `parallel ${n}` })),
      );
      const ok = results.filter((r) => !r.error).length;
      expect(ok).toBe(2);
      expect(results.filter((r) => r.error).every((r) => r.error?.code === "RV002" && r.error.hint?.includes("chat_unanswered"))).toBe(true);
      const { count } = await service.from("messages").select("id", { count: "exact", head: true }).eq("conversation_id", started.data as string);
      expect(count).toBe(3);

      const conversations = await Promise.all(listings.slice(1).map((id) => sender.client.rpc("start_conversation", { p_listing_id: id, p_body: "Hallo" })));
      expect(conversations.filter((r) => !r.error).length).toBe(3);
      expect(conversations.filter((r) => r.error).every((r) => r.error?.code === "RV002" && r.error.hint?.includes("chat_conversations"))).toBe(true);
      const total = await service.from("conversations").select("id", { count: "exact", head: true }).eq("interested_id", sender.id);
      expect(total.count).toBe(4);
    } finally {
      for (const row of saved) {
        if (/^\d+$/.test(row.value) && /^[a-z_]+$/.test(row.key)) localSql(`update private.app_settings set value = '${row.value}' where key = '${row.key}'`);
      }
      await service.from("listings").delete().in("id", listings);
    }
  });
});

describe.skipIf(!f)("QA M7: Edge Function send-chat-notifications", () => {
  const fx = f ?? SKIPPED;
  const endpoint = () => `${fx.url}/functions/v1/send-chat-notifications`;
  let secret = "";
  let delay = "2";

  beforeAll(() => {
    secret = localRows<{ s: string }>("select decrypted_secret as s from vault.decrypted_secrets where name = 'chat_notifications_secret'")[0].s;
    delay = localRows<{ v: string }>("select value::text as v from private.app_settings where key = 'chat_email_delay_minutes'")[0].v;
  });
  afterAll(() => {
    localSql(`update private.app_settings set value = '${Number(delay) || 2}' where key = 'chat_email_delay_minutes'`);
  });

  it("Nur POST mit Geheimnis: GET 405, ohne/mit falschem Header 401, Antworten ohne Details", async () => {
    expect((await fetch(endpoint())).status).toBe(405);
    expect((await fetch(endpoint(), { method: "PUT" })).status).toBe(405);
    const none = await fetch(endpoint(), { method: "POST" });
    expect(none.status).toBe(401);
    expect(await none.json()).toEqual({ error: "unauthorized" });
    const wrong = await fetch(endpoint(), { method: "POST", headers: { "x-chat-notify-secret": `${secret.slice(0, -1)}0` } });
    expect(wrong.status).toBe(401);
    // Mit Bearer-Token eines Nutzers statt Geheimnis ebenso 401 (verify_jwt = false, das JWT zählt nicht)
    const user = await fetch(endpoint(), { method: "POST", headers: { Authorization: `Bearer ${fx.users.a.token}` } });
    expect(user.status).toBe(401);
  });

  it("Zeilenumbrüche im Anzeigenamen landen nicht in Headern; keine Bcc, Betreff fest, kein Text", async () => {
    const owner = await createSignedInUser(fx, "qa7-mail-owner");
    const sender = await createSignedInUser(fx, "qa7-mail-sender");
    created.push(owner.id, sender.id);
    for (const user of [owner, sender]) await acceptLegal(user.client);
    const service = serviceClient(fx);
    const evil = "Eve\r\nBcc: qa7-bcc@test.local\r\nSubject: Konto gesperrt";
    const named = await service.from("profiles").update({ display_name: evil }).eq("user_id", sender.id).select("display_name").single();
    expect(named.error).toBeNull();
    const { data } = await service.from("listings")
      .insert({ owner_id: owner.id, kind: "helper", direction: "wanted", title: "QA7 Mail <b>fett</b>", content_language: "de", region_id: fx.ids.district })
      .select("id").single();
    await service.from("listings").update({ status: "active", expires_at: new Date(Date.now() + 864e5 * 30).toISOString() }).eq("id", data!.id);
    const started = await sender.client.rpc("start_conversation", { p_listing_id: data!.id, p_body: "Geheimtext QA7 4711" });
    expect(started.error).toBeNull();

    localSql("update private.app_settings set value = '0' where key = 'chat_email_delay_minutes'");
    const run = await fetch(endpoint(), { method: "POST", headers: { "x-chat-notify-secret": secret } });
    expect(run.status).toBe(200);
    type Summary = { ID: string; Subject: string; Bcc: unknown[]; To: { Address: string }[] };
    const search = async (query: string) =>
      ((await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(query)}`)).json()) as { messages: Summary[] }).messages;
    await expect.poll(async () => (await search(`to:"${owner.email}"`)).length, { timeout: 10_000 }).toBe(1);
    const [mail] = await search(`to:"${owner.email}"`);
    expect(mail.Subject).toBe("Neue Nachrichten auf Revier");
    expect(mail.To.map((t) => t.Address)).toEqual([owner.email]);
    expect(mail.Bcc ?? []).toEqual([]);
    expect(await search('to:"qa7-bcc@test.local"')).toEqual([]);
    const headers = (await (await fetch(`${MAILPIT}/api/v1/message/${mail.ID}/headers`)).json()) as Record<string, string[]>;
    expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toContain("bcc");
    expect(headers.Subject).toHaveLength(1);
    const detail = (await (await fetch(`${MAILPIT}/api/v1/message/${mail.ID}`)).json()) as { Text: string; HTML: string };
    expect(detail.Text).not.toContain("4711");
    expect(detail.Text).toContain("Eve  Bcc: qa7-bcc@test.local  Subject: Konto gesperrt");
    expect(detail.Text).toContain("QA7 Mail <b>fett</b>");
    expect(detail.HTML).toBe("");
  });
});

describe.skipIf(!f)("QA M7: weitere Textregeln, Zod = RPC", () => {
  const fx = f ?? SKIPPED;
  const cases: [string, string][] = [
    ["Zeilentrenner außen", " Hallo "],
    ["Zeilentrenner innen", "a b"],
    ["ZWSP außen (kein Leerraum)", "​x​"],
    ["Mongolischer Vokaltrenner", "᠎x"],
    ["BOM außen", "﻿a﻿"],
    ["Dateitrenner innen", "a\u001Cb"],
    ["Dateitrenner außen", "\u001Ca"],
    ["LRM/RLM (keine Steuerzeichen laut ADR)", "x‎‏y"],
    ["Arabic Letter Mark", "a؜b"],
    ["Vertikaler Tab außen", "\u000Ba\u000C"],
    ["7990 Leerzeichen und ein Zeichen", `${" ".repeat(7990)}a`],
    ["ZWJ-Emoji 2000 Codepoints", "👨‍👩‍👧".repeat(400)],
    ["ZWJ-Emoji 2005 Codepoints", `${"👨‍👩‍👧".repeat(401)}`],
    ["CR allein am Ende", "a\r"],
    ["NBSP innen", "a b"],
  ];

  it.each(cases)("%s", async (_name, body) => {
    const client = userClient(fx, fx.users.a);
    const { data, error } = await client.rpc("send_message", { p_conversation_id: fx.ids.conversation, p_body: body });
    const dbValid = !error;
    expect(dbValid).toBe(bodyValid(body));
    if (error) {
      expect(`${error.code} ${error.hint}`).toBe("22023 body");
      return;
    }
    const stored = await client.from("messages").select("body").eq("id", data as string).single();
    expect(stored.data?.body).toBe(normalizeBody(body));
  });

  // Zod begrenzt vor der Prüfung auf 8000 UTF-16-Einheiten (MAX_BODY * 4), die DB nach dem Trimmen auf 2000 Codepoints.
  it.fails("Über 8000 Einheiten Leerraum außen: Zod lehnt ab, die DB nimmt an (Abweichung, siehe Hinweis)", async () => {
    const body = `${" ".repeat(8001)}a`;
    const client = userClient(fx, fx.users.a);
    const { error } = await client.rpc("send_message", { p_conversation_id: fx.ids.conversation, p_body: body });
    const { bodySchema } = await import("../lib/chat/rules");
    expect(bodySchema.safeParse(body).success).toBe(!error);
  });

  it("NUL: Zod lehnt ab; die API antwortet mit einem anderen Code als 22023 body (nur für iOS relevant)", async () => {
    const client = userClient(fx, fx.users.a);
    const { error } = await client.rpc("send_message", { p_conversation_id: fx.ids.conversation, p_body: "a\u0000b" });
    expect(bodyValid("a\u0000b")).toBe(false);
    expect(error).not.toBeNull();
    // Festhalten, was die API liefert (Bericht): PostgreSQL kann NUL in text nicht speichern.
    expect(error?.code).toMatch(/^(22023|22P05|22021)$/);
  });
});

// Sicherheitsnetz: Ein frischer Client ohne Anmeldung ruft die Funktionen des Benachrichtigungswegs nicht auf.
describe.skipIf(!f)("QA M7: claim/release nur für service_role", () => {
  const fx = f ?? SKIPPED;
  it("anon und authenticated: kein Zugriff", async () => {
    for (const client of [anonClient(fx), userClient(fx, fx.users.a)]) {
      const claim = await client.rpc("claim_chat_notifications", { p_secret: "x" });
      expect(claim.error?.code).toMatch(/^(42501|PGRST202)$/);
      const release = await client.rpc("release_chat_notifications", { p_secret: "x", p_recipients: [] });
      expect(release.error?.code).toMatch(/^(42501|PGRST202)$/);
    }
    // Der lokale service_role ohne Geheimnis ebenso nicht
    const service = createClient(fx.url, fx.serviceKey, { auth: { persistSession: false } });
    expect((await service.rpc("claim_chat_notifications", { p_secret: "falsch" })).error?.code).toBe("42501");
  });
});
